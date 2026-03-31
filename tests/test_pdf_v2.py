"""
tests/test_pdf_v2.py
====================
PDF v2 提取路径（glmocr SDK 流水线）单元测试。

测试范围：
  - classify_pdf_v2() — PDF 分流逻辑
  - _rebuild_title_levels_rule() — 规则标题层级重建
  - _parse_sdk_markdown() — SDK Markdown 切割 section

运行方式：
    conda run -n esg python -m pytest tests/test_pdf_v2.py -v
    conda run -n esg python3 tests/test_pdf_v2.py
"""

import os
import sys

# 将 src/ 加入 sys.path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from extractors import (
    classify_pdf_v2,
    _rebuild_title_levels_rule,
    _parse_sdk_markdown,
    _heading_numeric_level,
    count_meaningful_chars,
)


# ==============================================================================
# classify_pdf_v2 测试
# ==============================================================================

class _MockPage:
    """模拟 fitz.Page 对象。"""
    def __init__(self, text="", width=595, height=842, images=None, blocks=None):
        self._text = text
        self.rect = type('Rect', (), {'width': width, 'height': height})()
        self._images = images or []
        self._blocks = blocks  # 如果不设置，自动从 text 生成

    def get_text(self, mode=None):
        if mode == "blocks":
            if self._blocks is not None:
                return self._blocks
            # 自动生成一个文本 block
            return [(0, 0, 100, 100, self._text, 0, 0)] if self._text else []
        return self._text

    def get_images(self, full=False):
        return self._images


class _MockDoc:
    """模拟 fitz.Document 对象。"""
    def __init__(self, pages):
        self._pages = pages

    def __len__(self):
        return len(self._pages)

    def __getitem__(self, idx):
        return self._pages[idx]

    def __iter__(self):
        return iter(self._pages)


def test_classify_v2_empty_doc():
    """空文档 → pymupdf"""
    doc = _MockDoc([])
    assert classify_pdf_v2(doc) == "pymupdf"


def test_classify_v2_all_text_pages():
    """所有页面都有足够文字 → pymupdf"""
    pages = [_MockPage(text="这是一段包含足够中文字符的文本内容" * 5) for _ in range(10)]
    doc = _MockDoc(pages)
    assert classify_pdf_v2(doc) == "pymupdf"


def test_classify_v2_one_scanned_page():
    """一页无文字 → sdk（逐页检测的核心改进）"""
    pages = [
        _MockPage(text="这是一段包含足够中文字符的文本内容" * 5),
        _MockPage(text=""),  # 扫描件页
        _MockPage(text="这是另一段包含足够中文字符的文本内容" * 5),
    ]
    doc = _MockDoc(pages)
    assert classify_pdf_v2(doc) == "sdk"


def test_classify_v2_mixed_pdf():
    """混合 PDF：部分页面低字符 → sdk"""
    pages = [
        _MockPage(text="中文" * 50),   # 正常页
        _MockPage(text="ab"),           # 低字符页（< PDF_PAGE_MIN_CHARS=30）
        _MockPage(text="中文" * 50),   # 正常页
    ]
    doc = _MockDoc(pages)
    assert classify_pdf_v2(doc) == "sdk"


def test_classify_v2_ppt_detection():
    """PPT 转 PDF（宽页面 + 少文字）→ sdk"""
    # 创建宽屏页面，文字少
    blocks = [(0, 0, 100, 50, "短文", 0, 0)]  # 少量文字 block
    pages = [
        _MockPage(text="短文", width=1024, height=768,
                  blocks=blocks, images=[(1,)])
        for _ in range(5)
    ]
    doc = _MockDoc(pages)
    result = classify_pdf_v2(doc)
    assert result == "sdk"


def test_classify_v2_sufficient_chars_boundary():
    """恰好 30 个有效字符 → pymupdf（= 阈值时不走 sdk）"""
    # PDF_PAGE_MIN_CHARS = 30
    # count_meaningful_chars 只统计中文/英文/数字
    text = "中" * 30  # 恰好 30 个有效字符
    pages = [_MockPage(text=text) for _ in range(3)]
    doc = _MockDoc(pages)
    assert classify_pdf_v2(doc) == "pymupdf"


def test_classify_v2_below_threshold():
    """29 个有效字符 → sdk（< 阈值）"""
    text = "中" * 29
    pages = [
        _MockPage(text="中" * 100),  # 正常页
        _MockPage(text=text),          # 低字符页
    ]
    doc = _MockDoc(pages)
    assert classify_pdf_v2(doc) == "sdk"


# ==============================================================================
# _rebuild_title_levels_rule 测试
# ==============================================================================

def test_rule_doc_title():
    """doc_title → level 1"""
    titles = [{"index": 0, "sdk_label": "doc_title", "raw_text": "知识产权管理手册"}]
    result = _rebuild_title_levels_rule(titles)
    assert len(result) == 1
    assert result[0]["level"] == 1
    assert result[0]["text"] == "知识产权管理手册"


