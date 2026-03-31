"""
tests/test_phase4.py
====================
阶段四：语义检索 + 一致性判断 专项测试。

测试策略：不依赖真实 ChromaDB 或 Embedding API，
通过 mock 对象验证接口契约和业务逻辑正确性。

运行方式：
    conda run -n esg python3 tests/test_phase4.py
"""

import os
import sys
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from align_evidence import (
    semantic_search_batch,
    classify_consistency,
    align_chunks,
)


# ==============================================================================
# 辅助：构造 mock 数据
# ==============================================================================

def _mock_chunk_records_with_emb(
    n: int = 3,
    folder_code: str = "GA1",
    with_none_emb: bool = False,
    with_zero_emb: bool = False,
    with_null_folder: bool = False,
) -> list:
    """
    生成含 embedding 的 mock chunk 记录。

    参数：
        n               - 有效 chunk 数量
        folder_code     - 路径编码
        with_none_emb   - 追加一条 embedding=None 的 chunk
        with_zero_emb   - 追加一条 embedding=[0,...] 的 chunk
        with_null_folder - 追加一条 folder_code=None 的 chunk
    """
    records = [
        {
            "chunk_id":      f"file.pdf#s0#c{i}",
            "parent_id":     "file.pdf#s0",
            "file_path":     "/mock/path/file.pdf",
            "file_name":     "file.pdf",
            "folder_code":   folder_code,
            "page_or_sheet": "1",
            "chunk_index":   i,
            "text":          "测试文本内容。" * 5,
            "parent_text":   "完整文本。" * 10,
            "section_title": "",
            "char_count":    40,
            "embedding":     [0.1 * (i + 1)] * 8,  # 8 维 mock 向量
        }
        for i in range(n)
    ]
    if with_none_emb:
        rec = dict(records[0])
        rec["chunk_id"] = "file.pdf#none_emb"
        rec["embedding"] = None
        records.append(rec)
    if with_zero_emb:
        rec = dict(records[0])
        rec["chunk_id"] = "file.pdf#zero_emb"
        rec["embedding"] = [0.0] * 8
        records.append(rec)
    if with_null_folder:
        rec = dict(records[0])
        rec["chunk_id"] = "file.pdf#null_folder"
        rec["folder_code"] = None
        rec["embedding"] = [0.5] * 8
        records.append(rec)
    return records


def _mock_collection(query_return: dict) -> MagicMock:
    """
    构造 mock ChromaDB Collection，query() 返回指定结果。

    query_return 格式：
        {"ids": [[...], ...], "distances": [[...], ...]}
    """
    mock_col = MagicMock()
    mock_col.query.return_value = query_return
    return mock_col


# ==============================================================================
# TestSemanticSearchBatch（9 个用例）
# ==============================================================================

