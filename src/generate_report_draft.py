"""
generate_report_draft.py
========================
ESG 报告初稿自动生成 — 步骤 1-4：双路语义检索 + Reranking。

将 119 个报告框架叶节点通过两条检索路径与 ~5000 个企业资料文本块
做语义匹配，为每个章节检索 top-K 最相关素材。

双路检索策略：
  - retrieval_query：自然语言查询（加 Instruct 前缀），利用 query-document 匹配
  - hypothetical_doc：HyDE 假设文档（不加前缀），利用 document-document 相似度
  融合方式：Max(score_rq, score_hyde)

流程：
  步骤 1 → 双路 embedding（retrieval_query 加前缀，hypothetical_doc 不加）
  步骤 2 → 候选池过滤（top1 ≥ 0.40）+ 矩阵点积相似度粗排（双路）
  步骤 3 → Max 融合 + bi-encoder top-N 粗选 + parent_id 去重（默认 N=50）
  步骤 4 → Qwen3-Reranker-8B 精排 → 最终 top-K（默认 K=10）

Reranker 服务（需预先启动，GPU3 端口 8083）：
  CUDA_VISIBLE_DEVICES=3 conda run -n ocr python3 src/reranker_server.py

不带 --rerank 参数时跳过步骤 4，仅执行步骤 1-3（兼容无 reranker 环境）。

输出：
  data/processed/report_draft/retrieval_results.json  — 结构化检索结果（含双路分数）
  data/processed/report_draft/retrieval_test_sample.md — 全量评估文件（119 个叶节点）

运行：
  # 仅 bi-encoder（步骤 1-3）
  conda run -n esg python3 src/generate_report_draft.py

  # bi-encoder + reranker（步骤 1-4，需 reranker 服务运行中）
  conda run -n esg python3 src/generate_report_draft.py --rerank

  # 调整粗排/精排数量
  conda run -n esg python3 src/generate_report_draft.py --rerank --biencoder-n 100 --top-k 15
"""

import argparse
import glob
import json
import os
import time
from typing import Optional

import numpy as np
import pandas as pd
import requests

# ── 本项目模块 ─────────────────────────────────────────────────────────────────
from align_evidence import compute_embeddings
from config import (
    CHUNK_CACHE_PATH,
    DRAFT_BIENCODER_TOP_N,
    DRAFT_RERANKER_TOP_K,
    EMB_CACHE_PATH,
    EMBEDDING_INSTRUCT,
    EMBEDDING_MODEL,
    MIN_RELEVANCE_SCORE,
    OPENAI_API_KEY,
    OPENAI_BASE_URL,
    RERANKER_BASE_URL,
    RERANKER_INSTRUCT,
)

# ── 路径常量 ───────────────────────────────────────────────────────────────────
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)

FRAMEWORK_QUERIES_PATH = os.path.join(
    _ROOT, "data/processed/framework_retrieval_queries.json"
)
ALIGNMENT_TABLE_GLOB = os.path.join(_ROOT, "data/processed/对齐表_*.xlsx")
OUTPUT_DIR = os.path.join(_ROOT, "data/processed/report_draft")


# ==============================================================================
# 步骤 1：加载框架查询 + 双路 Embedding
# ==============================================================================

def load_framework_queries() -> list[dict]:
    """加载 framework_retrieval_queries.json，返回 119 条叶节点记录。"""
    with open(FRAMEWORK_QUERIES_PATH, "r", encoding="utf-8") as f:
        queries = json.load(f)
    print(f"  ✓ 加载报告框架叶节点：{len(queries)} 条")
    return queries


def _normalize_embeddings(matrix: np.ndarray, label: str = "") -> np.ndarray:
    """L2 归一化 embedding 矩阵，检查空向量。"""
    norms = np.linalg.norm(matrix, axis=1)
    n_empty = int((norms < 1e-9).sum())
    if n_empty > 0:
        print(f"  ⚠ {n_empty} 条 {label} embedding 为空向量")

    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms = np.where(norms < 1e-9, 1.0, norms)
    return matrix / norms


def embed_queries_dual(queries: list[dict]) -> tuple[np.ndarray, np.ndarray]:
    """
    双路 embedding：分别计算 retrieval_query 和 hypothetical_doc 的向量。

    - retrieval_query：添加 Instruct 前缀（query-document 匹配模式）
    - hypothetical_doc：不加前缀（document-document 相似度，符合 HyDE 原理）

    返回：
        (rq_embs, hyde_embs)，均为 (N, 4096) numpy 数组，已 L2 归一化
    """
    print(f"\n[步骤1] 双路 embedding 计算...")

    # ── 路径 1：retrieval_query（加 Instruct 前缀）──
    rq_texts = []
    for q in queries:
        raw = q["retrieval_query"]
        if EMBEDDING_INSTRUCT:
            rq_texts.append(f"Instruct: {EMBEDDING_INSTRUCT}\nQuery: {raw}")
        else:
            rq_texts.append(raw)

    print(f"  [1a] retrieval_query（{len(rq_texts)} 条，加 Instruct 前缀）...")
    rq_embeddings = compute_embeddings(
        rq_texts,
        api_key=OPENAI_API_KEY,
        base_url=OPENAI_BASE_URL,
        model=EMBEDDING_MODEL,
        batch_size=100,
        label="retrieval_query",
    )
    rq_matrix = np.array(rq_embeddings, dtype=np.float32)
    rq_matrix = _normalize_embeddings(rq_matrix, "retrieval_query")
    print(f"       ✓ retrieval_query embedding：{rq_matrix.shape}")

    # ── 路径 2：hypothetical_doc（不加前缀，与文档同空间）──
    hyde_texts = [q["hypothetical_doc"] for q in queries]

    print(f"  [1b] hypothetical_doc（{len(hyde_texts)} 条，不加前缀 / HyDE 模式）...")
    hyde_embeddings = compute_embeddings(
        hyde_texts,
        api_key=OPENAI_API_KEY,
        base_url=OPENAI_BASE_URL,
        model=EMBEDDING_MODEL,
        batch_size=100,
        label="hypothetical_doc",
    )
    hyde_matrix = np.array(hyde_embeddings, dtype=np.float32)
    hyde_matrix = _normalize_embeddings(hyde_matrix, "hypothetical_doc")
    print(f"       ✓ hypothetical_doc embedding：{hyde_matrix.shape}")

    return rq_matrix, hyde_matrix


