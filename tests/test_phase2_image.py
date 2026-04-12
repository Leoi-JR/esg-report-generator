"""
tests/test_phase2_image.py
==========================
阶段二 JPG / PNG 图片提取专项测试。

由于 GLM-OCR 依赖 vLLM GPU 服务，测试环境中该服务通常不运行。
所有测试都按"服务不可用 → 优雅返回 []"的模式设计，不依赖 GLM-OCR 真正运行。
测试仅验证接口契约（不抛异常、返回正确类型、别名一致）。

运行方式：
    conda run -n esg python3 tests/test_phase2_image.py

调试单个文件：
    conda run -n esg python3 tests/test_phase2_image.py /path/to/file.jpg [/output/dir]
"""

import os
import sys

# 将 src/ 加入 sys.path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from extractors import (
    extract_image,
    extract_jpg,
    extract_jpeg,
    extract_png,
)

ROOT      = os.path.join(os.path.dirname(__file__), '..')
MOCK_DATA = os.path.join(ROOT, "data/processed/模拟甲方整理后资料")

# ---------------------------------------------------------------------------
# 测试用文件路径
# ---------------------------------------------------------------------------

# 典型 JPG：安全培训照片（预期含文字）
JPG_SAMPLE = os.path.join(
    MOCK_DATA,
    "S-人权与社会/SD-安全生产/SD14",
    "培训记录1.jpg"
)

# 唯一 PNG：有害物质检测频率截图
PNG_SAMPLE = os.path.join(
    MOCK_DATA,
    "D-产业价值/DC-产品质量与客户/DC10",
    "有害物质检测频率.png"
)


def _make_file_record(path: str, folder_code: str | None = None) -> dict:
    """构造最小 FileRecord，供提取函数使用。"""
    return {
        "file_path":     path,
        "file_name":     os.path.basename(path),
        "relative_path": os.path.relpath(path, MOCK_DATA),
        "folder_code":   folder_code,
        "extension":     os.path.splitext(path)[1].lower(),
    }


def _get_chunks(result) -> list:
    """从提取函数返回值中取出 chunks 列表。
    新版返回 dict{"chunks": [...], "parents": {...}}，旧版返回 list。
    错误时返回 []（空列表）。"""
    return result["chunks"] if isinstance(result, dict) else result


# ==============================================================================
# 测试函数（5 个）
# ==============================================================================

def test_extract_image_returns_list():
    """
    extract_image 应返回 list，不抛出异常。
    GLM-OCR 不可用时返回 []（打印警告），可用时返回 ≥0 个 chunk。
    """
    record = _make_file_record(JPG_SAMPLE, folder_code="SD14")
    result = extract_image(record)
    chunks = _get_chunks(result)
    assert isinstance(chunks, list), "extract_image 应返回 list"
    print(f"  ✓ {os.path.basename(JPG_SAMPLE)}: 返回 list（{len(chunks)} 个 chunk）"
          + ("，GLM-OCR 不可用 → []" if len(chunks) == 0 else ""))


def test_extract_image_invalid_path():
    """不存在的文件路径应返回空列表而不抛出异常。"""
    record = _make_file_record("/nonexistent/path/file.jpg")
    result = extract_image(record)
    chunks = _get_chunks(result)
    assert chunks == [], f"期望空列表，实际 {len(chunks)} 个 chunk"
    print("  ✓ 无效路径优雅降级 → []")


def test_extract_image_invalid_format():
    """非图片文件（如 .txt）传入应返回空列表而不抛出异常。"""
    # 构造一个扩展名为 .txt 的文件 record（文件可以不存在，Pillow 会抛出异常被捕获）
    record = _make_file_record("/nonexistent/path/not_an_image.txt")
    result = extract_image(record)
    chunks = _get_chunks(result)
    assert chunks == [], f"期望空列表，实际 {len(chunks)} 个 chunk"
    print("  ✓ 非图片格式优雅降级 → []")


def test_extract_jpg_alias():
    """extract_jpg 应与 extract_image 是同一对象（别名验证）。"""
    assert extract_jpg is extract_image, (
        f"extract_jpg 应是 extract_image 的别名，"
        f"实际：extract_jpg={extract_jpg}, extract_image={extract_image}"
    )
    print("  ✓ extract_jpg is extract_image → True")


def test_extract_png_alias():
    """extract_png 应与 extract_image 是同一对象（别名验证）。"""
    assert extract_png is extract_image, (
        f"extract_png 应是 extract_image 的别名，"
        f"实际：extract_png={extract_png}, extract_image={extract_image}"
    )
    print("  ✓ extract_png is extract_image → True")


# ==============================================================================
# 调试工具：inspect_image
# ==============================================================================