class TestSemanticSearchBatch(unittest.TestCase):

    def test_returns_same_length_as_input(self):
        """返回长度应等于输入 chunk 数。"""
        records = _mock_chunk_records_with_emb(n=5)
        query_return = {
            "ids": [["GA1", "GA2"]] * 5,
            "distances": [[0.1, 0.3]] * 5,
        }
        col = _mock_collection(query_return)
        result = semantic_search_batch(records, col, top_k=2)
        self.assertEqual(len(result), 5)

    def test_none_embedding_returns_empty_list(self):
        """embedding=None 的 chunk 对应位置应为 []。"""
        records = _mock_chunk_records_with_emb(n=1, with_none_emb=True)
        query_return = {
            "ids": [["GA1"]],
            "distances": [[0.1]],
        }
        col = _mock_collection(query_return)
        result = semantic_search_batch(records, col, top_k=1)
        # 最后一条是 None embedding
        self.assertEqual(result[-1], [])

    def test_zero_embedding_returns_empty_list(self):
        """embedding=[0,...] 的 chunk 对应位置应为 []。"""
        records = _mock_chunk_records_with_emb(n=1, with_zero_emb=True)
        query_return = {
            "ids": [["GA1"]],
            "distances": [[0.1]],
        }
        col = _mock_collection(query_return)
        result = semantic_search_batch(records, col, top_k=1)
        # 最后一条是零向量
        self.assertEqual(result[-1], [])

    def test_empty_list_embedding_returns_empty(self):
        """embedding=[] 的 chunk 应等同零向量处理，对应位置为 []。"""
        records = [
            {
                "chunk_id": "test#0",
                "folder_code": "GA1",
                "embedding": [],
                "text": "test",
                "char_count": 4,
            },
            {
                "chunk_id": "test#1",
                "folder_code": "GA1",
                "embedding": [0.5] * 8,
                "text": "test",
                "char_count": 4,
            },
        ]
        query_return = {
            "ids": [["GA1"]],
            "distances": [[0.2]],
        }
        col = _mock_collection(query_return)
        result = semantic_search_batch(records, col, top_k=1)
        # 第一条（空列表 embedding）应为 []
        self.assertEqual(result[0], [])
        # 第二条（有效 embedding）应有结果
        self.assertEqual(len(result[1]), 1)

    def test_valid_chunks_query_called_once(self):
        """有效 chunk 应合并为一次 batch query。"""
        records = _mock_chunk_records_with_emb(n=3)
        query_return = {
            "ids": [["GA1", "GA2"]] * 3,
            "distances": [[0.1, 0.3]] * 3,
        }
        col = _mock_collection(query_return)
        semantic_search_batch(records, col, top_k=2)
        # query 应只调用一次
        col.query.assert_called_once()

    def test_distances_converted_to_similarity(self):
        """score 应为 1 - distance。"""
        records = _mock_chunk_records_with_emb(n=1)
        query_return = {
            "ids": [["GA1", "EB2"]],
            "distances": [[0.2, 0.5]],
        }
        col = _mock_collection(query_return)
        result = semantic_search_batch(records, col, top_k=2)
        topk = result[0]
        self.assertAlmostEqual(topk[0][1], 0.8)   # 1 - 0.2
        self.assertAlmostEqual(topk[1][1], 0.5)   # 1 - 0.5

    def test_collection_none_returns_all_empty(self):
        """collection=None 时应全部返回 []。"""
        records = _mock_chunk_records_with_emb(n=3)
        result = semantic_search_batch(records, None, top_k=5)
        self.assertEqual(len(result), 3)
        for r in result:
            self.assertEqual(r, [])

    def test_all_none_embeddings_no_query(self):
        """全部 embedding=None 时不应调用 query()。"""
        records = [
            {"chunk_id": f"test#{i}", "embedding": None, "folder_code": "GA1"}
            for i in range(4)
        ]
        col = _mock_collection({"ids": [], "distances": []})
        semantic_search_batch(records, col, top_k=5)
        col.query.assert_not_called()

    def test_mixed_valid_and_invalid_embeddings(self):
        """混合输入时，有效位置有结果，无效位置为 []。"""
        records = [
            {"chunk_id": "a", "embedding": [0.5] * 4, "folder_code": "GA1"},  # 有效 → idx 0
            {"chunk_id": "b", "embedding": None, "folder_code": "GA1"},       # 无效 → idx 1
            {"chunk_id": "c", "embedding": [0.0] * 4, "folder_code": "GA1"},  # 零向量 → idx 2
            {"chunk_id": "d", "embedding": [0.3] * 4, "folder_code": "GA1"},  # 有效 → idx 3
        ]
        # query 返回 2 条结果（对应 2 个有效 embedding）
        query_return = {
            "ids": [["GA1", "GA2"], ["EB1", "EB2"]],
            "distances": [[0.1, 0.2], [0.3, 0.4]],
        }
        col = _mock_collection(query_return)
        result = semantic_search_batch(records, col, top_k=2)
        # idx 0 有效
        self.assertEqual(len(result[0]), 2)
        self.assertEqual(result[0][0][0], "GA1")
        # idx 1 无效
        self.assertEqual(result[1], [])
        # idx 2 零向量
        self.assertEqual(result[2], [])
        # idx 3 有效
        self.assertEqual(len(result[3]), 2)
        self.assertEqual(result[3][0][0], "EB1")


# ==============================================================================
# TestClassifyConsistency（11 个用例）
# ==============================================================================

