"""
tests/test_phase3.py
====================
阶段三：构建向量库 专项测试。

测试策略：不依赖真实 Embedding API 或 ChromaDB 持久化服务，
通过伪造 URL / mock 对象验证接口契约和业务逻辑正确性。

运行方式：
    conda run -n esg python3 tests/test_phase3.py
"""

import os
import sys
import unittest
from unittest.mock import MagicMock, patch, call

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from align_evidence import (
    build_indicator_queries,
    compute_embeddings,
    build_indicator_collection,
    embed_chunks,
)


# ==============================================================================
# 辅助：构造最小 mock 数据
# ==============================================================================

def _mock_indicator_details(n: int = 5) -> dict:
    """生成 n 条最小指标记录，供测试使用。"""
    return {
        f"GA{i}": {
            "topic":       f"议题{i}",
            "indicator":   f"指标{i}",
            "requirement": f"这是第{i}条资料需求描述，" * 30,   # ~150 字，不超过 500
        }
        for i in range(1, n + 1)
    }


def _mock_indicator_details_long_req(n: int = 3) -> dict:
    """生成带超长 requirement（>500 字）的指标记录，用于截断测试。"""
    return {
        f"EB{i}": {
            "topic":       f"环境议题{i}",
            "indicator":   f"环境指标{i}",
            "requirement": "超长资料需求描述内容。" * 60,   # ~360 字 * 60 = >500 字
        }
        for i in range(1, n + 1)
    }


def _mock_chunk_records(n: int = 3, with_empty: bool = False) -> list:
    """
    生成 n 条最小 chunk 记录，供测试使用。
    with_empty=True 时追加一条 char_count=0 的空 chunk。
    """
    records = [
        {
            "chunk_id":      f"file.pdf#s0#c{i}",
            "parent_id":     "file.pdf#s0",
            "file_path":     f"/mock/path/file.pdf",
            "file_name":     "file.pdf",
            "folder_code":   "GA1",
            "page_or_sheet": "1",
            "chunk_index":   i,
            "text":          "测试文本内容，包含中文字符。" * 5,
            "parent_text":   "完整 section 文本。" * 10,
            "section_title": "",
            "char_count":    40,
        }
        for i in range(n)
    ]
    if with_empty:
        records.append({
            "chunk_id":      "file.pdf#s1#c0",
            "parent_id":     "file.pdf#s1",
            "file_path":     "/mock/path/file.pdf",
            "file_name":     "file.pdf",
            "folder_code":   "GA1",
            "page_or_sheet": "2",
            "chunk_index":   0,
            "text":          "",
            "parent_text":   "",
            "section_title": "",
            "char_count":    0,
        })
    return records


# ==============================================================================
# 3a 测试：build_indicator_queries
# ==============================================================================