def inspect_image(file_path: str, save_dir: str | None = None):
    """
    调试工具：提取 jpg/jpeg/png 并打印所有 chunk 摘要，同时保存完整文本到文件。
    输出格式与 inspect_pptx / inspect_xlsx 一致。

    GLM-OCR 服务可用时，可用此工具人工核查 OCR 提取效果。

    用法：
        python3 tests/test_phase2_image.py /path/to/file.jpg [/output/dir]
    """
    import datetime

    record = _make_file_record(file_path)
    result = extract_image(record)
    chunks = _get_chunks(result)

    # 确定输出路径
    if save_dir is None:
        save_dir = os.path.join(ROOT, "data/processed/pdf_inspect")
    os.makedirs(save_dir, exist_ok=True)
    stem     = os.path.splitext(os.path.basename(file_path))[0]
    out_path = os.path.join(save_dir, f"image_inspect_{stem}.txt")

    screen_lines: list[str] = []
    file_lines:   list[str] = []

    def out(screen_s: str = "", file_s: str | None = None):
        """同时追加到终端缓冲和文件缓冲；file_s 为 None 时与 screen_s 相同。"""
        print(screen_s)
        screen_lines.append(screen_s)
        file_lines.append(file_s if file_s is not None else screen_s)

    divider = "─" * 60
    out(divider)
    out(f"文件：{os.path.basename(file_path)}")
    out(f"路径：{file_path}")
    out(f"时间：{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    out(divider)
    out(f"类型：image（整图 OCR）")
    out()

    total_chars = sum(c["char_count"] for c in chunks)
    out(f"共 {len(chunks)} 个 chunk，合计 {total_chars} 有效字符")
    out()

    for c in chunks:
        # parent_id 格式：{relative_path}#{section_id}，取最后 # 后的 section_id
        section_id  = c["parent_id"].rsplit("#", 1)[-1] if "#" in c["parent_id"] else "?"
        header_line = (f"  [{c['chunk_id'].split('#')[-1]}] "
                       f"page={c['page_or_sheet']}  "
                       f"chars={c['char_count']}  "
                       f"parent={section_id}")

        text_full = c["text"]

        # 终端：显示前 300 字，超出则提示
        preview     = text_full[:300].replace("\n", "↵")
        screen_text = f"  {preview}"
        if len(text_full) > 300:
            screen_text += f"\n  ... （共 {len(text_full)} 字符）"

        # 文件：完整文本，换行符保留
        file_text = f"  {text_full}"

        out(header_line)
        out(screen_text, file_s=file_text)
        out()

    # 写入完整文本到文件
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(file_lines))
    print(f"\n[已保存] {out_path}")


# ==============================================================================
# 测试运行器
# ==============================================================================

# 自动保存提取结果的文件列表（GLM-OCR 可用时，供人工核查 OCR 效果）
_INSPECT_FILES = [
    JPG_SAMPLE,   # 安全培训照片（SD14）
    PNG_SAMPLE,   # 有害物质检测频率截图（DC10）
]


def save_all_inspect_results():
    """测试完成后，对 _INSPECT_FILES 中每个文件调用 inspect_image，保存提取结果。"""
    save_dir = os.path.join(ROOT, "data/processed/pdf_inspect")
    os.makedirs(save_dir, exist_ok=True)
    print(f"\n{'─'*50}")
    print(f"保存提取结果到：{save_dir}")
    for path in _INSPECT_FILES:
        if not os.path.exists(path):
            print(f"  [跳过] 文件不存在：{os.path.basename(path)}")
            continue
        inspect_image(path, save_dir=save_dir)


def run_all_tests():
    tests = [
        test_extract_image_returns_list,
        test_extract_image_invalid_path,
        test_extract_image_invalid_format,
        test_extract_jpg_alias,
        test_extract_png_alias,
    ]

    passed = failed = 0
    for t in tests:
        name = t.__name__
        try:
            print(f"\n{name}")
            t()
            passed += 1
        except Exception as e:
            print(f"  ✗ FAIL: {e}")
            failed += 1

    print(f"\n{'='*50}")
    print(f"结果：{passed} 通过 / {failed} 失败 / {len(tests)} 总计")

    # 无论通过与否，都保存提取结果供开发者检查
    save_all_inspect_results()

    return failed == 0


if __name__ == "__main__":
    if len(sys.argv) >= 2:
        # 调试模式：inspect 单个文件
        file_arg = sys.argv[1]
        dir_arg  = sys.argv[2] if len(sys.argv) >= 3 else None
        inspect_image(file_arg, save_dir=dir_arg)
    else:
        ok = run_all_tests()
        sys.exit(0 if ok else 1)