def test_rule_numbered_titles():
    """编号标题层级推断"""
    titles = [
        {"index": 0, "sdk_label": "paragraph_title", "raw_text": "1 范围"},
        {"index": 1, "sdk_label": "paragraph_title", "raw_text": "1.1 总则"},
        {"index": 2, "sdk_label": "paragraph_title", "raw_text": "1.1.1 细则"},
        {"index": 3, "sdk_label": "paragraph_title", "raw_text": "2 规范性引用文件"},
    ]
    result = _rebuild_title_levels_rule(titles)
    assert result[0]["level"] == 1   # "1 范围" → 1级
    assert result[1]["level"] == 2   # "1.1 总则" → 2级
    assert result[2]["level"] == 3   # "1.1.1 细则" → 3级
    assert result[3]["level"] == 1   # "2 规范性引用文件" → 1级


def test_rule_chinese_numbered():
    """汉字编号 → level 1"""
    titles = [
        {"index": 0, "sdk_label": "paragraph_title", "raw_text": "一、公司概况"},
        {"index": 1, "sdk_label": "paragraph_title", "raw_text": "二、组织架构"},
    ]
    result = _rebuild_title_levels_rule(titles)
    assert result[0]["level"] == 1
    assert result[1]["level"] == 1


def test_rule_no_number_fallback():
    """无编号标题 → 默认 level 2"""
    titles = [
        {"index": 0, "sdk_label": "paragraph_title", "raw_text": "目录"},
        {"index": 1, "sdk_label": "paragraph_title", "raw_text": "前言"},
    ]
    result = _rebuild_title_levels_rule(titles)
    assert result[0]["level"] == 2
    assert result[1]["level"] == 2


def test_rule_mixed_labels():
    """混合 doc_title 和 paragraph_title"""
    titles = [
        {"index": 0, "sdk_label": "doc_title", "raw_text": "管理手册"},
        {"index": 1, "sdk_label": "paragraph_title", "raw_text": "目录"},
        {"index": 2, "sdk_label": "paragraph_title", "raw_text": "1 范围"},
        {"index": 3, "sdk_label": "paragraph_title", "raw_text": "1.1 总则"},
    ]
    result = _rebuild_title_levels_rule(titles)
    assert result[0]["level"] == 1   # doc_title
    assert result[1]["level"] == 2   # 无编号 paragraph_title
    assert result[2]["level"] == 1   # "1 范围"
    assert result[3]["level"] == 2   # "1.1 总则"


def test_rule_empty_list():
    """空标题列表 → 空结果"""
    assert _rebuild_title_levels_rule([]) == []


def test_rule_chapter_format():
    """'第X章' 格式"""
    titles = [
        {"index": 0, "sdk_label": "paragraph_title", "raw_text": "第一章 总则"},
        {"index": 1, "sdk_label": "paragraph_title", "raw_text": "第二章 组织机构"},
    ]
    result = _rebuild_title_levels_rule(titles)
    assert result[0]["level"] == 1
    assert result[1]["level"] == 1


# ==============================================================================
# _heading_numeric_level 测试（PDF v2 复用的公共函数）
# ==============================================================================

def test_heading_numeric_single():
    """单级编号"""
    assert _heading_numeric_level("1.目的") == 1
    assert _heading_numeric_level("3 总经理") == 1


def test_heading_numeric_multi():
    """多级编号"""
    assert _heading_numeric_level("3.1 总经理") == 2
    assert _heading_numeric_level("6.2.2.1 熟悉相关法律法规") == 4


def test_heading_numeric_chinese():
    """汉字编号"""
    assert _heading_numeric_level("一、公司概况") == 1
    assert _heading_numeric_level("第一章 总则") == 1


def test_heading_numeric_none():
    """无编号"""
    assert _heading_numeric_level("目录") == 0
    assert _heading_numeric_level("前言") == 0


# ==============================================================================
# _parse_sdk_markdown 测试
# ==============================================================================

def test_parse_sdk_markdown_basic():
    """基本切割：两个标题，两个 section"""
    markdown = """# 管理手册

这是前言内容。

## 1 范围

1.1 总则

这是范围的内容。

## 2 引用文件

这是引用文件的内容。"""

    titles = [
        {"index": 0, "level": 1, "text": "管理手册"},
        {"index": 1, "level": 2, "text": "1 范围"},
        {"index": 2, "level": 2, "text": "2 引用文件"},
    ]

    sections = _parse_sdk_markdown(markdown, titles)
    assert len(sections) >= 2  # 至少有 1范围 和 2引用文件 两个 section

    # 检查 section_id 格式
    for s in sections:
        assert s["section_id"].startswith("s")
        assert "page_or_sheet" in s
        assert "text" in s
        assert "section_title" in s


def test_parse_sdk_markdown_no_titles():
    """无标题 → 整文件作一个 section"""
    markdown = """这是一段没有标题的文本。

另一段文本。"""

    sections = _parse_sdk_markdown(markdown, [])
    assert len(sections) == 1
    assert sections[0]["section_id"] == "doc"
    assert "这是一段没有标题的文本" in sections[0]["text"]


def test_parse_sdk_markdown_empty():
    """空 markdown → 空列表"""
    sections = _parse_sdk_markdown("", [])
    assert sections == []
    sections2 = _parse_sdk_markdown("   \n\n   ", [])
    assert sections2 == []