# ==============================================================================
# 步骤 2：加载候选池 + 相似度计算
# ==============================================================================

def _find_latest_alignment_table() -> str:
    """glob 匹配 对齐表_*.xlsx，按文件名日期降序取最新版本。"""
    matches = sorted(glob.glob(ALIGNMENT_TABLE_GLOB), reverse=True)
    if not matches:
        raise FileNotFoundError(
            f"未找到对齐表文件：{ALIGNMENT_TABLE_GLOB}\n"
            "请先运行 align_evidence.py 生成对齐表。"
        )
    return matches[0]


def _parse_top1_score(semantic_top5: str) -> float:
    """
    从 semantic_top5 字符串解析 top1 相似度分数。

    格式："GA1:0.52, EB10:0.45, ..."  → 0.52
    空值或解析失败返回 0.0。
    """
    if not isinstance(semantic_top5, str) or not semantic_top5.strip():
        return 0.0
    first = semantic_top5.split(",")[0].strip()
    try:
        return float(first.split(":")[1])
    except (IndexError, ValueError):
        return 0.0


def load_candidate_pool() -> tuple[list[dict], np.ndarray]:
    """
    加载文本块及其 embedding，过滤低质量块，返回候选池。

    过滤条件：
      - valid_mask == True（embedding 有效）
      - 对齐表 top1 score ≥ MIN_RELEVANCE_SCORE (0.40)
      - 排除「类型：照片」的图片描述（对撰稿帮助不大）

    返回：
      (candidate_chunks, candidate_embs)
      - candidate_chunks: 候选 chunk 记录列表
      - candidate_embs:   对应 embedding 矩阵 (N_candidates, 4096)
    """
    # ── 加载 chunks_cache.json ──
    print(f"\n[步骤2] 加载候选池...")
    with open(CHUNK_CACHE_PATH, "r", encoding="utf-8") as f:
        all_chunks = json.load(f)
    print(f"  文本块总数：{len(all_chunks)}")

    # ── 加载 embedding 缓存 ──
    data = np.load(EMB_CACHE_PATH)
    all_embs = data["embeddings"]      # (7074, 4096) float32
    valid_mask = data["valid_mask"]     # (7074,) bool
    print(f"  embedding 矩阵：{all_embs.shape}，有效：{int(valid_mask.sum())}")

    if len(all_chunks) != all_embs.shape[0]:
        raise ValueError(
            f"chunks_cache ({len(all_chunks)}) 与 embedding 缓存 "
            f"({all_embs.shape[0]}) 数量不一致"
        )

    # ── 加载对齐表，提取 top1 score ──
    alignment_path = _find_latest_alignment_table()
    print(f"  对齐表：{os.path.basename(alignment_path)}")

    df = pd.read_excel(alignment_path, sheet_name="Sheet1")
    df["_top1_score"] = df["semantic_top5"].apply(_parse_top1_score)

    # 建立 chunk_id → top1_score 映射（对齐表排序与 chunks_cache 不同）
    top1_map = dict(zip(df["chunk_id"], df["_top1_score"]))

    # ── 过滤 ──
    candidate_indices = []
    n_invalid_emb = 0
    n_low_score = 0
    n_not_in_table = 0
    n_photo_excluded = 0  # 新增：照片排除计数

    for i, chunk in enumerate(all_chunks):
        if not valid_mask[i]:
            n_invalid_emb += 1
            continue
        score = top1_map.get(chunk["chunk_id"])
        if score is None:
            n_not_in_table += 1
            continue
        if score < MIN_RELEVANCE_SCORE:
            n_low_score += 1
            continue

        # 新增：排除照片类型的图片描述
        text = chunk.get("text", "")
        if "类型：照片" in text:
            n_photo_excluded += 1
            continue

        candidate_indices.append(i)

    # 提取候选子集
    candidate_chunks = [all_chunks[i] for i in candidate_indices]
    candidate_embs = all_embs[candidate_indices]

    # 统计报告
    print(f"  过滤结果：")
    print(f"    候选池：{len(candidate_chunks)} 条 "
          f"({100 * len(candidate_chunks) / len(all_chunks):.1f}%)")
    if n_invalid_emb:
        print(f"    排除（无效 embedding）：{n_invalid_emb}")
    print(f"    排除（top1 < {MIN_RELEVANCE_SCORE}）：{n_low_score}")
    if n_photo_excluded:
        print(f"    排除（照片描述）：{n_photo_excluded}")
    if n_not_in_table:
        print(f"    排除（不在对齐表中）：{n_not_in_table}")

    return candidate_chunks, candidate_embs


def compute_similarity(
    query_embs: np.ndarray, candidate_embs: np.ndarray
) -> np.ndarray:
    """
    计算查询向量与候选向量的余弦相似度矩阵。

    所有向量已 L2 归一化，因此 cosine similarity = 矩阵点积。

    返回：(n_queries, n_candidates) float32 矩阵。
    """
    return query_embs @ candidate_embs.T


