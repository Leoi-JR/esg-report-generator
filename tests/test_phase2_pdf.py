"""
tests/test_phase2_pdf.py
========================
阶段二 PDF 提取专项测试。

运行方式：
    conda run -n esg python3 tests/test_phase2_pdf.py
"""

import os
import sys

# 将 src/ 加入 sys.path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

# 阶段二函数现在在 extractors.py 中
from extractors import (
    classify_pdf_v2,
    extract_pdf,
    count_meaningful_chars,
    recursive_split,
    make_chunks_from_sections,
)

ROOT = os.path.join(os.path.dirname(__file__), '..')
MOCK_DATA = os.path.join(ROOT, "data/processed/模拟甲方整理后资料")


# ==============================================================================
# 步骤 2-0：基础设施测试
# ==============================================================================

def test_count_meaningful_chars():
    """乱码过滤：只统计中文、英文、数字"""
    # "Hello"=5 + "你好"=2 + "123"=3 = 10（空格不计入）
    assert count_meaningful_chars("Hello 你好 123") == 10
    # 空字符串
    assert count_meaningful_chars("") == 0
    # 纯私有区 Unicode（扫描件常见乱码，如 \uf001 等）不计入
    assert count_meaningful_chars("\uf001\uf002\uf003") == 0
    # 扩展 CJK（\u3400-\u4dbf）也计入
    assert count_meaningful_chars("\u3400") == 1
    # 标点符号不计入
    assert count_meaningful_chars("。，！？……") == 0
    # 混合：中文 + 标点 + 空格，只统计中文（6 个汉字：第一章第二章）
    assert count_meaningful_chars("第一章。 第二章！") == 6


def test_recursive_split_basic():
    """基础分块：段落边界优先"""
    text = "第一段内容。\n\n第二段内容。\n\n第三段内容。"
    chunks = recursive_split(text, max_size=20, min_size=5)
    assert len(chunks) >= 2, f"期望 ≥2 个 chunk，实际 {len(chunks)}"
    assert all(len(c) <= 20 for c in chunks), \
        f"存在超过 max_size 的 chunk：{[len(c) for c in chunks]}"


def test_recursive_split_no_separator():
    """无分隔符时按字符切"""
    text = "a" * 100
    chunks = recursive_split(text, max_size=30, min_size=5)
    assert all(len(c) <= 30 for c in chunks), \
        f"存在超过 max_size 的 chunk：{[len(c) for c in chunks]}"
    # 重组应得到原文
    assert "".join(chunks) == text


def test_recursive_split_merge_small():
    """相邻过小片段应被合并"""
    # 每段都只有 3 个字符，远小于 min_size=10，应合并
    text = "ab\n\ncd\n\nef\n\ngh"
    chunks = recursive_split(text, max_size=50, min_size=10)
    # 合并后不应有大量单独的 2~3 字符碎片
    short_chunks = [c for c in chunks if len(c) < 10]
    # 允许最后一个未能合并的短片段（奇数段情况），但不能大量存在
    assert len(short_chunks) <= 1, \
        f"过小 chunk 数量过多（{len(short_chunks)}）：{chunks}"


def test_make_chunks_from_sections_fields():
    """make_chunks_from_sections 输出字段完整性"""
    sections = [
        {"section_id": "p1", "page_or_sheet": "1", "text": "这是第一节的内容，包含足够的文字。" * 3},
        {"section_id": "p2", "page_or_sheet": "2", "text": ""},
    ]
    file_record = {
        "file_path":     "/fake/path/test.pdf",
        "relative_path": "G-公司治理/GA1/test.pdf",
        "file_name":     "test.pdf",
        "folder_code":   "GA1",
        "extension":     ".pdf",
    }
    chunks = make_chunks_from_sections(sections, file_record,
                                       max_size=800, min_size=50)
    assert len(chunks) >= 1, "至少应有 1 个 chunk"

    required_fields = ("chunk_id", "parent_id", "file_path", "file_name",
                       "folder_code", "page_or_sheet", "chunk_index",
                       "text", "parent_text", "char_count")
    for c in chunks:
        for field in required_fields:
            assert field in c, f"缺少字段: {field}"
        # parent_text 不小于 text
        assert len(c["parent_text"]) >= len(c["text"]), \
            f"parent_text 短于 text: {len(c['parent_text'])} < {len(c['text'])}"
        # chunk_id 含 # 分隔符
        assert c["chunk_id"].count("#") >= 2, f"chunk_id 格式错误: {c['chunk_id']}"
        # folder_code 继承
        assert c["folder_code"] == "GA1", f"folder_code 未正确继承"
        # 路径分隔符标准化（不含反斜杠）
        assert "\\" not in c["chunk_id"], f"chunk_id 含反斜杠: {c['chunk_id']}"


