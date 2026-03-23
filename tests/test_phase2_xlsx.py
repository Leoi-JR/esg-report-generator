"""
tests/test_phase2_xlsx.py
=========================
阶段二 XLSX / XLS 提取专项测试。

运行方式：
    conda run -n esg python3 tests/test_phase2_xlsx.py

调试单个文件：
    conda run -n esg python3 tests/test_phase2_xlsx.py /path/to/file.xlsx [/output/dir]
"""

import os
import sys

# 将 src/ 加入 sys.path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from extractors import (
    extract_xlsx,
    extract_xls,
)

ROOT      = os.path.join(os.path.dirname(__file__), '..')
MOCK_DATA = os.path.join(ROOT, "data/processed/模拟甲方整理后资料")

# ---------------------------------------------------------------------------
# 测试用文件路径
# ---------------------------------------------------------------------------
XLSX_SIMPLE = os.path.join(
    MOCK_DATA,
    "A-总体概况/A7/清单.xlsx"
)
XLSX_COMPLEX = os.path.join(
    MOCK_DATA,
    "S-人权与社会/SD-安全生产/SD4/SD4、安全生产风险辨识与分级管控表.xlsx"
)
XLS_SAMPLE = os.path.join(
    MOCK_DATA,
    "D-产业价值/DC-产品质量与客户/DC5",
    "AS-QM-4-026 风险及机会识别及应对记录-2025.xls"
)
XLS_MULTI = os.path.join(
    MOCK_DATA,
    "E-环境保护/EB-污染物管控/EB10",
    "EB10：AS-PM-4-119环境因素识别评价表-1.xls"
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


# ==============================================================================
# extract_xlsx 测试（7 个）
# ==============================================================================

def test_extract_xlsx_returns_list():
    """extract_xlsx 应返回 list（即使文件为空也不抛出）。"""
    record = _make_file_record(XLSX_SIMPLE, folder_code="A7")
    chunks = extract_xlsx(record)
    assert isinstance(chunks, list), "extract_xlsx 应返回 list"
    print(f"  ✓ {os.path.basename(XLSX_SIMPLE)}: {len(chunks)} 个 chunk")


def test_extract_xlsx_has_chunks():
    """含正文内容的 xlsx 应提取出 ≥1 个有效 chunk。"""
    record = _make_file_record(XLSX_COMPLEX, folder_code="SD4")
    chunks = extract_xlsx(record)
    assert len(chunks) >= 1, f"期望 ≥1 个 chunk，实际 {len(chunks)}"
    print(f"  ✓ {os.path.basename(XLSX_COMPLEX)}: {len(chunks)} 个 chunk")


def test_extract_xlsx_chunk_fields():
    """每个 ChunkRecord 必须包含规定字段，且 char_count ≥ 0。"""
    record = _make_file_record(XLSX_COMPLEX, folder_code="SD4")
    chunks = extract_xlsx(record)
    assert len(chunks) >= 1, "无 chunk，跳过字段验证"

    required = {"chunk_id", "parent_id", "file_path", "file_name",
                "folder_code", "page_or_sheet", "chunk_index",
                "text", "parent_text", "char_count"}
    for c in chunks:
        missing = required - set(c.keys())
        assert not missing, f"chunk 缺少字段：{missing}"
        assert c["char_count"] >= 0, f"char_count 不能为负：{c['char_count']}"
        assert c["folder_code"] == "SD4", f"folder_code 应为 SD4，实际 {c['folder_code']}"
    print(f"  ✓ 字段验证通过（{len(chunks)} 个 chunk）")


def test_extract_xlsx_no_zero_char_count():
    """过滤后不应存在 char_count=0 的 chunk。"""
    record = _make_file_record(XLSX_COMPLEX, folder_code="SD4")
    chunks = extract_xlsx(record)
    zero_chunks = [c for c in chunks if c["char_count"] == 0]
    assert zero_chunks == [], (
        f"存在 {len(zero_chunks)} 个 char_count=0 的 chunk，"
        f"示例：{zero_chunks[0]['text'][:80]!r}"
    )
    print(f"  ✓ 无无效 chunk（char_count=0 为 0 个）")


def test_extract_xlsx_chunk_size_limit():
    """所有 chunk 的 text 长度应 ≤ max_size=800。"""
    record = _make_file_record(XLSX_COMPLEX, folder_code="SD4")
    chunks = extract_xlsx(record)
    over = [c for c in chunks if len(c["text"]) > 800]
    assert over == [], (
        f"存在 {len(over)} 个超过 800 字符的 chunk，"
        f"最大长度：{max(len(c['text']) for c in chunks)}"
    )
    print(f"  ✓ 所有 chunk ≤ 800 字符")


def test_extract_xlsx_chunk_id_unique():
    """所有 chunk_id 应唯一。"""
    record = _make_file_record(XLSX_COMPLEX, folder_code="SD4")
    chunks = extract_xlsx(record)
    ids = [c["chunk_id"] for c in chunks]
    assert len(ids) == len(set(ids)), "存在重复 chunk_id"
    print(f"  ✓ chunk_id 全部唯一（{len(ids)} 个）")


def test_extract_xlsx_invalid_path():
    """不存在的文件路径应返回空列表而不抛出异常。"""
    record = _make_file_record("/nonexistent/path/file.xlsx")
    chunks = extract_xlsx(record)
    assert chunks == [], f"期望空列表，实际 {len(chunks)} 个 chunk"
    print("  ✓ 无效路径优雅降级 → []")


# ==============================================================================
# extract_xls 测试（3 个）
# ==============================================================================

def test_extract_xls_returns_list():
    """extract_xls 应返回 list。"""
    record = _make_file_record(XLS_SAMPLE, folder_code="DC5")
    chunks = extract_xls(record)
    assert isinstance(chunks, list), "extract_xls 应返回 list"
    print(f"  ✓ {os.path.basename(XLS_SAMPLE)}: {len(chunks)} 个 chunk")


def test_extract_xls_has_chunks():
    """含正文内容的 xls 应提取出 ≥1 个有效 chunk。"""
    record = _make_file_record(XLS_SAMPLE, folder_code="DC5")
    chunks = extract_xls(record)
    assert len(chunks) >= 1, f"期望 ≥1 个 chunk，实际 {len(chunks)}"
    total_chars = sum(c["char_count"] for c in chunks)
    assert total_chars > 0, "总有效字符应 > 0"
    print(f"  ✓ {os.path.basename(XLS_SAMPLE)}: {len(chunks)} 个 chunk，"
          f"{total_chars} 有效字符")


def test_extract_xls_invalid_path():
    """不存在的 .xls 路径应返回空列表。"""
    record = _make_file_record("/nonexistent/path/file.xls")
    chunks = extract_xls(record)
    assert chunks == [], f"期望空列表，实际 {len(chunks)} 个 chunk"
    print("  ✓ .xls 无效路径优雅降级 → []")


# ==============================================================================
# 调试工具：inspect_xlsx
# ==============================================================================

def inspect_xlsx(file_path: str, save_dir: str | None = None):
    """
    调试工具：提取 xlsx/xls 并打印所有 chunk 摘要，同时保存完整文本到文件。
    输出格式与 inspect_docx / inspect_pdf 一致。

    用法：
        python3 tests/test_phase2_xlsx.py /path/to/file.xlsx [/output/dir]
    """
    import datetime

    ext = os.path.splitext(file_path)[1].lower()
    record = _make_file_record(file_path)

    if ext == ".xlsx":
        chunks = extract_xlsx(record)
        type_label = "xlsx"
    elif ext == ".xls":
        chunks = extract_xls(record)
        type_label = "xls"
    else:
        print(f"不支持的扩展名：{ext}")
        return

    # 确定输出路径
    if save_dir is None:
        save_dir = os.path.join(ROOT, "data/processed/pdf_inspect")
    os.makedirs(save_dir, exist_ok=True)
    stem     = os.path.splitext(os.path.basename(file_path))[0]
    out_path = os.path.join(save_dir, f"xlsx_inspect_{stem}.txt")

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
    out(f"类型：{type_label}")
    out()

    total_chars = sum(c["char_count"] for c in chunks)
    out(f"共 {len(chunks)} 个 chunk，合计 {total_chars} 有效字符")
    out()

    for c in chunks:
        # parent_id 格式：{relative_path}#{section_id}，取最后 # 后的 section_id
        section_id  = c["parent_id"].rsplit("#", 1)[-1] if "#" in c["parent_id"] else "?"
        header_line = (f"  [{c['chunk_id'].split('#')[-1]}] "
                       f"sheet={c['page_or_sheet']}  "
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

# 自动保存提取结果的文件列表
_INSPECT_FILES = [
    # xlsx：简单（3 sheet，A7 分类清单）
    XLSX_SIMPLE,
    # xlsx：复杂（单 sheet，207 行大表格）
    XLSX_COMPLEX,
    # xls：2 sheet（风险及机会识别）
    XLS_SAMPLE,
    # xls：9 sheet（含空 sheet，环境因素识别）
    XLS_MULTI,
]


def save_all_inspect_results():
    """测试完成后，对 _INSPECT_FILES 中每个文件调用 inspect_xlsx，保存提取结果。"""
    save_dir = os.path.join(ROOT, "data/processed/pdf_inspect")
    os.makedirs(save_dir, exist_ok=True)
    print(f"\n{'─'*50}")
    print(f"保存提取结果到：{save_dir}")
    for path in _INSPECT_FILES:
        if not os.path.exists(path):
            print(f"  [跳过] 文件不存在：{os.path.basename(path)}")
            continue
        inspect_xlsx(path, save_dir=save_dir)


def run_all_tests():
    tests = [
        # extract_xlsx
        test_extract_xlsx_returns_list,
        test_extract_xlsx_has_chunks,
        test_extract_xlsx_chunk_fields,
        test_extract_xlsx_no_zero_char_count,
        test_extract_xlsx_chunk_size_limit,
        test_extract_xlsx_chunk_id_unique,
        test_extract_xlsx_invalid_path,
        # extract_xls
        test_extract_xls_returns_list,
        test_extract_xls_has_chunks,
        test_extract_xls_invalid_path,
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
        inspect_xlsx(file_arg, save_dir=dir_arg)
    else:
        ok = run_all_tests()
        sys.exit(0 if ok else 1)
