"""
describe_image.py
=================
使用 DashScope qwen3-vl-plus 对指定图片进行描述的实验脚本。

功能：
  - 支持单张图片或批量目录
  - 支持自定义 Prompt（命令行参数或交互输入）
  - 自动 Resize（边长 ≤ 1024px）后发送，节省 Token
  - 结果同时输出到控制台和 results/describe_results.json
  - 支持多轮对话（--chat 模式）

运行方式（在项目根目录）：
  # 单张图片，使用默认 Prompt
  conda run -n esg python3 experiments/vlm/describe_image.py --file path/to/image.png

  # 单张图片，自定义 Prompt
  conda run -n esg python3 experiments/vlm/describe_image.py --file path/to/image.png \\
      --prompt "请详细描述图中的组织架构关系"

  # 批量处理目录下所有图片（jpg/png）
  conda run -n esg python3 experiments/vlm/describe_image.py --dir path/to/images/

  # 多轮对话模式（针对单张图片持续追问）
  conda run -n esg python3 experiments/vlm/describe_image.py --file path/to/image.png --chat

  # 指定输出文件
  conda run -n esg python3 experiments/vlm/describe_image.py --file path/to/image.png \\
      --output results/my_result.json
"""

import argparse
import base64
import json
import os
import sys
import time
from pathlib import Path

# ── 路径配置 ──────────────────────────────────────────────────────────────────
SCRIPT_DIR   = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent
RESULTS_DIR  = SCRIPT_DIR / "results"