# ==============================================================================
# 步骤 2-1：PDF 分类与提取测试
# ==============================================================================

def test_classify_pdf_normal():
    """正常 PDF 分类为 pymupdf（从 G-公司治理目录找一个非扫描件 PDF）"""
    import fitz

    pdf_path = None
    gov_dir = os.path.join(MOCK_DATA, "G-公司治理")
    for dirpath, _, files in os.walk(gov_dir):
        for f in sorted(files):
            if f.endswith(".pdf") and "扫描件" not in f:
                pdf_path = os.path.join(dirpath, f)
                break
        if pdf_path:
            break

    if not pdf_path:
        print("  [跳过] 未在 G-公司治理 下找到非扫描件 PDF")
        return

    doc    = fitz.open(pdf_path)
    result = classify_pdf_v2(doc)
    assert result in ("pymupdf", "sdk"), f"未知类型: {result}"
    print(f"  [{os.path.basename(pdf_path)}] → {result}")


def test_classify_pdf_scanned():
    """扫描件 PDF 应分类为 sdk（v2 统一将扫描件/PPT/混合 PDF 归为 sdk 路径）"""
    import fitz
    import glob

    candidates = glob.glob(
        os.path.join(MOCK_DATA, "**/*扫描件*.pdf"), recursive=True
    )
    if not candidates:
        print("  [跳过] 未找到文件名含'扫描件'的 PDF")
        return

    doc    = fitz.open(candidates[0])
    result = classify_pdf_v2(doc)
    assert result == "sdk", \
        f"预期 sdk，实际 {result}（{candidates[0]}）"
    print(f"  [{os.path.basename(candidates[0])}] → {result} ✓")


def test_extract_pdf_chunk_structure():
    """抽取一个正常 PDF，验证 ChunkRecord 结构完整性与字段约束"""
    import fitz

    # 找第一个被 classify_pdf_v2 判定为 "pymupdf" 的 PDF（跳过扫描件和 PPT）
    pdf_path = None
    for dirpath, _, files in os.walk(MOCK_DATA):
        for f in sorted(files):
            if not f.endswith(".pdf"):
                continue
            if "扫描件" in f:
                continue
            candidate = os.path.join(dirpath, f)
            try:
                doc = fitz.open(candidate)
                if classify_pdf_v2(doc) == "pymupdf":
                    pdf_path = candidate
                    break
            except Exception:
                continue
        if pdf_path:
            break

    assert pdf_path, "未找到 classify_pdf_v2 返回 'pymupdf' 的 PDF"

    rel_path = os.path.relpath(pdf_path, MOCK_DATA)
    file_record = {
        "file_path":     pdf_path,
        "relative_path": rel_path,
        "file_name":     os.path.basename(pdf_path),
        "folder_code":   "TEST",
        "extension":     ".pdf",
    }

    chunks = extract_pdf(file_record)
    assert len(chunks) >= 1, "至少应有 1 个 chunk"

    required_fields = ("chunk_id", "parent_id", "file_path", "file_name",
                       "folder_code", "page_or_sheet", "chunk_index",
                       "text", "parent_text", "char_count")
    for c in chunks:
        for key in required_fields:
            assert key in c, f"缺少字段: {key}"
        assert len(c["parent_text"]) >= len(c["text"]), \
            f"parent_text 短于 text: {len(c['parent_text'])} < {len(c['text'])}"
        assert "#" in c["chunk_id"], f"chunk_id 格式错误: {c['chunk_id']}"
        assert c["folder_code"] == "TEST", "folder_code 未正确继承"

    avg_chars = sum(c["char_count"] for c in chunks) // len(chunks)
    print(f"  [{os.path.basename(pdf_path)}] → {len(chunks)} 个 chunk，"
          f"平均 {avg_chars} 字符/chunk")


def test_extract_pdf_exception_isolation():
    """损坏/不存在的文件路径应返回空列表，不抛出异常"""
    file_record = {
        "file_path":     "/nonexistent/path/broken.pdf",
        "relative_path": "broken.pdf",
        "file_name":     "broken.pdf",
        "folder_code":   None,
        "extension":     ".pdf",
    }
    result = extract_pdf(file_record)
    assert result == [], f"期望返回 []，实际 {result}"


# ==============================================================================
# 单文件调试工具（命令行传入路径时进入此模式，不运行测试套件）
# ==============================================================================

