"""
vlm_server.py
=============
基于 Qwen3-VL-8B-Instruct-FP8 的 VLM 图片描述服务（vLLM 部署）。

对外暴露 OpenAI 兼容的 /v1/chat/completions 接口，
extractors.py 中的 call_vlm_describe() 可直接通过 openai SDK 调用。

运行方式（在项目根目录执行）：
    CUDA_VISIBLE_DEVICES=2 \\
    LD_LIBRARY_PATH=/opt/conda/envs/ocr/lib:$LD_LIBRARY_PATH \\
    conda run -n ocr python3 src/vlm_server.py

服务就绪标志（日志出现）：
    INFO:     Application startup complete.
    INFO:     Uvicorn running on http://0.0.0.0:8082

验证服务：
    curl -s http://localhost:8082/v1/models | python3 -m json.tool
    curl -s http://localhost:8082/health

依赖环境：ocr conda 环境（vllm>=0.8, transformers>=4.51.0）
GPU：GPU2（CUDA_VISIBLE_DEVICES=2），显存约 12~16 GB（FP8 量化）
端口：8082（避开 GLM-OCR 的 8080 和 Embedding 的 8081）

注意：conda run 不会自动把环境的 lib/ 目录加入动态链接路径，
系统 libstdc++（CXXABI_1.3.13）低于 ocr 环境 ICU 库所需的 CXXABI_1.3.15，
需前置 LD_LIBRARY_PATH=/opt/conda/envs/ocr/lib 让链接器优先使用新版 libstdc++。
"""

import sys
import os

# ==============================================================================
# 修复 LD_LIBRARY_PATH（ocr conda 环境 libstdc++ 兼容问题）
# ==============================================================================
_OCR_LIB = "/opt/conda/envs/ocr/lib"
_ld_path = os.environ.get("LD_LIBRARY_PATH", "")
if _OCR_LIB not in _ld_path:
    os.environ["LD_LIBRARY_PATH"] = f"{_OCR_LIB}:{_ld_path}" if _ld_path else _OCR_LIB

# ==============================================================================
# 配置
# ==============================================================================

MODEL_PATH = "/workspace/data/llm_models/models/Qwen/Qwen3-VL-8B-Instruct-FP8"
MODEL_NAME = "qwen3-vl"          # 对外暴露的模型名（客户端传入此名称）
HOST       = "0.0.0.0"
PORT       = 8082
MAX_MODEL_LEN = 8192             # 图片描述任务无需超长上下文，节省显存

# ==============================================================================
# 启动 vLLM 服务
# ==============================================================================

def main():
    cmd = [
        sys.executable, "-m", "vllm.entrypoints.openai.api_server",
        "--model",                  MODEL_PATH,
        "--served-model-name",      MODEL_NAME,
        "--host",                   HOST,
        "--port",                   str(PORT),
        "--max-model-len",          str(MAX_MODEL_LEN),
        "--tensor-parallel-size",   "1",
        "--gpu-memory-utilization", "0.80",
        "--trust-remote-code",
        "--limit-mm-per-prompt",    '{"image": 4}',  # 单次最多 4 张图
        "--async-scheduling",                        # 重叠调度提升吞吐
        "--dtype",                  "auto",          # FP8 权重自动识别
    ]

    print("=" * 60)
    print("  VLM 图片描述服务 — Qwen3-VL-8B-Instruct-FP8")
    print("=" * 60)
    print(f"  模型路径    : {MODEL_PATH}")
    print(f"  对外模型名  : {MODEL_NAME}")
    print(f"  监听地址    : http://{HOST}:{PORT}")
    print(f"  最大上下文  : {MAX_MODEL_LEN} tokens")
    print(f"  GPU 利用率  : 80%")
    print("=" * 60)
    print()
    print("启动命令：")
    print("  " + " \\\n    ".join(cmd))
    print()

    os.execvp(cmd[0], cmd)


if __name__ == "__main__":
    main()