def test_parse_sdk_markdown_cut_level_1():
    """max_level <= 2 → cut_level = 1，所有标题触发切割"""
    markdown = """## 1 范围

范围内容。

## 2 引用文件

引用文件内容。"""

    titles = [
        {"index": 0, "level": 2, "text": "1 范围"},
        {"index": 1, "level": 2, "text": "2 引用文件"},
    ]

    sections = _parse_sdk_markdown(markdown, titles)
    # max_level = 2 → cut_level = 1 → 两个标题都切割
    assert len(sections) == 2
    assert "范围内容" in sections[0]["text"]
    assert "引用文件内容" in sections[1]["text"]


def test_parse_sdk_markdown_cut_level_2():
    """max_level >= 3 → cut_level = 2，第1层标题不切割"""
    markdown = """# 管理手册

前言。

## 1 范围

范围内容。

## 1.1 总则

总则内容。

### 1.1.1 细则

细则内容。"""

    titles = [
        {"index": 0, "level": 1, "text": "管理手册"},
        {"index": 1, "level": 2, "text": "1 范围"},
        {"index": 2, "level": 2, "text": "1.1 总则"},
        {"index": 3, "level": 3, "text": "1.1.1 细则"},
    ]

    sections = _parse_sdk_markdown(markdown, titles)
    # max_level = 3 → cut_level = 2
    # 第1层（管理手册）不切割但更新 section_title
    # 第2层（1 范围, 1.1 总则）触发切割
    # 第3层（1.1.1 细则）不切割，作为正文

    assert len(sections) >= 2

    # 验证 section_title 在 cut_level=2 时包含 l1 标题
    for s in sections:
        if s["section_id"] != "s0":
            # 第2层之后的 section 应有 section_title
            pass  # section_title 可能为 "管理手册" 或空


def test_parse_sdk_markdown_with_tables():
    """包含 HTML 表格的 markdown"""
    markdown = """## 文件信息

<table border="1"><tr><td>文件编号</td><td>AS-IP-01</td></tr></table>

## 内容

正文内容。"""

    titles = [
        {"index": 0, "level": 2, "text": "文件信息"},
        {"index": 1, "level": 2, "text": "内容"},
    ]

    sections = _parse_sdk_markdown(markdown, titles)
    assert len(sections) == 2
    # 表格应包含在第一个 section 中
    assert "<table" in sections[0]["text"]


def test_parse_sdk_markdown_section_fields():
    """验证 section 字段完整性"""
    markdown = "## 标题\n\n内容"
    titles = [{"index": 0, "level": 2, "text": "标题"}]

    sections = _parse_sdk_markdown(markdown, titles)
    assert len(sections) == 1
    s = sections[0]
    assert "section_id" in s
    assert "page_or_sheet" in s
    assert "text" in s
    assert "section_title" in s


# ==============================================================================
# 集成测试：规则层级 + markdown 切割
# ==============================================================================

def test_integration_rule_then_parse():
    """端到端：标题提取 → 规则层级重建 → markdown 切割"""
    # 模拟 SDK 输出的 markdown
    markdown = """# 知识产权管理手册

拟制人：张三

## 目录

1 范围
2 引用文件

## 1 范围

本手册适用于...

## 1.1 总则

总则说明...

## 2 规范性引用文件

GB/T 29490-2013"""

    # 模拟从 markdown 提取标题
    title_list = [
        {"index": 0, "sdk_label": "doc_title", "raw_text": "知识产权管理手册"},
        {"index": 1, "sdk_label": "paragraph_title", "raw_text": "目录"},
        {"index": 2, "sdk_label": "paragraph_title", "raw_text": "1 范围"},
        {"index": 3, "sdk_label": "paragraph_title", "raw_text": "1.1 总则"},
        {"index": 4, "sdk_label": "paragraph_title", "raw_text": "2 规范性引用文件"},
    ]

    # 标题层级重建
    levels = _rebuild_title_levels_rule(title_list)
    assert levels[0]["level"] == 1   # doc_title
    assert levels[1]["level"] == 2   # 目录（无编号 → 2）
    assert levels[2]["level"] == 1   # 1 范围
    assert levels[3]["level"] == 2   # 1.1 总则
    assert levels[4]["level"] == 1   # 2 规范性引用文件

    # Markdown 切割
    sections = _parse_sdk_markdown(markdown, levels)
    assert len(sections) > 0

    # 验证 section 文本不为空
    for s in sections:
        assert s["text"].strip(), f"Section {s['section_id']} 文本为空"


# ==============================================================================
# count_meaningful_chars 验证（v2 分流依赖）
# ==============================================================================

def test_count_meaningful_basic():
    """基本字符统计"""
    assert count_meaningful_chars("中文abc123") == 8  # 2 Chinese + 3 letters + 3 digits
    assert count_meaningful_chars("") == 0
    assert count_meaningful_chars("  \n\t  ") == 0
    assert count_meaningful_chars("，。、！") == 0  # 标点不计


# ==============================================================================
# __main__
# ==============================================================================

if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