def inspect_pdf(pdf_path: str, save_dir: str = None) -> None:
    """
    打印单个 PDF 文件的分类结果与分块详情，并将结果保存到文本文件供人工查看。

    用法：
        conda run -n esg python3 tests/test_phase2_pdf.py /path/to/file.pdf
        conda run -n esg python3 tests/test_phase2_pdf.py /path/to/file.pdf /output/dir

    输出文件：<save_dir>/pdf_inspect_<文件名>.txt
    默认保存到：data/processed/pdf_inspect/
    OCR 类型（scanned/ppt）需要 GLM-OCR 服务运行中，否则会打印错误但不崩溃。
    """
    import fitz
    import datetime

    if not os.path.isfile(pdf_path):
        print(f"[错误] 文件不存在：{pdf_path}")
        return

    # 确定保存目录
    if save_dir is None:
        save_dir = os.path.join(ROOT, "data/processed/pdf_inspect")
    os.makedirs(save_dir, exist_ok=True)

    stem      = os.path.splitext(os.path.basename(pdf_path))[0]
    out_path  = os.path.join(save_dir, f"pdf_inspect_{stem}.txt")

    screen_lines = []   # 终端输出（chunk 文本截断为 300 字，避免刷屏）
    file_lines   = []   # 文件输出（chunk 文本完整保存）

    def out(screen_s="", file_s=None):
        """同时追加到终端缓冲和文件缓冲；file_s 为 None 时与 screen_s 相同。"""
        print(screen_s)
        screen_lines.append(screen_s)
        file_lines.append(file_s if file_s is not None else screen_s)

    header = f"{'─' * 60}"
    out(f"\n{header}")
    out(f"文件：{os.path.basename(pdf_path)}")
    out(f"路径：{pdf_path}")
    out(f"时间：{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    out(header)

    # 分类
    doc      = fitz.open(pdf_path)
    pdf_type = classify_pdf_v2(doc)
    out(f"类型判断：{pdf_type}  "
        f"（共 {len(doc)} 页，"
        f"页面尺寸：{doc[0].rect.width:.0f}×{doc[0].rect.height:.0f}）")

    if pdf_type == "sdk":
        out(f"→ SDK 路径（PP-DocLayout-V3 版面检测 + GLM-OCR）")

    # 提取（含 OCR 类型，extract_pdf 内部会调用 call_glmocr）
    file_record = {
        "file_path":     pdf_path,
        "relative_path": os.path.basename(pdf_path),
        "file_name":     os.path.basename(pdf_path),
        "folder_code":   None,
        "extension":     ".pdf",
    }
    chunks = extract_pdf(file_record)

    total_chars = sum(c["char_count"] for c in chunks)
    out(f"\n共 {len(chunks)} 个 chunk，合计 {total_chars} 有效字符\n")

    for c in chunks:
        header_line = (f"  [{c['chunk_id'].split('#')[-1]}] "
                       f"page={c['page_or_sheet']}  "
                       f"chars={c['char_count']}  "
                       f"parent={c['parent_id'].split('#')[-1]}")
        text_full = c["text"]

        # 终端：显示前 300 字，超出则提示
        preview = text_full[:300].replace("\n", "↵")
        screen_text = f"  {preview}"
        if len(text_full) > 300:
            screen_text += f"\n  ... （共 {len(text_full)} 字符）"

        # 文件：完整文本，换行符保留
        file_text = f"  {text_full}"

        out(header_line)
        out(screen_text, file_s=file_text)
        out()

    # 写入文件（完整内容）
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(file_lines))
    print(f"\n[已保存] {out_path}")


# ==============================================================================
# 运行入口
# ==============================================================================

if __name__ == "__main__":
    import sys as _sys

    # 有命令行参数 → 单文件调试模式
    # 用法：python3 test_phase2_pdf.py /path/to/file.pdf [/output/dir]
    if len(_sys.argv) > 1:
        save_dir = _sys.argv[2] if len(_sys.argv) > 2 else None
        inspect_pdf(_sys.argv[1], save_dir=save_dir)
        _sys.exit(0)

    # 无参数 → 正常运行测试套件
    tests = [
        test_count_meaningful_chars,
        test_recursive_split_basic,
        test_recursive_split_no_separator,
        test_recursive_split_merge_small,
        test_make_chunks_from_sections_fields,
        test_classify_pdf_normal,
        test_classify_pdf_scanned,
        test_extract_pdf_chunk_structure,
        test_extract_pdf_exception_isolation,
    ]

    passed = 0
    failed = 0

    for t in tests:
        print(f"[测试] {t.__name__} ...")
        try:
            t()
            print(f"  ✓ 通过")
            passed += 1
        except AssertionError as e:
            print(f"  ✗ 失败: {e}")
            failed += 1
        except Exception as e:
            print(f"  ✗ 异常: {type(e).__name__}: {e}")
            failed += 1

    print()
    print(f"共 {passed}/{len(tests)} 个测试通过"
          + (f"，{failed} 个失败" if failed else ""))