def compute_dual_similarity(
    rq_embs: np.ndarray,
    hyde_embs: np.ndarray,
    candidate_embs: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    计算双路相似度矩阵并融合。

    参数：
        rq_embs:        retrieval_query embedding (n_queries, dim)
        hyde_embs:      hypothetical_doc embedding (n_queries, dim)
        candidate_embs: 候选文档 embedding (n_candidates, dim)

    返回：
        (scores_rq, scores_hyde, scores_fused)
        - scores_rq:    retrieval_query 相似度 (n_queries, n_candidates)
        - scores_hyde:  hypothetical_doc 相似度 (n_queries, n_candidates)
        - scores_fused: Max 融合分数 (n_queries, n_candidates)
    """
    print(f"\n  计算双路相似度矩阵...")
    scores_rq = compute_similarity(rq_embs, candidate_embs)
    scores_hyde = compute_similarity(hyde_embs, candidate_embs)

    # Max 融合：取两者较大值
    scores_fused = np.maximum(scores_rq, scores_hyde)

    print(f"    retrieval_query 相似度：{scores_rq.shape}，"
          f"均值={scores_rq.mean():.4f}")
    print(f"    hypothetical_doc 相似度：{scores_hyde.shape}，"
          f"均值={scores_hyde.mean():.4f}")
    print(f"    融合后（Max）：均值={scores_fused.mean():.4f}")

    return scores_rq, scores_hyde, scores_fused


# ==============================================================================
# 步骤 3：Top-K 选取 + 去重（双路分数记录）
# ==============================================================================

# 双路分数差距阈值：差距 < 此值时标记为 "both"
SOURCE_DIFF_THRESHOLD = 0.02


def _determine_source(score_rq: float, score_hyde: float) -> str:
    """判断 chunk 主要由哪条路径贡献（rq / hyde / both）。"""
    diff = abs(score_rq - score_hyde)
    if diff < SOURCE_DIFF_THRESHOLD:
        return "both"
    return "retrieval_query" if score_rq > score_hyde else "hypothetical_doc"


def select_topk(
    scores_rq: np.ndarray,
    scores_hyde: np.ndarray,
    scores_fused: np.ndarray,
    candidate_chunks: list[dict],
    queries: list[dict],
    k: int = DRAFT_BIENCODER_TOP_N,
) -> list[dict]:
    """
    为每个叶节点选取 top-K 最相关的 chunk，按 parent_id 去重。

    基于融合分数（Max）排序，同时记录双路原始分数以便分析。

    当启用 reranker 时，k 应设为 DRAFT_BIENCODER_TOP_N（粗排候选数，默认 50），
    粗排结果随后送入 rerank_results() 精排到 DRAFT_RERANKER_TOP_K（默认 10）。
    不启用 reranker 时，k 直接设为最终需要的数量。

    去重策略：同一 parent_id 仅保留相似度最高的 chunk，空出的名额
    由后续候选递补。确保 top-K 的信息来源尽可能多样化。

    返回：
      List[dict]，长度 == len(queries)，每条结构：
      {
        "id", "full_path", "leaf_title", "gloss",
        "retrieval_query", "hypothetical_doc",
        "top_chunks": [{"rank", "score", "score_rq", "score_hyde", "source",
                        "chunk_id", "parent_id", "file_name", "folder_code",
                        "page_or_sheet", "text", "parent_text"}],
        "stats": {"avg_score", "max_score", "chunk_count", "source_files",
                  "source_distribution": {"retrieval_query", "hypothetical_doc", "both"}}
      }
    """
    print(f"\n[步骤3] Top-{k} 选取（含 parent_id 去重 + 双路分数记录）...")

    n_queries = scores_fused.shape[0]
    # 预排序：每行按融合分数降序排列的列索引
    sorted_indices = np.argsort(-scores_fused, axis=1)

    results = []
    dedup_stats = {"total_deduped": 0}
    global_source_dist = {"retrieval_query": 0, "hypothetical_doc": 0, "both": 0}

    for qi in range(n_queries):
        q = queries[qi]
        row_fused = scores_fused[qi]
        row_rq = scores_rq[qi]
        row_hyde = scores_hyde[qi]
        row_sorted = sorted_indices[qi]

        # 按 parent_id 去重，遍历排序后的候选
        seen_parents = set()
        top_chunks = []
        source_dist = {"retrieval_query": 0, "hypothetical_doc": 0, "both": 0}

        for ci in row_sorted:
            if len(top_chunks) >= k:
                break

            chunk = candidate_chunks[ci]
            parent_id = chunk.get("parent_id", "")

            if parent_id in seen_parents:
                dedup_stats["total_deduped"] += 1
                continue

            seen_parents.add(parent_id)

            score_rq_val = float(row_rq[ci])
            score_hyde_val = float(row_hyde[ci])
            source = _determine_source(score_rq_val, score_hyde_val)
            source_dist[source] += 1
            global_source_dist[source] += 1

            top_chunks.append({
                "rank": len(top_chunks) + 1,
                "score": round(float(row_fused[ci]), 4),
                "score_rq": round(score_rq_val, 4),
                "score_hyde": round(score_hyde_val, 4),
                "source": source,
                "chunk_id": chunk["chunk_id"],
                "parent_id": parent_id,
                "file_name": chunk.get("file_name", ""),
                "folder_code": chunk.get("folder_code", ""),
                "page_or_sheet": chunk.get("page_or_sheet", ""),
                "text": chunk.get("text", ""),
                "parent_text": chunk.get("parent_text", ""),
            })

        # 统计
        chunk_scores = [c["score"] for c in top_chunks]
        source_files = sorted(set(c["file_name"] for c in top_chunks))

        results.append({
            "id": q["id"],
            "full_path": q["full_path"],
            "leaf_title": q["leaf_title"],
            "gloss": q.get("gloss", ""),
            "retrieval_query": q["retrieval_query"],
            "hypothetical_doc": q.get("hypothetical_doc", ""),
            "top_chunks": top_chunks,
            "stats": {
                "avg_score": round(sum(chunk_scores) / len(chunk_scores), 4)
                             if chunk_scores else 0,
                "max_score": round(max(chunk_scores), 4) if chunk_scores else 0,
                "chunk_count": len(top_chunks),
                "source_files": source_files,
                "source_distribution": source_dist,
            },
        })

    # 打印汇总统计
    avg_scores = [r["stats"]["avg_score"] for r in results]
    chunk_counts = [r["stats"]["chunk_count"] for r in results]
    total_chunks = sum(chunk_counts)

    print(f"  ✓ 完成 {len(results)} 个叶节点检索")
    print(f"    去重移除：{dedup_stats['total_deduped']} 个同源 chunk")
    print(f"    平均 score：{np.mean(avg_scores):.4f} "
          f"(min={np.min(avg_scores):.4f}, max={np.max(avg_scores):.4f})")
    print(f"    平均 chunk 数：{np.mean(chunk_counts):.1f} "
          f"(满额 {k} 的有 {sum(1 for c in chunk_counts if c >= k)} 个)")

    # 双路来源分布
    print(f"    来源分布（总 {total_chunks} chunks）：")
    for src, cnt in global_source_dist.items():
        pct = 100 * cnt / total_chunks if total_chunks else 0
        print(f"      {src}: {cnt} ({pct:.1f}%)")

    return results


# ==============================================================================
# 步骤 4：Reranker 精排
# ==============================================================================

def _call_reranker(query: str, documents: list[str], base_url: str) -> list[float]:
    """
    调用 reranker_server.py 的 /rerank 接口，返回与 documents 等长的分数列表。

    分数为 0-1 概率值，越高越相关。
    发生网络错误或服务不可用时抛出异常。
    """
    url = f"{base_url.rstrip('/')}/rerank"
    payload = {
        "query": query,
        "documents": documents,
        "task": RERANKER_INSTRUCT,
    }
    resp = requests.post(url, json=payload, timeout=120)
    resp.raise_for_status()
    data = resp.json()
    # results 列表与 documents 顺序一一对应
    scores = [item["score"] for item in data["results"]]
    return scores


def rerank_results(
    results: list[dict],
    final_k: int = DRAFT_RERANKER_TOP_K,
    reranker_url: str = RERANKER_BASE_URL,
) -> list[dict]:
    """
    对步骤 3 的粗排结果做 reranker 精排，将每个叶节点的 top_chunks 缩减到 final_k。

    步骤 3 输出的 top_chunks 数量 = DRAFT_BIENCODER_TOP_N（粗排候选），
    本函数用 Qwen3-Reranker-8B 对每对 (retrieval_query, chunk_text) 打分，
    按分数降序重新排列，取前 final_k 条。

    字段变化：
      - score → reranker 分数
      - score_biencoder → 原 bi-encoder 融合分数
      - biencoder_rank → 粗排时的原始排名
      - rank → 精排后的新排名

    stats 字段更新：
      - avg_score/max_score → 基于 reranker 分数
      - rank_changes → 排名变化统计（improved/declined/unchanged）
      - biencoder_stats → 保留粗排阶段的统计（用于对比）

    参数：
        results      - select_topk() 的输出（粗排结果）
        final_k      - 精排后保留的 chunk 数
        reranker_url - reranker 服务地址

    返回：
        更新后的 results 列表（in-place 修改 top_chunks，其余字段不变）
    """
    print(f"\n[步骤4] Reranker 精排（粗排 {DRAFT_BIENCODER_TOP_N} → 精排 {final_k}）...")

    t_total = time.time()
    n_api_calls = 0

    # 全局排名变化统计
    global_rank_changes = {"improved": 0, "declined": 0, "unchanged": 0}

    for qi, r in enumerate(results):
        chunks = r["top_chunks"]
        if not chunks:
            continue

        # 保存粗排阶段的统计信息
        biencoder_stats = {
            "avg_score": r["stats"]["avg_score"],
            "max_score": r["stats"]["max_score"],
            "source_distribution": r["stats"].get("source_distribution", {}),
        }

        # 记录每个 chunk 的 bi-encoder 原始排名
        for chunk in chunks:
            chunk["biencoder_rank"] = chunk["rank"]
            chunk["score_biencoder"] = chunk["score"]  # 保存融合分数

        # 构造 query：full_path + gloss + retrieval_query 三者拼接，
        # 让 reranker 理解章节背景，避免只靠 retrieval_query 短语
        query_text = (
            f"章节：{r['full_path']}\n"
            f"说明：{r['gloss']}\n"
            f"检索描述：{r['retrieval_query']}"
        )
        documents = [c["text"] for c in chunks]

        try:
            reranker_scores = _call_reranker(query_text, documents, reranker_url)
            n_api_calls += 1
        except Exception as e:
            print(f"  ⚠ [{qi+1}/{len(results)}] {r['leaf_title']} reranker 调用失败：{e}")
            print(f"     跳过精排，保留粗排结果前 {final_k} 条")
            r["top_chunks"] = chunks[:final_k]
            _update_stats_with_biencoder(r, biencoder_stats, global_rank_changes, skipped=True)
            continue

        # 将 reranker 分数绑定到对应 chunk
        for chunk, rs in zip(chunks, reranker_scores):
            chunk["score"] = round(rs, 6)  # 更新为 reranker 分

        # 按 reranker 分降序，取 final_k
        reranked = sorted(chunks, key=lambda c: c["score"], reverse=True)[:final_k]

        # 重新编号 rank，并统计排名变化
        rank_changes = {"improved": 0, "declined": 0, "unchanged": 0}
        for i, chunk in enumerate(reranked, 1):
            old_rank = chunk["biencoder_rank"]
            new_rank = i
            chunk["rank"] = new_rank

            # 判断排名变化（排名数字越小越好）
            if new_rank < old_rank:
                rank_changes["improved"] += 1
            elif new_rank > old_rank:
                rank_changes["declined"] += 1
            else:
                rank_changes["unchanged"] += 1

        # 累加到全局统计
        for k in rank_changes:
            global_rank_changes[k] += rank_changes[k]

        r["top_chunks"] = reranked
        _update_stats_with_biencoder(r, biencoder_stats, rank_changes)

    elapsed = time.time() - t_total
    avg_scores = [r["stats"]["avg_score"] for r in results]
    total_chunks = sum(r["stats"]["chunk_count"] for r in results)

    print(f"  ✓ Reranker 精排完成，{n_api_calls} 次 API 调用，耗时 {elapsed:.1f}s")
    print(f"    精排后平均 score：{np.mean(avg_scores):.4f} "
          f"(min={np.min(avg_scores):.4f}, max={np.max(avg_scores):.4f})")

    # 打印排名变化统计
    print(f"    排名变化（总 {total_chunks} chunks）：")
    for change_type, cnt in global_rank_changes.items():
        pct = 100 * cnt / total_chunks if total_chunks else 0
        symbol = {"improved": "↑", "declined": "↓", "unchanged": "="}.get(change_type, "")
        print(f"      {symbol} {change_type}: {cnt} ({pct:.1f}%)")

    return results


def _update_stats_with_biencoder(
    r: dict,
    biencoder_stats: dict,
    rank_changes: dict,
    skipped: bool = False,
) -> None:
    """
    更新 stats 字段，包含 reranker 统计和 bi-encoder 对比信息。

    参数：
        r              - 单个叶节点结果
        biencoder_stats - 粗排阶段的统计信息
        rank_changes   - 排名变化统计（improved/declined/unchanged）
        skipped        - 是否跳过了 reranker（API 调用失败时）
    """
    chunks = r["top_chunks"]
    scores = [c["score"] for c in chunks]

    r["stats"] = {
        # Reranker 后的统计
        "avg_score":    round(sum(scores) / len(scores), 4) if scores else 0,
        "max_score":    round(max(scores), 4) if scores else 0,
        "chunk_count":  len(chunks),
        "source_files": sorted(set(c["file_name"] for c in chunks)),

        # 排名变化统计
        "rank_changes": rank_changes if not skipped else None,
        "reranker_skipped": skipped,

        # 保留 bi-encoder 阶段统计用于对比
        "biencoder_stats": biencoder_stats,
    }


# ==============================================================================
# 输出：保存检索结果 + 评估文件
# ==============================================================================

def save_retrieval_results(results: list[dict], output_dir: str) -> str:
    """
    保存 119 组检索结果到 JSON 文件。

    返回输出文件路径。
    """
    os.makedirs(output_dir, exist_ok=True)
    out_path = os.path.join(output_dir, "retrieval_results.json")

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    size_mb = os.path.getsize(out_path) / 1024 / 1024
    print(f"\n  ✓ 检索结果已保存：{out_path} ({size_mb:.1f} MB)")
    return out_path


def write_evaluation_sample(
    results: list[dict],
    output_dir: str,
    parent_text_max: int = 2000,
) -> str:
    """
    生成全量检索质量评估 Markdown 文件（119 个叶节点全部输出）。

    每个叶节点展示 top-K 匹配详情，包含：
    - 双路分数（score_rq / score_hyde）和来源标记
    - Reranker 模式下额外显示排名变化（biencoder_rank → rank）
    - text（分块文本，完整展示）
    - parent_text（section 原文，超过 parent_text_max 字符时截断）

    返回输出文件路径。
    """
    os.makedirs(output_dir, exist_ok=True)
    out_path = os.path.join(output_dir, "retrieval_test_sample.md")

    # ── 检测是否为 reranker 模式 ──
    has_reranker = any(
        "biencoder_rank" in c
        for r in results
        for c in r["top_chunks"]
    )

    # ── 统计 parent_text 长度分布 ──
    all_parent_lens = []
    for r in results:
        for c in r["top_chunks"]:
            all_parent_lens.append(len(c.get("parent_text", "")))
    pt_arr = np.array(all_parent_lens) if all_parent_lens else np.array([0])
    n_same = sum(1 for r in results for c in r["top_chunks"]
                 if c.get("text", "") == c.get("parent_text", ""))
    n_total_chunks = sum(len(r["top_chunks"]) for r in results)

    # ── 统计双路来源分布（从最终结果的 top_chunks 中统计）──
    global_source_dist = {"retrieval_query": 0, "hypothetical_doc": 0, "both": 0}
    for r in results:
        for c in r["top_chunks"]:
            src = c.get("source", "")
            if src in global_source_dist:
                global_source_dist[src] += 1

    # ── 统计全局排名变化（reranker 模式）──
    global_rank_changes = {"improved": 0, "declined": 0, "unchanged": 0}
    if has_reranker:
        for r in results:
            rc = r["stats"].get("rank_changes")
            if rc:
                for k in global_rank_changes:
                    global_rank_changes[k] += rc.get(k, 0)

    # ── 生成 Markdown ──
    title = "# 检索质量评估 — 全量报告（双路检索" + (" + Reranker）\n" if has_reranker else "）\n")
    lines = [
        title,
        f"> 叶节点：{len(results)} 个（全量输出）\n",
        f"> 生成时间：{time.strftime('%Y-%m-%d %H:%M:%S')}\n",
        f"> parent_text 截断阈值：{parent_text_max} 字符\n",
        "",
        "## 双路检索说明\n",
        "- **retrieval_query (RQ)**：自然语言查询，加 Instruct 前缀，利用 query-document 匹配",
        "- **hypothetical_doc (HyDE)**：假设文档，不加前缀，利用 document-document 相似度",
        "- **融合策略**：Max(score_rq, score_hyde)",
        "- **来源判定**：|RQ - HyDE| < 0.02 时标记为 both，否则取较高者",
        "",
    ]

    if has_reranker:
        lines.extend([
            "## Reranker 精排说明\n",
            "- **模型**：Qwen3-Reranker-8B",
            "- **输入**：章节路径 + 释义 + retrieval_query → chunk text",
            "- **输出**：相关性概率 (0-1)，用于重新排序",
            "",
            "### 全局排名变化统计\n",
            f"- 总 chunk 数：{n_total_chunks}",
        ])
        for change_type, cnt in global_rank_changes.items():
            pct = 100 * cnt / n_total_chunks if n_total_chunks else 0
            symbol = {"improved": "↑", "declined": "↓", "unchanged": "="}.get(change_type, "")
            lines.append(f"- {symbol} {change_type}：{cnt} ({pct:.1f}%)")
        lines.append("")

    lines.extend([
        "### 全局来源分布（Bi-encoder 阶段）\n",
        f"- 总 chunk 数：{n_total_chunks}",
    ])
    for src, cnt in global_source_dist.items():
        pct = 100 * cnt / n_total_chunks if n_total_chunks else 0
        lines.append(f"- {src}：{cnt} ({pct:.1f}%)")

    lines.extend([
        "",
        "### parent_text 长度统计\n",
        f"- text == parent_text（未被切割）：{n_same} "
        f"({100 * n_same / n_total_chunks:.1f}%)" if n_total_chunks else "",
        f"- parent_text 长度："
        f"min={int(pt_arr.min())}, median={int(np.median(pt_arr))}, "
        f"mean={int(pt_arr.mean())}, max={int(pt_arr.max())}",
        f"- 超过 {parent_text_max} 字符的：{int((pt_arr > parent_text_max).sum())} "
        f"({100 * (pt_arr > parent_text_max).sum() / len(pt_arr):.1f}%)",
        "",
        "---\n",
    ])

    for idx, r in enumerate(results, 1):
        lines.append(f"## [{idx}/{len(results)}] {r['full_path']}\n")
        lines.append(f"- **叶节点**：{r['leaf_title']}")
        lines.append(f"- **释义 (gloss)**：{r['gloss']}")
        lines.append(f"- **retrieval_query**：{r['retrieval_query']}")

        # 显示 hypothetical_doc（截断显示前 300 字符）
        hyde_text = r.get('hypothetical_doc', '')
        hyde_display = hyde_text[:300] + "..." if len(hyde_text) > 300 else hyde_text
        lines.append(f"- **hypothetical_doc**：{hyde_display}")

        stats = r["stats"]
        lines.append(f"- **统计**：匹配 {stats['chunk_count']} 条，"
                      f"avg_score={stats['avg_score']:.4f}，"
                      f"max_score={stats['max_score']:.4f}")

        # Reranker 模式下显示排名变化
        if has_reranker:
            rc = stats.get("rank_changes")
            if rc:
                lines.append(f"- **排名变化**：↑ improved: {rc.get('improved', 0)}, "
                             f"↓ declined: {rc.get('declined', 0)}, "
                             f"= unchanged: {rc.get('unchanged', 0)}")
            # 显示 bi-encoder 阶段统计
            be_stats = stats.get("biencoder_stats", {})
            if be_stats:
                lines.append(f"- **Bi-encoder 阶段**：avg_score={be_stats.get('avg_score', 0):.4f}")

        # 来源分布（从当前 top_chunks 统计）
        chunk_src_dist = {"retrieval_query": 0, "hypothetical_doc": 0, "both": 0}
        for c in r["top_chunks"]:
            src = c.get("source", "")
            if src in chunk_src_dist:
                chunk_src_dist[src] += 1
        src_str = ", ".join(f"{k}: {v}" for k, v in chunk_src_dist.items() if v > 0)
        if src_str:
            lines.append(f"- **来源分布**：{src_str}")
        lines.append(f"- **来源文件**：{', '.join(stats['source_files'])}")
        lines.append("")

        # Top chunks 表格（根据是否有 reranker 调整列）
        if has_reranker:
            lines.append("| 精排 | 粗排 | 变化 | Rerank分 | BE分 | RQ分 | HyDE分 | 来源 | 文件名 |")
            lines.append("|------|------|------|----------|------|------|--------|------|--------|")
            for chunk in r["top_chunks"]:
                new_rank = chunk['rank']
                old_rank = chunk.get('biencoder_rank', new_rank)
                diff = old_rank - new_rank  # 正数表示提升
                if diff > 0:
                    change_str = f"↑{diff}"
                elif diff < 0:
                    change_str = f"↓{-diff}"
                else:
                    change_str = "="

                src_label = {"retrieval_query": "RQ", "hypothetical_doc": "HyDE", "both": "BOTH"}.get(
                    chunk.get("source", ""), "?"
                )
                be_score = chunk.get('score_biencoder', chunk.get('score', 0))
                lines.append(
                    f"| {new_rank} "
                    f"| {old_rank} "
                    f"| {change_str} "
                    f"| {chunk['score']:.4f} "
                    f"| {be_score:.4f} "
                    f"| {chunk.get('score_rq', 0):.4f} "
                    f"| {chunk.get('score_hyde', 0):.4f} "
                    f"| {src_label} "
                    f"| {chunk['file_name'][:25]}{'...' if len(chunk['file_name']) > 25 else ''} |"
                )
        else:
            lines.append("| 排名 | 融合分 | RQ分 | HyDE分 | 来源 | 文件名 | 编码 |")
            lines.append("|------|--------|------|--------|------|--------|------|")
            for chunk in r["top_chunks"]:
                src_label = {"retrieval_query": "RQ", "hypothetical_doc": "HyDE", "both": "BOTH"}.get(
                    chunk.get("source", ""), "?"
                )
                lines.append(
                    f"| {chunk['rank']} "
                    f"| {chunk['score']:.4f} "
                    f"| {chunk.get('score_rq', 0):.4f} "
                    f"| {chunk.get('score_hyde', 0):.4f} "
                    f"| {src_label} "
                    f"| {chunk['file_name'][:30]}{'...' if len(chunk['file_name']) > 30 else ''} "
                    f"| {chunk['folder_code']} |"
                )
        lines.append("")

        # 详细展示每个 chunk
        for chunk in r["top_chunks"]:
            text = chunk.get("text", "")
            parent_text = chunk.get("parent_text", "")
            is_same = (text == parent_text)
            src_label = {"retrieval_query": "RQ", "hypothetical_doc": "HyDE", "both": "BOTH"}.get(
                chunk.get("source", ""), "?"
            )

            # 构建标题行
            if has_reranker:
                old_rank = chunk.get('biencoder_rank', chunk['rank'])
                diff = old_rank - chunk['rank']
                change_str = f"↑{diff}" if diff > 0 else (f"↓{-diff}" if diff < 0 else "=")
                be_score = chunk.get('score_biencoder', 0)
                header = (f"### Top {chunk['rank']} (粗排 {old_rank}, {change_str})  "
                          f"Rerank={chunk['score']:.4f}, BE={be_score:.4f}, "
                          f"RQ={chunk.get('score_rq', 0):.4f}, HyDE={chunk.get('score_hyde', 0):.4f}, "
                          f"来源={src_label}\n")
            else:
                header = (f"### Top {chunk['rank']}  "
                          f"(score={chunk['score']:.4f}, "
                          f"RQ={chunk.get('score_rq', 0):.4f}, "
                          f"HyDE={chunk.get('score_hyde', 0):.4f}, "
                          f"来源={src_label})\n")

            lines.append(header)
            lines.append(f"- 文件：`{chunk['file_name']}` "
                          f"| 编码：`{chunk['folder_code']}` "
                          f"| 页/sheet：`{chunk['page_or_sheet']}`")
            lines.append(f"- chunk_id：`{chunk['chunk_id']}`")
            lines.append(f"- text 长度：{len(text)} 字符"
                          f" | parent_text 长度：{len(parent_text)} 字符"
                          f"{' （同 text）' if is_same else ''}")

            # text: 完整展示
            text_display = text.replace("\n", " ")
            lines.append(f"\n**text（分块文本）：**\n")
            lines.append(f"> {text_display}\n")

            # parent_text: 仅在与 text 不同时展示
            if not is_same:
                pt_display = parent_text[:parent_text_max].replace("\n", " ")
                truncated = "…（已截断）" if len(parent_text) > parent_text_max else ""
                lines.append(f"**parent_text（section 原文，"
                              f"{len(parent_text)} 字符）：**\n")
                lines.append(f"> {pt_display}{truncated}\n")

        lines.append("---\n")

    # ── 附录：全局 score 分布 ──
    all_avg = [r["stats"]["avg_score"] for r in results]
    score_label = "Reranker" if has_reranker else "Bi-encoder"
    lines.append(f"## 附录：全局 avg_score 分布（{score_label}）\n")
    lines.append("| 区间 | 数量 | 占比 |")
    lines.append("|------|------|------|")

    brackets = [
        ("≥ 0.60", lambda s: s >= 0.60),
        ("0.50-0.59", lambda s: 0.50 <= s < 0.60),
        ("0.40-0.49", lambda s: 0.40 <= s < 0.50),
        ("0.30-0.39", lambda s: 0.30 <= s < 0.40),
        ("< 0.30", lambda s: s < 0.30),
    ]
    for label, pred in brackets:
        n = sum(1 for s in all_avg if pred(s))
        pct = 100 * n / len(all_avg) if all_avg else 0
        lines.append(f"| {label} | {n} | {pct:.1f}% |")

    lines.append("")

    # 最弱章节 top 5
    weakest = sorted(results, key=lambda r: r["stats"]["avg_score"])[:5]
    lines.append("### 最弱章节（avg_score 最低 5 个）\n")
    if has_reranker:
        lines.append("| ID | 章节 | Rerank分 | BE分 | chunk 数 |")
        lines.append("|----|------|----------|------|----------|")
        for r in weakest:
            be_avg = r["stats"].get("biencoder_stats", {}).get("avg_score", 0)
            lines.append(f"| {r['id']} | {r['leaf_title']} | "
                          f"{r['stats']['avg_score']:.4f} | {be_avg:.4f} | "
                          f"{r['stats']['chunk_count']} |")
    else:
        lines.append("| ID | 章节 | avg_score | chunk 数 | 主要来源 |")
        lines.append("|----|------|-----------|----------|----------|")
        for r in weakest:
            src_dist = r["stats"].get("source_distribution", {})
            main_src = max(src_dist.keys(), key=lambda k: src_dist.get(k, 0)) if src_dist else "-"
            lines.append(f"| {r['id']} | {r['leaf_title']} | "
                          f"{r['stats']['avg_score']:.4f} | "
                          f"{r['stats']['chunk_count']} | {main_src} |")

    # 双路效果对比（仅在非 reranker 模式下）
    if not has_reranker:
        lines.append("\n### 双路检索效果对比\n")
        lines.append("| 指标 | retrieval_query | hypothetical_doc | both |")
        lines.append("|------|-----------------|------------------|------|")
        lines.append(f"| chunk 数量 | {global_source_dist.get('retrieval_query', 0)} "
                     f"| {global_source_dist.get('hypothetical_doc', 0)} "
                     f"| {global_source_dist.get('both', 0)} |")

        # 按来源计算平均分
        rq_scores, hyde_scores, both_scores = [], [], []
        for r in results:
            for c in r["top_chunks"]:
                src = c.get("source", "")
                if src == "retrieval_query":
                    rq_scores.append(c["score"])
                elif src == "hypothetical_doc":
                    hyde_scores.append(c["score"])
                else:
                    both_scores.append(c["score"])

        rq_avg = np.mean(rq_scores) if rq_scores else 0
        hyde_avg = np.mean(hyde_scores) if hyde_scores else 0
        both_avg = np.mean(both_scores) if both_scores else 0
        lines.append(f"| 平均融合分 | {rq_avg:.4f} | {hyde_avg:.4f} | {both_avg:.4f} |")

    # Reranker 效果总结（仅在 reranker 模式下）
    if has_reranker:
        lines.append("\n### Reranker 效果总结\n")
        lines.append("| 指标 | Bi-encoder | Reranker | 提升 |")
        lines.append("|------|------------|----------|------|")

        # 计算平均 bi-encoder 分数
        be_avg_all = []
        for r in results:
            be_stats = r["stats"].get("biencoder_stats", {})
            if be_stats:
                be_avg_all.append(be_stats.get("avg_score", 0))

        be_overall_avg = np.mean(be_avg_all) if be_avg_all else 0
        rr_overall_avg = np.mean(all_avg)
        improvement = rr_overall_avg - be_overall_avg

        lines.append(f"| 平均 avg_score | {be_overall_avg:.4f} | {rr_overall_avg:.4f} | "
                     f"{'+' if improvement >= 0 else ''}{improvement:.4f} |")

        lines.append(f"| 排名提升 chunks | - | - | "
                     f"{global_rank_changes.get('improved', 0)} ({100 * global_rank_changes.get('improved', 0) / n_total_chunks:.1f}%) |")

    # 写入文件
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print(f"  ✓ 评估报告已保存：{out_path}")
    return out_path


# ==============================================================================
# 主入口
# ==============================================================================

def print_header():
    """打印脚本启动横幅。"""
    print("═" * 50)
    print("  ESG 报告初稿生成 — 双路语义检索（步骤 1-4）")
    print("═" * 50)
    print()


def main():
    parser = argparse.ArgumentParser(
        description="ESG 报告初稿生成 — 双路语义检索 + Reranking"
    )
    parser.add_argument(
        "--rerank", action="store_true",
        help="启用 Reranker 精排（步骤 4），需 reranker_server.py 运行在 8083 端口"
    )
    parser.add_argument(
        "--biencoder-n", type=int, default=DRAFT_BIENCODER_TOP_N,
        help=f"bi-encoder 粗排候选数（默认 {DRAFT_BIENCODER_TOP_N}，启用 --rerank 时有效）"
    )
    parser.add_argument(
        "--top-k", type=int, default=DRAFT_RERANKER_TOP_K,
        help=f"最终保留的 chunk 数（默认 {DRAFT_RERANKER_TOP_K}）"
    )
    args = parser.parse_args()

    print_header()
    t0 = time.time()

    # 确定粗排/精排数量
    if args.rerank:
        biencoder_n = args.biencoder_n   # 粗排拉取更多候选送 reranker
        final_k     = args.top_k         # 精排后最终数量
        print(f"  模式：双路 bi-encoder 粗排 top-{biencoder_n} → reranker 精排 top-{final_k}")
    else:
        biencoder_n = args.top_k         # 无 reranker：粗排直接给最终数量
        final_k     = args.top_k
        print(f"  模式：双路 bi-encoder，top-{final_k}（跳过 reranker）")
    print()

    # ── 步骤 1：加载框架查询 + 双路 Embedding ──
    queries = load_framework_queries()
    rq_embs, hyde_embs = embed_queries_dual(queries)

    # ── 步骤 2：加载候选池 + 双路相似度计算 ──
    candidate_chunks, candidate_embs = load_candidate_pool()
    scores_rq, scores_hyde, scores_fused = compute_dual_similarity(
        rq_embs, hyde_embs, candidate_embs
    )

    # ── 步骤 3：bi-encoder Top-N 粗排（基于融合分数）──
    results = select_topk(
        scores_rq, scores_hyde, scores_fused,
        candidate_chunks, queries, k=biencoder_n
    )

    # ── 步骤 4：Reranker 精排（可选）──
    if args.rerank:
        results = rerank_results(results, final_k=final_k)

    # ── 保存输出 ──
    print(f"\n{'─' * 50}")
    print("输出阶段")
    save_retrieval_results(results, OUTPUT_DIR)
    write_evaluation_sample(results, OUTPUT_DIR)

    elapsed = time.time() - t0
    print(f"\n{'═' * 50}")
    print(f"  完成！总耗时 {elapsed:.1f} 秒")
    print(f"{'═' * 50}")


if __name__ == "__main__":
    main()
