"""
embedding_utils.py
==================
DashScope Text Embedding 通用工具模块。

提供：
  - compute_embeddings()：批量并发调用 DashScope TextEmbedding API
  - embed_chunks()：为 chunk_records 批量计算 embedding

此模块从 align_evidence.py 提取，供多个流水线脚本共用，
避免 generate_report_draft.py 直接依赖 align_evidence 的内部实现。
"""

import time
from tqdm import tqdm


def compute_embeddings(
    texts: list,
    api_key: str = None,
    base_url: str = None,
    model: str = None,
    batch_size: int = None,
    label: str = "",
    max_concurrent: int = None,
) -> list:
    """
    批量并发调用 DashScope TextEmbedding API，返回与输入等长的向量列表。

    自动检测 Instruct 前缀：
      - 文本含 "Instruct: ...\\nQuery: ..." → text_type="query" + instruct 参数
      - 无此前缀 → text_type="document"
    （一个批次内所有文本的 text_type 须一致，由首条文本决定。）

    参数：
        texts      - 待 embedding 的文本列表
        api_key    - （兼容保留，不再使用）由 config.DASHSCOPE_API_KEY 提供
        base_url   - （兼容保留，不再使用）已改为直接 SDK 调用
        model      - （兼容保留，不再使用）由 config.EMBEDDING_MODEL 提供
        batch_size - 每批最多条数，默认从 config.EMBEDDING_BATCH_SIZE 读取
        label      - 进度打印前缀（如 "指标" 或 "chunk"）
        max_concurrent - 最大并发请求数，默认从 config.EMBEDDING_CONCURRENCY 读取

    返回：
        List[List[float]]，长度与 texts 相同。
        单批失败时对应位置填充零向量（填 []），打印警告。

    重试策略：每批最多重试 3 次，等待 1s / 2s / 4s（指数退避）。
    空列表输入时直接返回空列表，不发起任何 API 调用。
    """
    if not texts:
        return []

    import re
    import dashscope
    from http import HTTPStatus
    from config import DASHSCOPE_API_KEY, EMBEDDING_MODEL, EMBEDDING_DIM
    from concurrent.futures import ThreadPoolExecutor, as_completed

    if batch_size is None:
        from config import EMBEDDING_BATCH_SIZE
        batch_size = EMBEDDING_BATCH_SIZE
    if max_concurrent is None:
        from config import EMBEDDING_CONCURRENCY
        max_concurrent = EMBEDDING_CONCURRENCY

    dashscope.api_key = DASHSCOPE_API_KEY

    # ── Instruct 前缀检测（由首条文本决定整批的 text_type）──
    INSTRUCT_PATTERN = re.compile(r'^Instruct:\s*(.+?)\nQuery:\s*(.+)', re.DOTALL)

    def parse_instruct(text: str):
        m = INSTRUCT_PATTERN.match(text)
        if m:
            return m.group(1).strip(), m.group(2).strip()
        return None, text

    instruct_str, _ = parse_instruct(texts[0])
    if instruct_str:
        text_type = "query"
        clean_texts = [parse_instruct(t)[1] for t in texts]
    else:
        text_type = "document"
        clean_texts = texts

    results = [None] * len(texts)
    total   = len(texts)
    n_batch = (total + batch_size - 1) // batch_size

    def _process_batch(batch_idx):
        start = batch_idx * batch_size
        end   = min(start + batch_size, total)
        batch = clean_texts[start:end]

        for attempt in range(3):
            try:
                kwargs = {
                    "model": EMBEDDING_MODEL,
                    "input": batch,
                    "dimension": EMBEDDING_DIM,
                    "text_type": text_type,
                    "output_type": "dense",
                }
                if instruct_str and text_type == "query":
                    kwargs["instruct"] = instruct_str

                resp = dashscope.TextEmbedding.call(**kwargs)

                if resp.status_code != HTTPStatus.OK:
                    raise RuntimeError(f"DashScope API 错误: {getattr(resp, 'message', str(resp))}")

                return batch_idx, [item["embedding"] for item in resp.output["embeddings"]]
            except Exception as e:
                wait = 2 ** attempt
                tqdm.write(f"  [警告] 批次 {batch_idx + 1} 第 {attempt + 1} 次失败：{e}，"
                           f"{'重试' if attempt < 2 else '放弃'}（等待 {wait}s）")
                time.sleep(wait)

        return batch_idx, [[] for _ in batch]

    desc = f"  embedding{' ' + label if label else ''}"

    if max_concurrent <= 1:
        pbar = tqdm(range(n_batch), desc=desc, unit="批",
                    ncols=80, dynamic_ncols=False)
        for b in pbar:
            start = b * batch_size
            end   = min(start + batch_size, total)
            pbar.set_postfix_str(f"{end}/{total} 条", refresh=False)
            _, embs = _process_batch(b)
            for j, emb in enumerate(embs):
                results[start + j] = emb
        pbar.close()
    else:
        pbar = tqdm(total=n_batch, desc=desc, unit="批",
                    ncols=80, dynamic_ncols=False)
        with ThreadPoolExecutor(max_workers=max_concurrent) as executor:
            futures = {
                executor.submit(_process_batch, b): b
                for b in range(n_batch)
            }
            for future in as_completed(futures):
                batch_idx, embs = future.result()
                start = batch_idx * batch_size
                for j, emb in enumerate(embs):
                    results[start + j] = emb
                end = min(start + batch_size, total)
                pbar.set_postfix_str(f"{end}/{total} 条", refresh=False)
                pbar.update(1)
        pbar.close()

    return results


def embed_chunks(
    chunk_records: list,
    api_key: str = None,
    base_url: str = None,
    model: str = None,
) -> list:
    """
    为每个 chunk_record 追加 "embedding" 字段，返回增强后的新列表。
    原始 chunk_records 不被修改。

    向量化使用 extractors.get_text_for_embedding() 选择字段：
    - 表格 chunk 且有 table_summary：使用纯摘要（语义密度高）
    - 其他情况：使用 text 字段

    char_count == 0 的 chunk（空文本）embedding 设为 None，跳过 API 调用。
    """
    from extractors import get_text_for_embedding

    valid_indices = [i for i, c in enumerate(chunk_records) if c.get("char_count", 0) > 0]
    valid_texts   = [get_text_for_embedding(chunk_records[i]) for i in valid_indices]

    if valid_texts:
        embeddings = compute_embeddings(valid_texts, label="chunk")
    else:
        embeddings = []

    emb_map = {valid_indices[j]: embeddings[j] for j in range(len(valid_indices))}

    result = []
    for i, chunk in enumerate(chunk_records):
        new_chunk = dict(chunk)
        new_chunk["embedding"] = emb_map.get(i, None)
        result.append(new_chunk)

    return result