# ── 环境变量加载 ───────────────────────────────────────────────────────────────
def _load_env() -> None:
    """从项目根目录的 .env 文件加载环境变量（仅补充未设置的变量）。"""
    env_path = PROJECT_ROOT / ".env"
    if not env_path.exists():
        return
    with open(env_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = val

_load_env()

# ── 配置 ───────────────────────────────────────────────────────────────────────
DASHSCOPE_API_KEY = os.environ.get("DASHSCOPE_API_KEY", "")
VLM_MODEL         = os.environ.get("VLM_MODEL", "qwen3-vl-plus")
VLM_MAX_IMAGE_PX  = int(os.environ.get("VLM_MAX_IMAGE_PX", "1024"))
API_MAX_RETRIES   = int(os.environ.get("API_MAX_RETRIES", "3"))
API_RETRY_BASE_DELAY = float(os.environ.get("API_RETRY_BASE_DELAY", "2.0"))

# 支持的图片格式
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"}

# 默认 Prompt
DEFAULT_PROMPT = "请详细描述这张图片的内容。"


# ==============================================================================
# 图片预处理（Resize + 转 PNG）
# ==============================================================================

def prepare_image(img_path: Path) -> bytes:
    """
    读取图片，Resize 到 ≤ VLM_MAX_IMAGE_PX 边长，返回 PNG 字节流。
    保持宽高比，不放大。
    """
    try:
        from PIL import Image as PILImage
        import io

        with PILImage.open(str(img_path)) as im:
            im = im.convert("RGB")
            w, h = im.size

            # 等比缩放，最长边 ≤ VLM_MAX_IMAGE_PX
            if max(w, h) > VLM_MAX_IMAGE_PX:
                ratio = VLM_MAX_IMAGE_PX / max(w, h)
                new_w = int(w * ratio)
                new_h = int(h * ratio)
                im = im.resize((new_w, new_h), PILImage.LANCZOS)

            buf = io.BytesIO()
            im.save(buf, format="PNG")
            return buf.getvalue()

    except ImportError:
        # Pillow 不可用，直接读取原始字节（不 Resize）
        print("  [提示] Pillow 未安装，跳过 Resize，直接发送原始图片")
        with open(img_path, "rb") as f:
            return f.read()
    except Exception as e:
        raise RuntimeError(f"图片处理失败 {img_path.name}：{e}") from e


# ==============================================================================
# VLM 调用
# ==============================================================================

def call_vlm(img_bytes: bytes, prompt: str, history: list | None = None) -> str:
    """
    调用 DashScope qwen3-vl-plus，返回模型回复文本。

    参数:
        img_bytes : PNG 格式图片字节流
        prompt    : 用户提问
        history   : 多轮对话历史，格式为 [{"role": "user"/"assistant", "content": ...}, ...]
                    注意：图片仅在第一轮 (history 为空时) 附带

    返回:
        str  模型回复文本，失败时抛出 RuntimeError
    """
    if not DASHSCOPE_API_KEY:
        raise RuntimeError("DASHSCOPE_API_KEY 未配置，请在 .env 文件或环境变量中设置")

    from dashscope import MultiModalConversation

    data_uri = "data:image/png;base64," + base64.b64encode(img_bytes).decode()

    # 构造消息列表
    messages = list(history or [])

    if not messages:
        # 第一轮：图片 + 文字一起发
        messages.append({
            "role": "user",
            "content": [
                {"image": data_uri},
                {"text": prompt},
            ],
        })
    else:
        # 后续轮次：仅发文字（图片已在首轮上下文中）
        messages.append({
            "role": "user",
            "content": [{"text": prompt}],
        })

    last_error = None
    for attempt in range(API_MAX_RETRIES):
        try:
            response = MultiModalConversation.call(
                api_key=DASHSCOPE_API_KEY,
                model=VLM_MODEL,
                messages=messages,
                enable_thinking=False,
            )

            # 提取回复文本
            raw = ""
            if hasattr(response, "output") and response.output:
                choices = response.output.get("choices", [])
                if choices:
                    content = choices[0].get("message", {}).get("content", [])
                    if isinstance(content, list) and content:
                        raw = content[0].get("text", "")
                    elif isinstance(content, str):
                        raw = content

            if raw:
                return raw.strip()

            # 空回复 → 重试
            wait = API_RETRY_BASE_DELAY * (2 ** attempt)
            if attempt < API_MAX_RETRIES - 1:
                print(f"  [警告] 第 {attempt + 1} 次返回空内容，{wait:.0f}s 后重试…")
                time.sleep(wait)

        except Exception as e:
            last_error = e
            wait = API_RETRY_BASE_DELAY * (2 ** attempt)
            if attempt < API_MAX_RETRIES - 1:
                print(f"  [警告] 第 {attempt + 1} 次调用失败：{e}，{wait:.0f}s 后重试…")
                time.sleep(wait)

    raise RuntimeError(
        f"VLM 调用失败（已重试 {API_MAX_RETRIES} 次）："
        f"{last_error or '返回空内容'}"
    )


# ==============================================================================
# 单张图片处理
# ==============================================================================

def describe_single(img_path: Path, prompt: str) -> dict:
    """
    对单张图片调用 VLM，返回结果 dict。

    返回:
        {
            "file":        str,   # 相对路径（或绝对路径）
            "prompt":      str,
            "description": str,
            "model":       str,
            "error":       str,   # 正常为空
        }
    """
    # 尝试转换为相对路径，便于输出
    try:
        rel = str(img_path.relative_to(PROJECT_ROOT))
    except ValueError:
        rel = str(img_path)

    print(f"\n{'─' * 60}")
    print(f"  图片: {img_path.name}")
    print(f"  路径: {rel}")
    print(f"  模型: {VLM_MODEL}")
    print(f"  Prompt: {prompt[:80]}{'…' if len(prompt) > 80 else ''}")
    print(f"{'─' * 60}")

    try:
        img_bytes = prepare_image(img_path)
        t0        = time.time()
        desc      = call_vlm(img_bytes, prompt)
        elapsed   = time.time() - t0

        print(f"\n【模型回复】（{elapsed:.1f}s）\n")
        print(desc)
        print()

        return {
            "file":        rel,
            "prompt":      prompt,
            "description": desc,
            "model":       VLM_MODEL,
            "error":       "",
        }

    except Exception as e:
        print(f"\n  [错误] {e}\n")
        return {
            "file":        rel,
            "prompt":      prompt,
            "description": "",
            "model":       VLM_MODEL,
            "error":       str(e),
        }


# ==============================================================================
# 多轮对话模式
# ==============================================================================

def chat_mode(img_path: Path, first_prompt: str) -> None:
    """
    针对单张图片的多轮对话交互，直到用户输入 /exit 或 Ctrl+C 退出。
    """
    print(f"\n{'═' * 60}")
    print(f"  多轮对话模式  |  图片: {img_path.name}")
    print(f"  模型: {VLM_MODEL}")
    print(f"  输入 /exit 或按 Ctrl+C 退出")
    print(f"{'═' * 60}")

    try:
        img_bytes = prepare_image(img_path)
    except Exception as e:
        print(f"[错误] 图片处理失败：{e}")
        return

    history: list = []
    prompt  = first_prompt

    while True:
        if not prompt.strip():
            try:
                prompt = input("\n请输入 Prompt（/exit 退出）：").strip()
            except (EOFError, KeyboardInterrupt):
                print("\n已退出。")
                break

        if prompt.lower() in ("/exit", "exit", "quit", "q"):
            print("已退出多轮对话。")
            break

        print(f"\n[你] {prompt}")
        print(f"[{VLM_MODEL}] 思考中…", end="", flush=True)

        try:
            t0   = time.time()
            resp = call_vlm(img_bytes, prompt, history=history)
            elapsed = time.time() - t0

            # 更新历史（图片仅在首轮，后续轮次不重复）
            if not history:
                history.append({
                    "role": "user",
                    "content": [
                        {"image": "data:image/png;base64,..."},  # 占位，实际 call_vlm 处理
                        {"text": prompt},
                    ],
                })
            else:
                history.append({
                    "role": "user",
                    "content": [{"text": prompt}],
                })
            history.append({
                "role": "assistant",
                "content": [{"text": resp}],
            })

            print(f"\r[{VLM_MODEL}]（{elapsed:.1f}s）\n")
            print(resp)

        except Exception as e:
            print(f"\r[错误] {e}")

        prompt = ""  # 清空，等待下一次用户输入


# ==============================================================================
# 主流程
# ==============================================================================

def collect_images(dir_path: Path, limit: int | None) -> list[Path]:
    """递归收集目录下的图片文件。"""
    imgs = sorted(
        p for p in dir_path.rglob("*")
        if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES
    )
    if limit:
        imgs = imgs[:limit]
    return imgs


def save_results(results: list, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    try:
        rel = str(output_path.relative_to(PROJECT_ROOT))
    except ValueError:
        rel = str(output_path)
    print(f"结果已保存：{rel}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=f"使用 {VLM_MODEL} 描述图片内容",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    # 输入来源（互斥）
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument(
        "--file", "-f", type=str,
        help="单张图片路径（绝对路径或相对于项目根目录）",
    )
    source.add_argument(
        "--dir", "-d", type=str,
        help="批量模式：指定图片目录，递归收集所有 jpg/png",
    )

    # Prompt
    parser.add_argument(
        "--prompt", "-p", type=str, default=None,
        help=f"自定义 Prompt（默认：{DEFAULT_PROMPT!r}）",
    )

    # 模式
    parser.add_argument(
        "--chat", action="store_true",
        help="多轮对话模式（仅 --file 单张图片时有效）",
    )

    # 批量限制
    parser.add_argument(
        "--limit", type=int, default=None,
        help="批量模式：最多处理 N 张图片",
    )

    # 输出
    parser.add_argument(
        "--output", "-o", type=str, default=None,
        help="结果 JSON 输出路径（默认：experiments/vlm/results/describe_results.json）",
    )

    args = parser.parse_args()

    # 确定 Prompt
    prompt = args.prompt or DEFAULT_PROMPT

    # 确定输出路径
    output_path = Path(args.output) if args.output else RESULTS_DIR / "describe_results.json"
    if not output_path.is_absolute():
        output_path = PROJECT_ROOT / output_path

    # ── 单文件模式 ─────────────────────────────────────────────────────────────
    if args.file:
        img_path = Path(args.file)
        if not img_path.is_absolute():
            img_path = PROJECT_ROOT / img_path
        if not img_path.exists():
            print(f"[ERROR] 文件不存在：{img_path}")
            sys.exit(1)

        if args.chat:
            # 多轮对话
            chat_mode(img_path, prompt)
            return

        # 单次描述
        result = describe_single(img_path, prompt)
        save_results([result], output_path)
        return

    # ── 批量模式 ───────────────────────────────────────────────────────────────
    dir_path = Path(args.dir)
    if not dir_path.is_absolute():
        dir_path = PROJECT_ROOT / dir_path
    if not dir_path.exists() or not dir_path.is_dir():
        print(f"[ERROR] 目录不存在：{dir_path}")
        sys.exit(1)

    imgs = collect_images(dir_path, args.limit)
    if not imgs:
        print(f"[WARN] 目录下未找到图片（{', '.join(IMAGE_SUFFIXES)}）：{dir_path}")
        sys.exit(0)

    print(f"\n{'═' * 60}")
    print(f"  批量模式  |  目录: {dir_path.name}  |  共 {len(imgs)} 张图片")
    print(f"  模型: {VLM_MODEL}")
    print(f"  Prompt: {prompt[:80]}{'…' if len(prompt) > 80 else ''}")
    print(f"{'═' * 60}")

    all_results = []
    for i, img_path in enumerate(imgs, 1):
        print(f"\n[{i}/{len(imgs)}]", end="")
        result = describe_single(img_path, prompt)
        all_results.append(result)

    # 统计
    ok  = sum(1 for r in all_results if not r["error"])
    err = len(all_results) - ok
    print(f"\n{'─' * 60}")
    print(f"  完成：{ok} 成功 / {err} 失败 / 共 {len(all_results)} 张")

    save_results(all_results, output_path)


if __name__ == "__main__":
    main()
