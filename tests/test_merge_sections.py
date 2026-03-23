"""
tests/test_merge_sections.py
=============================
merge_short_sections() 合并逻辑的独立单元测试。

运行方式：
    conda run -n esg python -m pytest tests/test_merge_sections.py -v
"""

import copy
import os
import sys

# 将 src/ 加入 sys.path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from extractors import merge_short_sections, make_chunks_from_sections, count_meaningful_chars


# ==============================================================================
# 辅助：快速构造 section dict
# ==============================================================================

def _sec(text: str, section_id: str = "s0", page_or_sheet: str = "1",
         section_title: str = "") -> dict:
    return {
        "section_id": section_id,
        "page_or_sheet": page_or_sheet,
        "text": text,
        "section_title": section_title,
    }


def _make_text(meaningful_chars: int) -> str:
    """生成指定数量有效字符的文本（纯中文）。"""
    return "测" * meaningful_chars


# ==============================================================================
# 测试用例
# ==============================================================================

# min_size=100, max_size=800 与全局默认一致
DEFAULT_MIN = 100
DEFAULT_MAX = 800


def test_empty_list():
    """空列表输入 → 返回空列表"""
    result = merge_short_sections([], min_size=DEFAULT_MIN, max_size=DEFAULT_MAX)
    assert result == []


def test_single_long_section():
    """单个长 section（>= min_size）→ 不变，返回 1 个"""
    text = _make_text(200)
    sections = [_sec(text, section_id="p1")]
    result = merge_short_sections(sections, min_size=DEFAULT_MIN, max_size=DEFAULT_MAX)
    assert len(result) == 1
    assert result[0]["text"] == text
    assert result[0]["section_id"] == "p1"


def test_single_short_section():
    """单个短 section（< min_size）→ 无合并伙伴，原样返回 1 个"""
    text = _make_text(30)
    sections = [_sec(text, section_id="p1")]
    result = merge_short_sections(sections, min_size=DEFAULT_MIN, max_size=DEFAULT_MAX)
    assert len(result) == 1
    assert result[0]["text"] == text


def test_short_merges_forward():
    """短 section + 长 section → 向前合并为 1 个"""
    short_text = _make_text(20)
    long_text = _make_text(200)
    sections = [
        _sec(short_text, section_id="s0", page_or_sheet="1"),
        _sec(long_text, section_id="s1", page_or_sheet="2"),
    ]
    result = merge_short_sections(sections, min_size=DEFAULT_MIN, max_size=DEFAULT_MAX)
    assert len(result) == 1
    # 文本 = short + \n + long
    assert result[0]["text"] == short_text + "\n" + long_text
    # section_id 和 page_or_sheet 继承较早者（cur = s0）
    assert result[0]["section_id"] == "s0"
    assert result[0]["page_or_sheet"] == "1"


def test_short_merges_backward_at_end():
    """长 section + 短 section（末尾）→ 向后合并为 1 个"""
    long_text = _make_text(200)
    short_text = _make_text(20)
    sections = [
        _sec(long_text, section_id="s0", page_or_sheet="1"),
        _sec(short_text, section_id="s1", page_or_sheet="2"),
    ]
    result = merge_short_sections(sections, min_size=DEFAULT_MIN, max_size=DEFAULT_MAX)
    assert len(result) == 1
    # 文本 = long + \n + short
    assert result[0]["text"] == long_text + "\n" + short_text
    # prev 保持自己的 section_id 和 page_or_sheet
    assert result[0]["section_id"] == "s0"
    assert result[0]["page_or_sheet"] == "1"


def test_chain_merge_consecutive_shorts():
    """连续 3 个短 section → 链式向前合并为 1 个"""
    t1 = _make_text(10)
    t2 = _make_text(10)
    t3 = _make_text(10)
    sections = [
        _sec(t1, section_id="s0"),
        _sec(t2, section_id="s1"),
        _sec(t3, section_id="s2"),
    ]
    result = merge_short_sections(sections, min_size=DEFAULT_MIN, max_size=DEFAULT_MAX)
    assert len(result) == 1
    # 全部合并，文本用 \n 连接
    assert result[0]["text"] == t1 + "\n" + t2 + "\n" + t3
    # section_id 应为最早的
    assert result[0]["section_id"] == "s0"


def test_no_merge_if_exceeds_max():
    """短 section 合并后超过 max_size → 保持 2 个不变"""
    # 使用小 max_size 使得两个 section 无法合并
    short_text = _make_text(30)
    other_text = _make_text(30)
    sections = [
        _sec(short_text, section_id="s0"),
        _sec(other_text, section_id="s1"),
    ]
    # max_size=50，两段拼接 30+30+1=61 > 50
    result = merge_short_sections(sections, min_size=DEFAULT_MIN, max_size=50)
    assert len(result) == 2
    assert result[0]["text"] == short_text
    assert result[1]["text"] == other_text


