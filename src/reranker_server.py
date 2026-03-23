"""
reranker_server.py
==================
基于 Qwen3-Reranker-8B 的 HTTP Reranking 服务。

对外暴露 /rerank 接口，接收一个 query 和若干 documents，
返回每条 document 对应的相关性分数（0-1 概率值）。

打分原理（来自 Qwen3-Reranker 文档）：
  - 输入格式：<Instruct>: {task}\n<Query>: {query}\n<Document>: {doc}
  - 用 system prompt 包裹，要求模型输出 "yes" 或 "no"
  - 取最后一个 token 的 logits，softmax([p_no, p_yes]) 中 p_yes 作为分数
  - 支持自定义 task instruction（推荐英文，提升 1%-5% 性能）

运行方式（在项目根目录执行）：
    CUDA_VISIBLE_DEVICES=3 conda run -n ocr python3 src/reranker_server.py

服务就绪后控制台输出：
    INFO:     Uvicorn running on http://0.0.0.0:8083 (Press CTRL+C to quit)
    ✓ 模型加载完成：Qwen3-Reranker-8B

验证服务：
    curl -s http://localhost:8083/health
    curl -s http://localhost:8083/v1/models

依赖环境：ocr conda 环境（transformers>=4.51.0, flash-attn 可选）
GPU：GPU3（CUDA_VISIBLE_DEVICES=3），显存约 20-22 GB（float16）
端口：8083
"""

import os
import time
import logging
from typing import List, Optional

import torch
import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from transformers import AutoTokenizer, AutoModelForCausalLM

# ==============================================================================
# 配置
# ==============================================================================

MODEL_PATH  = "/workspace/data/llm_models/models/Qwen/Qwen3-Reranker-8B"
MODEL_NAME  = "Qwen3-Reranker-8B"
HOST        = "0.0.0.0"
PORT        = 8083
BATCH_SIZE  = 8       # Reranker 比 embedding 重，batch 小一些
MAX_LENGTH  = 8192    # 文档 Qwen3-Reranker 支持最长 32k，推理时用 8192 够用

