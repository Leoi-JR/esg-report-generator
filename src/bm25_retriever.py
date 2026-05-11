"""
bm25_retriever.py
=================
BM25 稀疏检索模块，与 Embedding 双路检索互补。

Phase 3 新增模块：
  - 使用 rank_bm25 库 + jieba 中文分词
  - 懒加载索引，不持久化
  - 与 retrieve_evidence.py 的双路 Embedding 融合

使用方式：
  from bm25_retriever import build_bm25_index, bm25_search_batch

  # 构建索引（首次检索前调用）
  build_bm25_index(candidate_chunks)

  # 批量检索
  results = bm25_search_batch(queries, top_n=100)
"""

import os
from typing import Optional

import jieba
from rank_bm25 import BM25Okapi

# ── 路径配置 ────────────────────────────────────────────────────────────────────
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
CUSTOM_DICT_PATH = os.path.join(_ROOT, "data/processed/esg_jieba_dict.txt")

# ── 全局缓存（懒加载，不持久化）────────────────────────────────────────────────
_bm25_index: Optional[BM25Okapi] = None
_corpus_ids: Optional[list[str]] = None
_jieba_initialized: bool = False


def _init_jieba() -> None:
    """
    初始化 jieba 分词器，加载自定义词典。

    自定义词典格式：词语 词频 词性（词频和词性可选）
    示例：碳排放 100
    """
    global _jieba_initialized
    if _jieba_initialized:
        return

    if os.path.exists(CUSTOM_DICT_PATH):
        jieba.load_userdict(CUSTOM_DICT_PATH)
        print(f"  ✓ jieba 加载自定义词典：{os.path.basename(CUSTOM_DICT_PATH)}")

    # 抑制 jieba 的调试日志
    jieba.setLogLevel(jieba.logging.WARNING)
    _jieba_initialized = True


def build_bm25_index(chunks: list[dict]) -> tuple[BM25Okapi, list[str]]:
    """
    构建 BM25 索引。

    参数：
        chunks - chunk 列表，每个 chunk 需包含 chunk_id 和 text 字段

    返回：
        (bm25_index, corpus_ids)
        - bm25_index: BM25Okapi 索引对象
        - corpus_ids: 对应的 chunk_id 列表

    注意：
        - 空文本的 chunk 会被跳过
        - 索引存储在全局变量中，后续查询复用
    """
    global _bm25_index, _corpus_ids

    _init_jieba()

    corpus = []
    corpus_ids = []

    for chunk in chunks:
        text = chunk.get("text", "")
        if not text.strip():
            continue

        # jieba 分词
        tokens = list(jieba.cut(text))
        corpus.append(tokens)
        corpus_ids.append(chunk["chunk_id"])

    # 构建 BM25 索引
    _bm25_index = BM25Okapi(corpus)
    _corpus_ids = corpus_ids

    print(f"  ✓ BM25 索引构建完成：{len(corpus_ids)} 个文档")

    return _bm25_index, _corpus_ids


def get_bm25_index() -> tuple[Optional[BM25Okapi], Optional[list[str]]]:
    """
    获取已缓存的 BM25 索引。

    返回：
        (bm25_index, corpus_ids)，未初始化时返回 (None, None)
    """
    return _bm25_index, _corpus_ids


def bm25_search(
    query: str,
    top_n: int = 100,
    index: Optional[BM25Okapi] = None,
    corpus_ids: Optional[list[str]] = None,
) -> list[tuple[str, float]]:
    """
    单条 BM25 检索。

    参数：
        query - 查询文本
        top_n - 返回的 top-N 结果数
        index - BM25 索引（可选，默认使用全局缓存）
        corpus_ids - chunk_id 列表（可选，默认使用全局缓存）

    返回：
        [(chunk_id, bm25_score), ...]，按分数降序排列
    """
    if index is None or corpus_ids is None:
        index, corpus_ids = get_bm25_index()

    if index is None or corpus_ids is None:
        raise ValueError("BM25 索引未初始化，请先调用 build_bm25_index()")

    _init_jieba()

    # 对查询文本分词
    query_tokens = list(jieba.cut(query))

    # 获取所有文档的 BM25 分数
    scores = index.get_scores(query_tokens)

    # 组合 (chunk_id, score) 并排序
    indexed_scores = [(corpus_ids[i], scores[i]) for i in range(len(scores))]
    indexed_scores.sort(key=lambda x: x[1], reverse=True)

    return indexed_scores[:top_n]


def bm25_search_batch(
    queries: list[str],
    top_n: int = 100,
) -> list[list[tuple[str, float]]]:
    """
    批量 BM25 检索。

    参数：
        queries - 查询文本列表
        top_n - 每个查询返回的 top-N 结果数

    返回：
        [[(chunk_id, score), ...], ...]，外层列表对应每个查询
    """
    index, corpus_ids = get_bm25_index()

    if index is None or corpus_ids is None:
        raise ValueError("BM25 索引未初始化，请先调用 build_bm25_index()")

    results = []
    for query in queries:
        results.append(bm25_search(query, top_n, index, corpus_ids))

    return results


def reset_bm25_index() -> None:
    """
    重置 BM25 索引（用于测试或强制重建）。
    """
    global _bm25_index, _corpus_ids
    _bm25_index = None
    _corpus_ids = None