class TestBuildIndicatorQueries(unittest.TestCase):

    def test_count_matches_input(self):
        """返回 dict 的条数应等于输入 indicator_details 的条数。"""
        details = _mock_indicator_details(n=7)
        queries = build_indicator_queries(details)
        self.assertEqual(len(queries), 7)

    def test_all_codes_present(self):
        """输出的 key 集合应与输入编码完全一致。"""
        details = _mock_indicator_details(n=5)
        queries = build_indicator_queries(details)
        self.assertEqual(set(queries.keys()), set(details.keys()))

    def test_query_contains_code_topic_indicator(self):
        """每条查询文本应包含 code、topic、indicator 信息。"""
        details = _mock_indicator_details(n=3)
        queries = build_indicator_queries(details)
        for code, query in queries.items():
            self.assertIn(code, query, f"查询文本应包含编码 {code}")
            self.assertIn(details[code]["topic"], query, f"查询文本应包含议题")
            self.assertIn(details[code]["indicator"], query, f"查询文本应包含指标名")

    def test_requirement_truncated_to_500(self):
        """requirement 超过 500 字时，查询文本中的 requirement 部分应被截断。"""
        details = _mock_indicator_details_long_req(n=2)
        queries = build_indicator_queries(details)
        for code, query in queries.items():
            req_full = details[code]["requirement"]
            # 查询文本长度应小于：code + topic + indicator + 500 字 + 分隔符 + 少量开销
            max_expected = len(code) + len(details[code]["topic"]) + \
                           len(details[code]["indicator"]) + 500 + 10
            self.assertLessEqual(len(query), max_expected,
                                 f"查询文本超过预期上限，原始 requirement={len(req_full)} 字")

    def test_no_requirement_no_colon(self):
        """无 requirement 时，查询文本不应包含冒号占位。"""
        details = {
            "GC1": {"topic": "商业行为", "indicator": "反腐败", "requirement": ""}
        }
        queries = build_indicator_queries(details)
        self.assertNotIn("：", queries["GC1"],
                         "无 requirement 时查询文本不应出现冒号")
        self.assertIn("GC1", queries["GC1"])
        self.assertIn("商业行为", queries["GC1"])

    def test_all_queries_nonempty(self):
        """所有查询文本应为非空字符串。"""
        details = _mock_indicator_details(n=10)
        queries = build_indicator_queries(details)
        for code, query in queries.items():
            self.assertTrue(query.strip(), f"编码 {code} 的查询文本不应为空")


# ==============================================================================
# 3b 测试：compute_embeddings
# ==============================================================================

class TestComputeEmbeddings(unittest.TestCase):

    def test_empty_input_returns_empty(self):
        """空列表输入应直接返回空列表，不发起任何 API 调用。"""
        result = compute_embeddings(
            texts    = [],
            api_key  = "fake-key",
            base_url = "http://invalid-url",
            model    = "test-model",
        )
        self.assertEqual(result, [])

    def test_api_failure_returns_zero_vectors_no_raise(self):
        """
        API 不可用（伪造 base_url）时，不抛出异常，
        返回等长列表（每条为空列表，即零向量占位）。
        """
        texts = ["文本一", "文本二", "文本三"]
        result = compute_embeddings(
            texts    = texts,
            api_key  = "fake-key",
            base_url = "http://127.0.0.1:9999/invalid",  # 必然连接失败
            model    = "test-model",
            batch_size = 10,
        )
        # 不应抛出，且长度等于输入
        self.assertEqual(len(result), len(texts))

    def test_returns_list_same_length(self):
        """即使 API 失败，返回列表长度应与输入一致（用零向量填充）。"""
        texts = [f"文本{i}" for i in range(7)]
        result = compute_embeddings(
            texts    = texts,
            api_key  = "fake",
            base_url = "http://127.0.0.1:9999/invalid",
            model    = "test-model",
            batch_size = 3,
        )
        self.assertEqual(len(result), 7)

    def test_batch_splitting(self):
        """批量分批逻辑：mock openai，验证分批调用次数。"""
        n_texts    = 7
        batch_size = 3  # 应分为 3 批：3 + 3 + 1
        fake_emb   = [0.1] * 4  # 随意维度

        # compute_embeddings 在函数体内做 `from openai import OpenAI`，
        # 所以 patch 目标是 openai.OpenAI
        mock_client = MagicMock()

        def make_response(model, input, **kwargs):
            resp = MagicMock()
            resp.data = [MagicMock(embedding=fake_emb) for _ in input]
            return resp

        mock_client.embeddings.create.side_effect = make_response
        mock_openai_cls = MagicMock(return_value=mock_client)

        with patch("openai.OpenAI", mock_openai_cls):
            texts  = [f"文本{i}" for i in range(n_texts)]
            result = compute_embeddings(
                texts      = texts,
                api_key    = "fake",
                base_url   = "http://fake",
                model      = "test",
                batch_size = batch_size,
            )

        # 应调用 3 次（ceil(7/3)=3）
        expected_calls = (n_texts + batch_size - 1) // batch_size
        self.assertEqual(mock_client.embeddings.create.call_count, expected_calls)
        # 返回列表长度应与输入一致
        self.assertEqual(len(result), n_texts)


