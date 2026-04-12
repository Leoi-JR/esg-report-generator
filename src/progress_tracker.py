"""
progress_tracker.py
===================
Pipeline 进度追踪模块。

Web 端通过 child_process.spawn 启动 Python 脚本时传入 --tracker <run_id>，
脚本内部通过本模块将进度写入 JSON 文件，Node.js SSE 端点轮询该文件并推送给浏览器。

CLI 模式（无 --tracker 参数）下返回 NullTracker，所有方法为空操作，零开销。

用法（有 argparse 的脚本，推荐）：
    from progress_tracker import get_tracker
    parser.add_argument("--tracker", type=str, default=None)
    args = parser.parse_args()
    tracker = get_tracker(args, "generate_draft")

用法（无 argparse 的脚本，兼容保留）：
    from progress_tracker import get_tracker_from_argv
    tracker = get_tracker_from_argv(sys.argv, "my_script")

之后在各阶段边界：
    tracker.set_stage("Text extraction", total=255)
    for rec in file_records:
        do_work(rec)
        tracker.advance(1, detail=rec["file_name"])
    tracker.complete()
"""

import atexit
import json
import os
import sys
import time
from pathlib import Path
from typing import Optional

# 进度文件存放目录（与 src/ 同级，.gitignore 应忽略）
PROGRESS_DIR = Path(__file__).resolve().parent / ".progress"


class ProgressTracker:
    """将进度写入 JSON 文件，供 Node.js SSE 端点轮询。"""

    def __init__(self, run_id: str, step_name: str):
        self.run_id = run_id
        self.step_name = step_name
        self.progress_file = PROGRESS_DIR / f"progress_{run_id}.json"
        PROGRESS_DIR.mkdir(exist_ok=True)

        self._state = {
            "run_id": run_id,
            "step": step_name,
            "stage": "",
            "status": "running",
            "current": 0,
            "total": 0,
            "detail": "",
            "percent": 0.0,
            "started_at": time.time(),
            "updated_at": time.time(),
            "error": None,
            "stages_completed": [],
            "substeps": {},
            "partial_failed": 0,
            "partial_failed_ids": [],
        }
        self._last_write = 0.0
        self._write()
        atexit.register(self._on_exit)

    def set_stage(self, stage: str, total: int = 0):
        """进入新阶段。上一个阶段自动记入 stages_completed。"""
        if self._state["stage"] and self._state["stage"] not in self._state["stages_completed"]:
            self._state["stages_completed"].append(self._state["stage"])
        self._state["stage"] = stage
        self._state["current"] = 0
        self._state["total"] = total
        self._state["percent"] = 0.0
        self._state["detail"] = ""
        self._write()

    def advance(self, n: int = 1, detail: str = ""):
        """推进进度计数。内置 300ms 节流，防止高频 I/O。"""
        self._state["current"] += n
        if detail:
            self._state["detail"] = detail
        if self._state["total"] > 0:
            self._state["percent"] = round(
                self._state["current"] / self._state["total"] * 100, 1
            )
        now = time.time()
        # 节流：每 300ms 写一次，或进度完成时强制写
        if (now - self._last_write >= 0.3) or (
            self._state["total"] > 0 and self._state["current"] >= self._state["total"]
        ):
            self._write()

    def set_substep(self, key: str, status: str):
        """设置子步骤状态（用于 Step 5 章节级追踪）。

        Args:
            key: 子步骤标识（如章节 id "r016"）
            status: "pending" | "running" | "done" | "error"
        """
        self._state["substeps"][key] = status
        self._write()

    def set_partial_failed(self, count: int, ids: list):
        """记录部分失败的节点数量和 ID 列表，写入进度文件供 Node.js 读取。"""
        self._state["partial_failed"] = count
        self._state["partial_failed_ids"] = ids
        self._write()

    def complete(self):
        """标记整个 step 完成。"""
        if self._state["stage"] and self._state["stage"] not in self._state["stages_completed"]:
            self._state["stages_completed"].append(self._state["stage"])
        self._state["status"] = "completed"
        self._state["percent"] = 100.0
        self._write()

    def fail(self, error: str):
        """标记失败。"""
        self._state["status"] = "failed"
        self._state["error"] = error
        self._write()

    def _write(self):
        """原子写入进度文件（POSIX os.replace 保证原子性）。"""
        self._state["updated_at"] = time.time()
        self._last_write = self._state["updated_at"]
        tmp = self.progress_file.with_suffix(".tmp")
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self._state, f, ensure_ascii=False)
            os.replace(tmp, self.progress_file)
        except OSError:
            # 文件系统错误不应阻断主流程
            pass

    def _on_exit(self):
        """进程退出钩子：如果仍在 running 状态，标记为 failed。"""
        if self._state["status"] == "running":
            self.fail("Process exited unexpectedly")


class NullTracker:
    """CLI 模式下的空操作实现，零开销。所有方法均为 no-op。"""

    def set_stage(self, *args, **kwargs):
        pass

    def advance(self, *args, **kwargs):
        pass

    def set_substep(self, *args, **kwargs):
        pass

    def set_partial_failed(self, *args, **kwargs):
        pass

    def complete(self):
        pass

    def fail(self, *args):
        pass


def get_tracker(args, step_name: str):
    """工厂函数（用于有 argparse 的脚本）。

    Args:
        args: argparse.Namespace，需包含 .tracker 属性
        step_name: 步骤名称（如 "generate_draft"）

    Returns:
        ProgressTracker 或 NullTracker
    """
    run_id = getattr(args, "tracker", None)
    if run_id:
        return ProgressTracker(run_id, step_name)
    return NullTracker()


def get_tracker_from_argv(argv: list, step_name: str):
    """工厂函数（用于无 argparse 的脚本，兼容保留）。

    从 sys.argv 中查找 --tracker <run_id>，未找到则返回 NullTracker。
    推荐优先使用 get_tracker(args, step_name)（需脚本有 argparse）。

    Args:
        argv: sys.argv 列表
        step_name: 步骤名称

    Returns:
        ProgressTracker 或 NullTracker
    """
    try:
        idx = argv.index("--tracker")
        if idx + 1 < len(argv):
            return ProgressTracker(argv[idx + 1], step_name)
    except ValueError:
        pass
    return NullTracker()
