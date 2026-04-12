"""
stage_timer.py
==============
流水线阶段耗时统计器（CLI 输出用）。

在各主脚本的 main() 中使用：

    from stage_timer import StageTimer
    timer = StageTimer()

    timer.start("阶段一：加载清单映射")
    ...
    timer.start("阶段 2a：文本提取")
    ...
    timer.report()   # 打印耗时汇总表

设计特点：
  - 独立于 ProgressTracker（Web UI 用），互不干扰
  - start() 自动结束上一个阶段计时，调用方只需在每阶段开头调一次
  - report() 打印各阶段耗时 + 占比 + 总计
  - 零外部依赖（仅用 time 标准库）
"""

import time


def _fmt(seconds: float) -> str:
    """将秒数格式化为人类可读字符串。

    Examples:
        _fmt(3.2)   → '3.2s'
        _fmt(75.0)  → '1m15s'
        _fmt(3661)  → '61m1s'
    """
    if seconds < 60:
        return f"{seconds:.1f}s"
    m, s = divmod(seconds, 60)
    return f"{int(m)}m{s:.0f}s"


class StageTimer:
    """流水线阶段耗时统计器。

    用法：
        timer = StageTimer()
        timer.start("阶段一")
        do_phase1()
        timer.start("阶段二")   # 自动结束阶段一
        do_phase2()
        timer.report()          # 自动结束阶段二 + 打印汇总
    """

    def __init__(self):
        self._stages: list[tuple[str, float]] = []  # [(name, elapsed), ...]
        self._current: tuple[str, float] | None = None  # (name, start_time)
        self._t0 = time.time()

    def start(self, name: str):
        """开始计时一个新阶段（自动结束上一个）。"""
        self.stop()
        self._current = (name, time.time())

    def stop(self):
        """结束当前阶段计时，记录耗时。"""
        if self._current:
            name, t_start = self._current
            self._stages.append((name, time.time() - t_start))
            self._current = None

    def report(self):
        """打印耗时汇总表（各阶段耗时 + 占总耗时百分比）。"""
        self.stop()
        total = time.time() - self._t0

        print(f"\n{'═' * 60}")
        print(f"  耗时统计")
        print(f"{'─' * 60}")
        for name, elapsed in self._stages:
            pct = elapsed / total * 100 if total > 0 else 0
            print(f"  {name:<30s}  {_fmt(elapsed):>10s}  ({pct:5.1f}%)")
        print(f"{'─' * 60}")
        print(f"  {'总计':<30s}  {_fmt(total):>10s}")
        print(f"{'═' * 60}")