# ==============================================================================
# 3c 测试：build_indicator_collection
# ==============================================================================

class TestBuildIndicatorCollection(unittest.TestCase):

    def _make_mock_chromadb(self, existing_count: int = 0):
        """
        构造 mock chromadb 模块：
        - client.get_collection() 抛 Exception（模拟 collection 不存在）
          或返回 count=existing_count 的 mock collection
        - client.create_collection() 返回新 mock collection
        """
        mock_collection = MagicMock()
        mock_collection.count.return_value = existing_count
        mock_collection.add   = MagicMock()

        mock_client = MagicMock()
        if existing_count == 0:
            mock_client.get_collection.side_effect = Exception("不存在")
        else:
            mock_client.get_collection.return_value = mock_collection

        mock_client.create_collection.return_value = mock_collection
        mock_client.delete_collection = MagicMock()

        mock_chromadb = MagicMock()
        mock_chromadb.PersistentClient.return_value = mock_client

        return mock_chromadb, mock_client, mock_collection

    def test_add_called_with_correct_ids(self):
        """
        collection 不存在时，应创建新 collection 并调用 add()，
        ids 应为所有指标编码。
        """
        details = _mock_indicator_details(n=4)
        queries = build_indicator_queries(details)

        mock_chromadb, mock_client, mock_collection = self._make_mock_chromadb(existing_count=0)

        # mock 一个固定维度的 embedding
        fake_emb = [0.1] * 8

        with patch.dict("sys.modules", {"chromadb": mock_chromadb}), \
             patch("align_evidence.compute_embeddings",
                   return_value=[fake_emb for _ in queries]):
            result = build_indicator_collection(
                indicator_queries = queries,
                indicator_details = details,
                api_key           = "fake",
                base_url          = "http://fake",
                model             = "test",
                persist_dir       = "/tmp/test_chroma",
                company_name      = "测试公司",
            )

        # add() 应被调用一次
        mock_collection.add.assert_called_once()
        call_kwargs = mock_collection.add.call_args
        ids_passed  = call_kwargs.kwargs.get("ids") or call_kwargs.args[0]
        self.assertEqual(set(ids_passed), set(queries.keys()))

    def test_reuse_when_count_matches(self):
        """
        collection 已存在且 count() == 指标数时，
        不应重建（create_collection 不被调用，add 不被调用）。
        """
        details = _mock_indicator_details(n=4)
        queries = build_indicator_queries(details)
        n       = len(queries)

        mock_chromadb, mock_client, mock_collection = self._make_mock_chromadb(
            existing_count=n
        )

        with patch.dict("sys.modules", {"chromadb": mock_chromadb}), \
             patch("align_evidence.compute_embeddings") as mock_compute:
            result = build_indicator_collection(
                indicator_queries = queries,
                indicator_details = details,
                api_key           = "fake",
                base_url          = "http://fake",
                model             = "test",
                persist_dir       = "/tmp/test_chroma",
                company_name      = "测试公司",
            )

        # 复用缓存：不调用 create_collection，不调用 compute_embeddings，不调用 add
        mock_client.create_collection.assert_not_called()
        mock_compute.assert_not_called()
        mock_collection.add.assert_not_called()
        # 返回的是已存在的 collection
        self.assertEqual(result, mock_collection)

    def test_rebuild_when_count_mismatch(self):
        """
        collection 存在但 count() 与指标数不一致时，
        应删除旧 collection 并重建。
        """
        details = _mock_indicator_details(n=4)
        queries = build_indicator_queries(details)
        fake_emb = [0.1] * 8

        # count=2（少于 4）→ 应触发重建
        mock_chromadb, mock_client, mock_collection = self._make_mock_chromadb(
            existing_count=2
        )
        mock_client.create_collection.return_value = mock_collection

        with patch.dict("sys.modules", {"chromadb": mock_chromadb}), \
             patch("align_evidence.compute_embeddings",
                   return_value=[fake_emb for _ in queries]):
            build_indicator_collection(
                indicator_queries = queries,
                indicator_details = details,
                api_key           = "fake",
                base_url          = "http://fake",
                model             = "test",
                persist_dir       = "/tmp/test_chroma",
                company_name      = "测试公司",
            )

        # 应调用 delete_collection
        mock_client.delete_collection.assert_called_once()
        # 应重新创建
        mock_client.create_collection.assert_called_once()