class TestClassifyConsistency(unittest.TestCase):

    def test_consistent_basic(self):
        """folder=GA1, topk 含 GA1 → ✅。"""
        topk = [("GA1", 0.9), ("GA2", 0.7), ("GA3", 0.6)]
        status, desc, suggested = classify_consistency("GA1", topk)
        self.assertEqual(status, "✅")
        self.assertEqual(desc, "一致")
        self.assertEqual(suggested, "GA1")

    def test_consistent_with_extra(self):
        """folder=GA1, 有其他 code score > 0.75 → ➕。"""
        topk = [("GA1", 0.9), ("GA2", 0.8), ("GA3", 0.6)]
        status, desc, suggested = classify_consistency("GA1", topk)
        self.assertEqual(status, "➕")
        self.assertEqual(desc, "一致且有额外关联")
        self.assertEqual(suggested, "GA1")

    def test_misaligned(self):
        """folder=GA1, topk 前 3 无 GA1 → ⚠️, suggested=Top-1。"""
        topk = [("EB1", 0.9), ("EB2", 0.8), ("EB3", 0.7), ("GA1", 0.5)]
        status, desc, suggested = classify_consistency("GA1", topk, topn=3)
        self.assertEqual(status, "⚠️")
        self.assertEqual(desc, "疑似错位")
        self.assertEqual(suggested, "EB1")

    def test_no_label_with_hit(self):
        """folder=None, topk 有结果 → 🔍, suggested=Top-1。"""
        topk = [("EB1", 0.85), ("EB2", 0.7)]
        status, desc, suggested = classify_consistency(None, topk)
        self.assertEqual(status, "🔍")
        self.assertEqual(desc, "无路径标签但语义命中")
        self.assertEqual(suggested, "EB1")

    def test_no_label_no_hit(self):
        """folder=None, topk=[] → ❓, suggested=None。"""
        status, desc, suggested = classify_consistency(None, [])
        self.assertEqual(status, "❓")
        self.assertEqual(desc, "无任何证据")
        self.assertIsNone(suggested)

    def test_has_code_no_semantic(self):
        """folder=GA1, topk=[] → ❓, suggested=GA1。"""
        status, desc, suggested = classify_consistency("GA1", [])
        self.assertEqual(status, "❓")
        self.assertEqual(desc, "有路径编码但无语义验证")
        self.assertEqual(suggested, "GA1")

    def test_folder_at_topn_boundary(self):
        """GA1 在 Top-3 第 3 位 → ✅。"""
        topk = [("EB1", 0.7), ("EB2", 0.68), ("GA1", 0.65), ("EB3", 0.5)]
        status, desc, suggested = classify_consistency("GA1", topk, topn=3)
        self.assertEqual(status, "✅")
        self.assertEqual(suggested, "GA1")

    def test_folder_just_outside_topn(self):
        """GA1 在第 4 位（topn=3）→ ⚠️。"""
        topk = [("EB1", 0.9), ("EB2", 0.8), ("EB3", 0.7), ("GA1", 0.5)]
        status, desc, suggested = classify_consistency("GA1", topk, topn=3)
        self.assertEqual(status, "⚠️")
        self.assertEqual(suggested, "EB1")

    def test_extra_exactly_at_threshold(self):
        """other score = 0.75（不 > 0.75）→ ✅（不算额外关联）。"""
        topk = [("GA1", 0.9), ("EB1", 0.75), ("EB2", 0.6)]
        status, desc, suggested = classify_consistency("GA1", topk)
        self.assertEqual(status, "✅")
        self.assertEqual(desc, "一致")

    def test_extra_above_threshold(self):
        """other score = 0.76 → ➕。"""
        topk = [("GA1", 0.9), ("EB1", 0.76), ("EB2", 0.6)]
        status, desc, suggested = classify_consistency("GA1", topk)
        self.assertEqual(status, "➕")
        self.assertEqual(desc, "一致且有额外关联")

    def test_custom_topn_and_threshold(self):
        """自定义 topn=1, threshold=0.5，验证参数可调。"""
        # GA1 在 Top-1 内（第 1 位），EB1=0.6 > 0.5 → ➕
        topk = [("GA1", 0.9), ("EB1", 0.6)]
        status, desc, suggested = classify_consistency(
            "GA1", topk, topn=1, extra_threshold=0.5
        )
        self.assertEqual(status, "➕")
        self.assertEqual(desc, "一致且有额外关联")

        # GA1 不在 Top-1 内 → ⚠️
        topk2 = [("EB1", 0.9), ("GA1", 0.6)]
        status2, desc2, suggested2 = classify_consistency(
            "GA1", topk2, topn=1, extra_threshold=0.5
        )
        self.assertEqual(status2, "⚠️")
        self.assertEqual(suggested2, "EB1")