def test_section_title_preserved():
    """short(title="X") + long(title="") → 合并后 title="X" """
    short_text = _make_text(20)
    long_text = _make_text(200)
    sections = [
        _sec(short_text, section_id="s0", section_title="第一章 总则"),
        _sec(long_text, section_id="s1", section_title=""),
    ]
    result = merge_short_sections(sections, min_size=DEFAULT_MIN, max_size=DEFAULT_MAX)
    assert len(result) == 1
    assert result[0]["section_title"] == "第一章 总则"


def test_section_title_from_next_if_cur_empty():
    """short(title="") + long(title="Y") → 合并后 title="Y" """
    short_text = _make_text(20)
    long_text = _make_text(200)
    sections = [
        _sec(short_text, section_id="s0", section_title=""),
        _sec(long_text, section_id="s1", section_title="第二章 范围"),
    ]
    result = merge_short_sections(sections, min_size=DEFAULT_MIN, max_size=DEFAULT_MAX)
    assert len(result) == 1
    assert result[0]["section_title"] == "第二章 范围"


def test_section_id_from_earlier():
    """向前合并时，合并后 section_id 取较早者"""
    short_text = _make_text(20)
    long_text = _make_text(200)
    sections = [
        _sec(short_text, section_id="s5", page_or_sheet="3"),
        _sec(long_text, section_id="s6", page_or_sheet="4"),
    ]
    result = merge_short_sections(sections, min_size=DEFAULT_MIN, max_size=DEFAULT_MAX)
    assert len(result) == 1
    assert result[0]["section_id"] == "s5"
    assert result[0]["page_or_sheet"] == "3"


def test_mixed_short_and_long():
    """[短, 长, 短, 短, 长] → 部分合并，长 section 不受影响"""
    short1 = _make_text(20)
    long1 = _make_text(200)
    short2 = _make_text(15)
    short3 = _make_text(15)
    long2 = _make_text(200)
    sections = [
        _sec(short1, section_id="s0"),
        _sec(long1, section_id="s1"),
        _sec(short2, section_id="s2"),
        _sec(short3, section_id="s3"),
        _sec(long2, section_id="s4"),
    ]
    result = merge_short_sections(sections, min_size=DEFAULT_MIN, max_size=DEFAULT_MAX)
    # short1 向前合并到 long1 → 1 个
    # long1（合并后）>= min_size → 保留
    # short2 向前合并到 short3 → 仍短，再向前合并到 long2 → 1 个
    # 总共应为 2 个
    assert len(result) == 2
    # 第一个包含 short1+long1
    assert short1 in result[0]["text"]
    assert long1 in result[0]["text"]
    # 第二个包含 short2+short3+long2
    assert long2 in result[1]["text"]


def test_original_not_mutated():
    """合并不修改原列表和原 dict"""
    short_text = _make_text(20)
    long_text = _make_text(200)
    original_sections = [
        _sec(short_text, section_id="s0"),
        _sec(long_text, section_id="s1"),
    ]
    # 深拷贝保留原始值
    sections_snapshot = copy.deepcopy(original_sections)

    result = merge_short_sections(original_sections, min_size=DEFAULT_MIN, max_size=DEFAULT_MAX)

    # 原列表长度不变
    assert len(original_sections) == 2
    # 原 dict 内容不变
    assert original_sections[0] == sections_snapshot[0]
    assert original_sections[1] == sections_snapshot[1]
    # result 是不同的列表
    assert result is not original_sections


def test_integration_with_make_chunks():
    """多个短 section 经 make_chunks_from_sections → chunk 数应少于无合并时"""
    # 构造 20 个短 section（每个 10 个有效字符）
    sections_short = [
        _sec(_make_text(10), section_id=f"s{i}", page_or_sheet=str(i + 1))
        for i in range(20)
    ]

    file_record = {
        "file_path": "/fake/path/test.pdf",
        "relative_path": "G-公司治理/GA1/test.pdf",
        "file_name": "test.pdf",
        "folder_code": "GA1",
        "extension": ".pdf",
    }

    # 使用 make_chunks_from_sections（内部会调用 merge_short_sections）
    chunks_merged = make_chunks_from_sections(
        sections_short, file_record, max_size=DEFAULT_MAX, min_size=DEFAULT_MIN
    )

    # 20 个短 section 应被大量合并，chunk 数远少于 20
    assert len(chunks_merged) < 20, \
        f"合并后 chunk 数 {len(chunks_merged)} 应远少于原始 section 数 20"
    # 至少产生 1 个 chunk（内容非空）
    assert len(chunks_merged) >= 1

    # 验证 chunk 字段完整
    required_fields = ("chunk_id", "parent_id", "file_path", "file_name",
                       "folder_code", "page_or_sheet", "chunk_index",
                       "text", "parent_text", "char_count")
    for c in chunks_merged:
        for field in required_fields:
            assert field in c, f"缺少字段: {field}"


def test_empty_text_sections_absorbed():
    """空文本 section（meaningful chars = 0）应被合并到相邻 section"""
    sections = [
        _sec("", section_id="s0"),
        _sec(_make_text(200), section_id="s1"),
    ]
    result = merge_short_sections(sections, min_size=DEFAULT_MIN, max_size=DEFAULT_MAX)
    # 空 section 应向前合并到 s1
    assert len(result) == 1
    assert result[0]["section_id"] == "s0"