# ==============================================================================
# 3d 测试：embed_chunks
# ==============================================================================

class TestEmbedChunks(unittest.TestCase):

    def test_empty_chunk_embedding_is_none(self):
        """char_count=0 的 chunk，embedding 应为 None，不调用 API。"""
        records = _mock_chunk_records(n=2, with_empty=True)

        fake_emb = [0.5] * 8

        with patch("align_evidence.compute_embeddings",
                   return_value=[fake_emb, fake_emb]) as mock_compute:
            result = embed_chunks(
                chunk_records = records,
                api_key       = "fake",
                base_url      = "http://fake",
                model         = "test",
            )

        # 前 2 条有文本，应有 embedding
        self.assertIsNotNone(result[0]["embedding"])
        self.assertIsNotNone(result[1]["embedding"])
        # 最后 1 条空文本，embedding 应为 None
        self.assertIsNone(result[2]["embedding"])

        # compute_embeddings 只应收到 2 条有效文本（不包含空 chunk）
        texts_passed = mock_compute.call_args.args[0]
        self.assertEqual(len(texts_passed), 2)

    def test_returns_same_length(self):
        """返回列表长度应与输入 chunk_records 完全一致。"""
        records = _mock_chunk_records(n=5)
        fake_emb = [0.1] * 4

        with patch("align_evidence.compute_embeddings",
                   return_value=[fake_emb] * 5):
            result = embed_chunks(
                chunk_records = records,
                api_key       = "fake",
                base_url      = "http://fake",
                model         = "test",
            )
        self.assertEqual(len(result), 5)

    def test_original_records_not_modified(self):
        """embed_chunks 不应修改原始 chunk_records 列表。"""
        records  = _mock_chunk_records(n=3)
        original = [dict(r) for r in records]  # 深拷贝快照
        fake_emb = [0.2] * 4

        with patch("align_evidence.compute_embeddings",
                   return_value=[fake_emb] * 3):
            embed_chunks(
                chunk_records = records,
                api_key       = "fake",
                base_url      = "http://fake",
                model         = "test",
            )

        # 原始记录不应有 "embedding" 字段
        for orig, rec in zip(original, records):
            self.assertNotIn("embedding", rec,
                             "原始 chunk_record 不应被追加 embedding 字段")

    def test_all_chunks_empty_no_api_call(self):
        """所有 chunk 均为空文本时，不应调用 compute_embeddings。"""
        records = [
            {**r, "char_count": 0, "text": ""}
            for r in _mock_chunk_records(n=3)
        ]

        with patch("align_evidence.compute_embeddings") as mock_compute:
            result = embed_chunks(
                chunk_records = records,
                api_key       = "fake",
                base_url      = "http://fake",
                model         = "test",
            )

        mock_compute.assert_not_called()
        for r in result:
            self.assertIsNone(r["embedding"])


# ==============================================================================
# 运行
# ==============================================================================

def run_all():
    """运行所有阶段三测试，打印摘要。"""
    suites = [
        unittest.TestLoader().loadTestsFromTestCase(TestBuildIndicatorQueries),
        unittest.TestLoader().loadTestsFromTestCase(TestComputeEmbeddings),
        unittest.TestLoader().loadTestsFromTestCase(TestBuildIndicatorCollection),
        unittest.TestLoader().loadTestsFromTestCase(TestEmbedChunks),
    ]
    combined = unittest.TestSuite(suites)
    runner   = unittest.TextTestRunner(verbosity=2)
    result   = runner.run(combined)
    return result


if __name__ == "__main__":
    run_all()