# ==============================================================================
# TestAlignChunks（6 个用例）
# ==============================================================================

class TestAlignChunks(unittest.TestCase):

    def _make_mock_setup(self, n, topk_ids, topk_dists):
        """辅助方法：构建 mock 数据和 collection。"""
        records = _mock_chunk_records_with_emb(n=n)
        query_return = {
            "ids": [topk_ids] * n,
            "distances": [topk_dists] * n,
        }
        col = _mock_collection(query_return)
        return records, col

    def test_returns_same_length(self):
        """返回长度应等于输入。"""
        records, col = self._make_mock_setup(4, ["GA1", "GA2"], [0.1, 0.3])
        result = align_chunks(records, col, top_k=2)
        self.assertEqual(len(result), 4)

    def test_new_fields_present(self):
        """每条应含 4 个新字段。"""
        records, col = self._make_mock_setup(2, ["GA1"], [0.1])
        result = align_chunks(records, col, top_k=1)
        for rec in result:
            self.assertIn("semantic_topk", rec)
            self.assertIn("consistency", rec)
            self.assertIn("consistency_desc", rec)
            self.assertIn("suggested_code", rec)

    def test_original_fields_preserved(self):
        """原有字段不应被覆盖。"""
        records, col = self._make_mock_setup(2, ["GA1"], [0.1])
        result = align_chunks(records, col, top_k=1)
        for rec in result:
            self.assertIn("chunk_id", rec)
            self.assertIn("file_path", rec)
            self.assertIn("folder_code", rec)
            self.assertIn("embedding", rec)

    def test_mixed_statuses(self):
        """混合输入应产生多种状态。"""
        # 第一条：folder_code=GA1, 语义 Top-1=GA1 → ✅
        # 第二条：folder_code=None, 语义有结果 → 🔍
        records = [
            {
                "chunk_id": "a", "folder_code": "GA1",
                "embedding": [0.5] * 4, "text": "t", "char_count": 1,
            },
            {
                "chunk_id": "b", "folder_code": None,
                "embedding": [0.3] * 4, "text": "t", "char_count": 1,
            },
        ]
        query_return = {
            "ids": [["GA1", "GA2"], ["EB1", "EB2"]],
            "distances": [[0.1, 0.3], [0.2, 0.4]],
        }
        col = _mock_collection(query_return)
        result = align_chunks(records, col, top_k=2)
        statuses = {r["consistency"] for r in result}
        # 应至少有两种不同状态
        self.assertGreaterEqual(len(statuses), 2)

    def test_does_not_modify_input(self):
        """不应修改原始列表。"""
        records = _mock_chunk_records_with_emb(n=3)
        original_len = len(records)
        original_keys = [set(r.keys()) for r in records]
        query_return = {
            "ids": [["GA1"]] * 3,
            "distances": [[0.1]] * 3,
        }
        col = _mock_collection(query_return)
        align_chunks(records, col, top_k=1)
        # 原始列表长度不变
        self.assertEqual(len(records), original_len)
        # 原始记录不应有新字段
        for orig_keys, rec in zip(original_keys, records):
            self.assertNotIn("consistency", rec,
                             "原始记录不应被追加 consistency 字段")
            self.assertEqual(set(rec.keys()), orig_keys)

    def test_collection_none_all_question_marks(self):
        """collection=None 时全部应为 ❓。"""
        records = _mock_chunk_records_with_emb(n=3)
        result = align_chunks(records, None, top_k=5)
        for rec in result:
            self.assertEqual(rec["consistency"], "❓")


# ==============================================================================
# 运行
# ==============================================================================

def run_all():
    """运行所有阶段四测试，打印摘要。"""
    suites = [
        unittest.TestLoader().loadTestsFromTestCase(TestSemanticSearchBatch),
        unittest.TestLoader().loadTestsFromTestCase(TestClassifyConsistency),
        unittest.TestLoader().loadTestsFromTestCase(TestAlignChunks),
    ]
    combined = unittest.TestSuite(suites)
    runner   = unittest.TextTestRunner(verbosity=2)
    result   = runner.run(combined)
    return result


if __name__ == "__main__":
    run_all()