# ESG 报告检索场景专用 task instruction（英文，效果更好）
DEFAULT_TASK = (
    "Given a section title and description from an ESG report, "
    "retrieve relevant document passages that provide evidence, data, "
    "or content useful for writing that section"
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s:     %(message)s")
logger = logging.getLogger(__name__)

# ==============================================================================
# 模型加载（启动时执行一次）
# ==============================================================================

logger.info(f"加载模型：{MODEL_PATH}")

_tokenizer = AutoTokenizer.from_pretrained(MODEL_PATH, padding_side="left")

# 尝试使用 flash_attention_2，失败则降级到 sdpa
try:
    _model = AutoModelForCausalLM.from_pretrained(
        MODEL_PATH,
        torch_dtype=torch.float16,
        attn_implementation="flash_attention_2",
        device_map="auto",
    ).eval()
    logger.info("使用 flash_attention_2 加速")
except ImportError:
    logger.warning("flash_attn 未安装，降级到 sdpa attention")
    _model = AutoModelForCausalLM.from_pretrained(
        MODEL_PATH,
        torch_dtype=torch.float16,
        attn_implementation="sdpa",
        device_map="auto",
    ).eval()

# 预先解析 yes/no 对应的 token id（打分核心）
_token_true_id  = _tokenizer.convert_tokens_to_ids("yes")
_token_false_id = _tokenizer.convert_tokens_to_ids("no")

# 构建固定的 prefix/suffix（system + user turn 框架）
_PREFIX = (
    "<|im_start|>system\n"
    "Judge whether the Document meets the requirements based on the Query and the "
    "Instruct provided. Note that the answer can only be \"yes\" or \"no\"."
    "<|im_end|>\n"
    "<|im_start|>user\n"
)
_SUFFIX = "<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n"

_prefix_tokens = _tokenizer.encode(_PREFIX, add_special_tokens=False)
_suffix_tokens = _tokenizer.encode(_SUFFIX, add_special_tokens=False)

logger.info(f"✓ 模型加载完成：{MODEL_NAME}")
logger.info(f"  token_true_id={_token_true_id} ('yes'), token_false_id={_token_false_id} ('no')")

# ==============================================================================
# 打分核心函数
# ==============================================================================

def _format_input(task: str, query: str, doc: str) -> str:
    """构造 <Instruct>/<Query>/<Document> 格式的输入字符串。"""
    return f"<Instruct>: {task}\n<Query>: {query}\n<Document>: {doc}"


def _tokenize_batch(texts: List[str]) -> dict:
    """
    对一批输入文本做 tokenize，并手动拼接 prefix/suffix token。
    截断策略：'longest_first'（优先截断最长序列）。
    """
    # 先 tokenize 正文（不加 special tokens）
    inputs = _tokenizer(
        texts,
        padding=False,
        truncation="longest_first",
        return_attention_mask=False,
        max_length=MAX_LENGTH - len(_prefix_tokens) - len(_suffix_tokens),
    )
    # 手动拼接 prefix + tokens + suffix
    for i, ids in enumerate(inputs["input_ids"]):
        inputs["input_ids"][i] = _prefix_tokens + ids + _suffix_tokens

    # pad 并转 tensor
    inputs = _tokenizer.pad(
        inputs,
        padding=True,
        return_tensors="pt",
        max_length=MAX_LENGTH,
    )
    return {k: v.to(_model.device) for k, v in inputs.items()}


@torch.no_grad()
def _score_batch(texts: List[str]) -> List[float]:
    """
    对一批 (query, doc) 格式化后的字符串打分，返回相关性概率列表（0-1）。

    原理：取最后一个 token 位置的 logits，
    softmax([logit_false, logit_true]) 中 true（"yes"）的概率即为相关性分数。
    """
    inputs = _tokenize_batch(texts)
    logits = _model(**inputs).logits[:, -1, :]          # (batch, vocab)
    true_scores  = logits[:, _token_true_id]
    false_scores = logits[:, _token_false_id]
    stacked = torch.stack([false_scores, true_scores], dim=1)  # (batch, 2)
    probs = torch.nn.functional.log_softmax(stacked, dim=1).exp()
    return probs[:, 1].tolist()                          # p_yes


def rerank(
    query: str,
    documents: List[str],
    task: str = DEFAULT_TASK,
) -> List[float]:
    """
    对 query + documents 列表批量打分，返回与 documents 等长的分数列表。

    分批推理（BATCH_SIZE），防止显存溢出。
    """
    formatted = [_format_input(task, query, doc) for doc in documents]
    scores = []
    for i in range(0, len(formatted), BATCH_SIZE):
        batch = formatted[i : i + BATCH_SIZE]
        scores.extend(_score_batch(batch))
    return scores


# ==============================================================================
# FastAPI 应用
# ==============================================================================

app = FastAPI(title="Qwen3 Reranker Server", version="1.0.0")


# ── 请求 / 响应模型 ────────────────────────────────────────────────────────────

class RerankRequest(BaseModel):
    query:     str
    documents: List[str]
    task:      Optional[str] = None   # None → 使用 DEFAULT_TASK


class RerankResult(BaseModel):
    index: int
    score: float


class RerankResponse(BaseModel):
    model:   str
    results: List[RerankResult]       # 与 documents 输入顺序一一对应


# ── 路由 ──────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    """健康检查。"""
    return {"status": "ok", "model": MODEL_NAME}


@app.get("/v1/models")
def list_models():
    """OpenAI /v1/models 格式兼容，方便统一验证脚本。"""
    return {
        "object": "list",
        "data": [{
            "id":       MODEL_NAME,
            "object":   "model",
            "created":  int(time.time()),
            "owned_by": "local",
        }],
    }


@app.post("/rerank", response_model=RerankResponse)
def rerank_endpoint(req: RerankRequest):
    """
    批量 Reranking 接口。

    请求体：
        query      - 检索查询文本
        documents  - 待排序文档列表
        task       - （可选）任务描述，不传则使用默认 ESG 检索 instruction

    返回：
        results    - 与 documents 顺序相同的打分列表 [{index, score}, ...]
                     score 为 0-1 的相关性概率，越高越相关
    """
    if not req.documents:
        raise HTTPException(status_code=400, detail="documents 不能为空")

    task = req.task if req.task is not None else DEFAULT_TASK
    scores = rerank(req.query, req.documents, task=task)

    return RerankResponse(
        model=MODEL_NAME,
        results=[
            RerankResult(index=i, score=round(s, 6))
            for i, s in enumerate(scores)
        ],
    )


# ==============================================================================
# 入口
# ==============================================================================

if __name__ == "__main__":
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
