"""
embedding_server.py
===================
基于 Qwen3-Embedding-8B 的 OpenAI 兼容 Embedding HTTP 服务。

对外暴露 /v1/embeddings 接口，格式与 OpenAI API 完全兼容，
align_evidence.py 中的 compute_embeddings() 无需任何修改即可直接调用。

运行方式（在项目根目录执行）：
    CUDA_VISIBLE_DEVICES=1 conda run -n bge python3 src/embedding_server.py

服务就绪后控制台输出：
    INFO:     Uvicorn running on http://0.0.0.0:8081 (Press CTRL+C to quit)
    ✓ 模型加载完成：Qwen3-Embedding-8B（维度 4096）

验证服务：
    curl -s http://localhost:8081/v1/models | python3 -m json.tool
    curl -s http://localhost:8081/health

依赖环境：bge conda 环境（sentence-transformers>=2.7.0, transformers>=4.51.0）
GPU：GPU1（CUDA_VISIBLE_DEVICES=1），显存约 16~20 GB
端口：8081（避开 GLM-OCR 的 8080）
"""

import os
import time
import logging
from typing import List, Union

import torch
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

# ==============================================================================
# 配置
# ==============================================================================

MODEL_PATH  = "/workspace/data/llm_models/models/Qwen/Qwen3-Embedding-8B"
MODEL_NAME  = "Qwen3-Embedding-8B"   # 对外暴露的模型名（客户端传入此名称）
HOST        = "0.0.0.0"
PORT        = 8081
BATCH_SIZE  = 32                      # 单次推理批大小，避免显存溢出

logging.basicConfig(level=logging.INFO, format="%(levelname)s:     %(message)s")
logger = logging.getLogger(__name__)

# ==============================================================================
# 模型加载（服务启动时执行一次）
# ==============================================================================

logger.info(f"加载模型：{MODEL_PATH}")
_model = SentenceTransformer(
    MODEL_PATH,
    model_kwargs={
        "attn_implementation": "flash_attention_2",
        "device_map":          "auto",
        "torch_dtype":         torch.float16,
    },
    tokenizer_kwargs={"padding_side": "left"},
)
_embed_dim = _model.get_sentence_embedding_dimension()
logger.info(f"✓ 模型加载完成：{MODEL_NAME}（维度 {_embed_dim}）")

# ==============================================================================
# FastAPI 应用
# ==============================================================================

app = FastAPI(title="Qwen3 Embedding Server", version="1.0.0")


# ── 请求 / 响应模型（OpenAI 兼容格式）────────────────────────────────────────

class EmbeddingRequest(BaseModel):
    input: Union[str, List[str]]
    model: str = MODEL_NAME
    encoding_format: str = "float"   # 只支持 float，忽略 base64


class EmbeddingObject(BaseModel):
    object:    str = "embedding"
    index:     int
    embedding: List[float]


class UsageInfo(BaseModel):
    prompt_tokens:     int
    total_tokens:      int


class EmbeddingResponse(BaseModel):
    object: str = "list"
    data:   List[EmbeddingObject]
    model:  str
    usage:  UsageInfo


# ── 路由 ─────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    """健康检查，供 curl 快速验证服务就绪。"""
    return {"status": "ok", "model": MODEL_NAME, "dim": _embed_dim}


@app.get("/v1/models")
def list_models():
    """返回可用模型列表（OpenAI /v1/models 兼容格式）。"""
    return {
        "object": "list",
        "data": [{
            "id":       MODEL_NAME,
            "object":   "model",
            "created":  int(time.time()),
            "owned_by": "local",
        }],
    }


@app.post("/v1/embeddings", response_model=EmbeddingResponse)
def create_embeddings(req: EmbeddingRequest):
    """
    计算文本 embedding，返回 OpenAI 兼容格式。

    - input 可以是单个字符串或字符串列表
    - 超长批次自动分批推理（BATCH_SIZE=32），避免显存溢出
    - 返回 L2 归一化后的 float 列表（余弦相似度 = 点积）
    """
    # 统一为列表
    texts = [req.input] if isinstance(req.input, str) else list(req.input)
    if not texts:
        raise HTTPException(status_code=400, detail="input 不能为空")

    # 分批推理
    all_embeddings = []
    for i in range(0, len(texts), BATCH_SIZE):
        batch = texts[i : i + BATCH_SIZE]
        embs  = _model.encode(
            batch,
            normalize_embeddings=True,   # L2 归一化，余弦相似度 = 点积
            convert_to_numpy=True,
            show_progress_bar=False,
        )
        all_embeddings.extend(embs.tolist())

    # 估算 token 数（粗略：4 字符 ≈ 1 token）
    total_chars  = sum(len(t) for t in texts)
    approx_tokens = total_chars // 4

    return EmbeddingResponse(
        data  = [EmbeddingObject(index=i, embedding=emb)
                 for i, emb in enumerate(all_embeddings)],
        model = MODEL_NAME,
        usage = UsageInfo(
            prompt_tokens=approx_tokens,
            total_tokens=approx_tokens,
        ),
    )


# ==============================================================================
# 入口
# ==============================================================================

if __name__ == "__main__":
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
