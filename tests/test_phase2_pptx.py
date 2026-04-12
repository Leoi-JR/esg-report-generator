"""
tests/test_phase2_pptx.py
=========================
阶段二 PPTX / PPT 提取专项测试。

运行方式：
    conda run -n esg python3 tests/test_phase2_pptx.py

调试单个文件：
    conda run -n esg python3 tests/test_phase2_pptx.py /path/to/file.pptx [/output/dir]
"""

import os
import sys

# 将 src/ 加入 sys.path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from extractors import (
    extract_pptx,
    extract_ppt,
)

ROOT      = os.path.join(os.path.dirname(__file__), '..')
MOCK_DATA = os.path.join(ROOT, "data/processed/模拟甲方整理后资料")

# ---------------------------------------------------------------------------
# 测试用文件路径
# ---------------------------------------------------------------------------
PPTX_SAMPLE = os.path.join(
    MOCK_DATA,
    "G-公司治理/GB-规范治理与党建/GB1",
    "ESG报告 GB1-3 江苏艾森半导体党建引领.pptx"
)
PPT_SAMPLE = os.path.join(
    MOCK_DATA,
    "E-环境保护/EB-污染物管控/EB3",
    "EB3：危废管理.ppt"
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
# extract_pptx 测试（6 个）
# ==============================================================================

def test_extract_pptx_returns_list():
    """extract_pptx 应返回 list（即使文件为空也不抛出）。"""
    record = _make_file_record(PPTX_SAMPLE, folder_code="GB1")
    result = extract_pptx(record)
    chunks = _get_chunks(result)
    assert isinstance(chunks, list), "extract_pptx 应返回 list"
    print(f"  ✓ {os.path.basename(PPTX_SAMPLE)}: {len(chunks)} 个 chunk")


def test_extract_pptx_has_chunks():
    """含正文内容的 pptx 应提取出 ≥1 个有效 chunk。"""
    record = _make_file_record(PPTX_SAMPLE, folder_code="GB1")
    result = extract_pptx(record)
    chunks = _get_chunks(result)
    assert len(chunks) >= 1, f"期望 ≥1 个 chunk，实际 {len(chunks)}"
    total_chars = sum(c["char_count"] for c in chunks)
    assert total_chars > 0, "总有效字符应 > 0"
    print(f"  ✓ {os.path.basename(PPTX_SAMPLE)}: {len(chunks)} 个 chunk，"
          f"{total_chars} 有效字符")


def test_extract_pptx_chunk_fields():
    """每个 ChunkRecord 必须包含规定字段，且 char_count ≥ 0。"""
    record = _make_file_record(PPTX_SAMPLE, folder_code="GB1")
    result = extract_pptx(record)
    chunks = _get_chunks(result)
    assert len(chunks) >= 1, "无 chunk，跳过字段验证"

    required = {"chunk_id", "parent_id", "file_path", "file_name",
                "folder_code", "page_or_sheet",
                "text", "char_count"}
    for c in chunks:
        missing = required - set(c.keys())
        assert not missing, f"chunk 缺少字段：{missing}"
        assert c["char_count"] >= 0, f"char_count 不能为负：{c['char_count']}"
        assert c["folder_code"] == "GB1", f"folder_code 应为 GB1，实际 {c['folder_code']}"
    print(f"  ✓ 字段验证通过（{len(chunks)} 个 chunk）")


def test_extract_pptx_no_zero_char_count():
    """过滤后不应存在 char_count=0 的 chunk。"""
    record = _make_file_record(PPTX_SAMPLE, folder_code="GB1")
    result = extract_pptx(record)
    chunks = _get_chunks(result)
    zero_chunks = [c for c in chunks if c["char_count"] == 0]
    assert zero_chunks == [], (
        f"存在 {len(zero_chunks)} 个 char_count=0 的 chunk，"
        f"示例：{zero_chunks[0]['text'][:80]!r}"
    )
    print(f"  ✓ 无无效 chunk（char_count=0 为 0 个）")


def test_extract_pptx_chunk_size_limit():
    """所有 chunk 的 text 长度应 ≤ max_size=800。"""
    record = _make_file_record(PPTX_SAMPLE, folder_code="GB1")
    result = extract_pptx(record)
    chunks = _get_chunks(result)
    over = [c for c in chunks if len(c["text"]) > 800]
    assert over == [], (
        f"存在 {len(over)} 个超过 800 字符的 chunk，"
        f"最大长度：{max(len(c['text']) for c in chunks)}"
    )
    print(f"  ✓ 所有 chunk ≤ 800 字符")


def test_extract_pptx_invalid_path():
    """不存在的文件路径应返回空列表而不抛出异常。"""
    record = _make_file_record("/nonexistent/path/file.pptx")
    result = extract_pptx(record)
    chunks = _get_chunks(result)
    assert chunks == [], f"期望空列表，实际 {len(chunks)} 个 chunk"
    print("  ✓ 无效路径优雅降级 → []")


# ==============================================================================
# extract_ppt 测试（3 个）
# ==============================================================================

def test_extract_ppt_returns_list():
    """extract_ppt 应返回 list（不论 soffice 是否可用）。"""
    import shutil
    record = _make_file_record(PPT_SAMPLE, folder_code="EB3")
    result = extract_ppt(record)
    chunks = _get_chunks(result)
    assert isinstance(chunks, list), "extract_ppt 应返回 list"

    if shutil.which("soffice"):
        print(f"  ✓ soffice 可用，{os.path.basename(PPT_SAMPLE)}: {len(chunks)} 个 chunk")
    else:
        assert chunks == [], "soffice 不可用时应返回 []"
        print("  ✓ soffice 不可用 → 优雅降级 → []")


def test_extract_ppt_has_content():
    """若 soffice 可用且能转换 .ppt，应提取出 ≥1 个有效 chunk。"""
    import shutil
    if not shutil.which("soffice"):
        print("  ⏭ 跳过（soffice 不可用）")
        return

    # 尝试转换；若 libreoffice-impress 未安装则转换失败，返回 None → 跳过
    from extractors import convert_ppt_to_pptx
    pptx_path = convert_ppt_to_pptx(PPT_SAMPLE)
    if pptx_path is None:
        print("  ⏭ 跳过（soffice 存在但 .ppt 转换失败，可能缺少 libreoffice-impress）")
        return

    record = _make_file_record(PPT_SAMPLE, folder_code="EB3")
    result = extract_ppt(record)
    chunks = _get_chunks(result)
    assert len(chunks) >= 1, f"期望 ≥1 个 chunk，实际 {len(chunks)}"
    total_chars = sum(c["char_count"] for c in chunks)
    assert total_chars > 0, "总有效字符应 > 0"
    print(f"  ✓ {os.path.basename(PPT_SAMPLE)}: {len(chunks)} 个 chunk，"
          f"{total_chars} 有效字符")


def test_extract_ppt_invalid_path():
    """不存在的 .ppt 路径应返回空列表。"""
    record = _make_file_record("/nonexistent/path/file.ppt")
    result = extract_ppt(record)
    chunks = _get_chunks(result)
    assert chunks == [], f"期望空列表，实际 {len(chunks)} 个 chunk"
    print("  ✓ .ppt 无效路径优雅降级 → []")


# ==============================================================================
# 调试工具：inspect_pptx
# ==============================================================================

def inspect_pptx(file_path: str, save_dir: str | None = None):
    """
    调试工具：提取 pptx/ppt 并打印所有 chunk 摘要，同时保存完整文本到文件。
    输出格式与 inspect_docx / inspect_xlsx 一致。

    用法：
        python3 tests/test_phase2_pptx.py /path/to/file.pptx [/output/dir]
    """
    import datetime

    ext = os.path.splitext(file_path)[1].lower()
    record = _make_file_record(file_path)

    if ext == ".pptx":
        result = extract_pptx(record)
        chunks = _get_chunks(result)
        type_label = "pptx"
    elif ext == ".ppt":
        result = extract_ppt(record)
        chunks = _get_chunks(result)
        type_label = "ppt"
    else:
        print(f"不支持的扩展名：{ext}")
        return

    # 确定输出路径
    if save_dir is None:
        save_dir = os.path.join(ROOT, "data/processed/pdf_inspect")
    os.makedirs(save_dir, exist_ok=True)
    stem     = os.path.splitext(os.path.basename(file_path))[0]
    out_path = os.path.join(save_dir, f"pptx_inspect_{stem}.txt")

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
                       f"slide={c['page_or_sheet']}  "
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
    # pptx：138 MB，图文丰富
    PPTX_SAMPLE,
    # ppt：1.1 MB，文本为主（需 soffice）
    PPT_SAMPLE,
]


def save_all_inspect_results():
    """测试完成后，对 _INSPECT_FILES 中每个文件调用 inspect_pptx，保存提取结果。"""
    save_dir = os.path.join(ROOT, "data/processed/pdf_inspect")
    os.makedirs(save_dir, exist_ok=True)
    print(f"\n{'─'*50}")
    print(f"保存提取结果到：{save_dir}")
    for path in _INSPECT_FILES:
        if not os.path.exists(path):
            print(f"  [跳过] 文件不存在：{os.path.basename(path)}")
            continue
        inspect_pptx(path, save_dir=save_dir)


def run_all_tests():
    tests = [
        # extract_pptx
        test_extract_pptx_returns_list,
        test_extract_pptx_has_chunks,
        test_extract_pptx_chunk_fields,
        test_extract_pptx_no_zero_char_count,
        test_extract_pptx_chunk_size_limit,
        test_extract_pptx_invalid_path,
        # extract_ppt
        test_extract_ppt_returns_list,
        test_extract_ppt_has_content,
        test_extract_ppt_invalid_path,
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
        inspect_pptx(file_arg, save_dir=dir_arg)
    else:
        ok = run_all_tests()
        sys.exit(0 if ok else 1)
