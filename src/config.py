"""
config.py
=========
全局配置中心。

分为三层：
  1. 分块参数      — CHUNK_* ：全局默认值 + 各文件类型覆盖值
  2. 算法阈值      — PDF 分类、DOCX 标题识别、LibreOffice 超时等
  3. 服务配置      — GLM-OCR、Embedding API（地址/模型名从环境变量读取）
  4. 检索/对齐参数 — EMBEDDING_TOP_K、CONSISTENCY_TOPN

修改原则：
  - 只改本文件，extractors.py / align_evidence.py 自动生效
  - 各文件类型覆盖值设为 None 表示"继承全局"，无需每次都全部填写
  - 敏感值（API Key）通过环境变量传入，本文件只读取，不硬编码
"""

import os
from pathlib import Path

# 项目根目录（config.py 在 src/ 下，向上一级即为根）
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)

# ==============================================================================
# 1. 分块参数
# ==============================================================================

# ── 全局默认值 ─────────────────────────────────────────────────────────────────
CHUNK_MAX_SIZE = 1200   # 单个 chunk 字符数上限
CHUNK_MIN_SIZE = 100   # 触发孤立片段合并的阈值

# ── 各文件类型覆盖值（None = 继承全局） ──────────────────────────────────────
# 目前所有类型行为一致，统一继承全局值。
# 若将来需要单独调整某类型，直接修改对应值，其他类型不受影响。
# 示例：若 OCR 扫描件建议更大块，设 CHUNK_MAX_SIZE_PDF_OCR = 1200
CHUNK_MAX_SIZE_PDF   = None   # PDF（含扫描件 OCR 和普通文字）
CHUNK_MIN_SIZE_PDF   = None
CHUNK_MAX_SIZE_DOCX  = None   # DOCX / DOC
CHUNK_MIN_SIZE_DOCX  = None
CHUNK_MAX_SIZE_XLSX  = None   # XLSX / XLS
CHUNK_MIN_SIZE_XLSX  = None
CHUNK_MAX_SIZE_PPTX  = None   # PPTX / PPT
CHUNK_MIN_SIZE_PPTX  = None
CHUNK_MAX_SIZE_IMAGE = None   # JPG / JPEG / PNG
CHUNK_MIN_SIZE_IMAGE = None


def chunk_params(file_type: str) -> tuple[int, int]:
    """
    按文件类型返回 (max_size, min_size)。
    file_type 取值：'pdf' | 'docx' | 'xlsx' | 'pptx' | 'image'
    覆盖值为 None 时自动 fallback 到全局默认。
    """
    _override = {
        "pdf":   (CHUNK_MAX_SIZE_PDF,   CHUNK_MIN_SIZE_PDF),
        "docx":  (CHUNK_MAX_SIZE_DOCX,  CHUNK_MIN_SIZE_DOCX),
        "xlsx":  (CHUNK_MAX_SIZE_XLSX,  CHUNK_MIN_SIZE_XLSX),
        "pptx":  (CHUNK_MAX_SIZE_PPTX,  CHUNK_MIN_SIZE_PPTX),
        "image": (CHUNK_MAX_SIZE_IMAGE, CHUNK_MIN_SIZE_IMAGE),
    }
    mx, mn = _override.get(file_type, (None, None))
    return (mx or CHUNK_MAX_SIZE, mn or CHUNK_MIN_SIZE)


# ==============================================================================
# 2. 算法阈值
# ==============================================================================

# ── PDF 分类（classify_pdf） ──────────────────────────────────────────────────
PDF_SAMPLE_PAGES          = 5      # 判断 PDF 类型时采样的页数
PDF_PPT_ASPECT_RATIO      = 1.2    # 宽高比超过此值 → 疑似 PPT 转 PDF
PDF_PPT_AVG_BLOCK_CHARS   = 80     # 页均文字块字符数 < 此值时辅助判定为 PPT 转 PDF
PDF_PPT_AVG_IMAGES        = 1      # 页均图片数 ≥ 此值时辅助判定为 PPT 转 PDF
PDF_SCANNED_CHARS_PER_PAGE = 30    # 页均有效字符 < 此值 → 视为扫描件
PDF_OCR_DPI               = 150    # 扫描件 / PPT 转 PDF 栅格化分辨率（DPI）
PDF_TITLE_SIZE_PERCENTILE = 0.75   # 字号超过全文该百分位 → 视为章节标题
PDF_TITLE_MAX_CHARS       = 200    # 文本超过此字符数 → 不视为标题
PDF_TITLE_RATIO_MAX       = 0.50   # 标题 block 占总 block 比例上限；超过则触发逐级上探
PDF_TITLE_MIN_COUNT       = 2      # 标题 block 最少数量；少于此值时放弃按标题切割

# ── DOCX 标题识别（_is_heading_para） ─────────────────────────────────────────
DOCX_HEADING_MAX_CHARS = 30        # 段落文本超过此字符数 → 不视为标题

# ── LibreOffice 转换超时 ───────────────────────────────────────────────────────
SOFFICE_DOC_TIMEOUT = 60           # .doc → .docx 转换超时（秒）
SOFFICE_PPT_TIMEOUT = 120          # .ppt → .pptx 转换超时（秒）


# ==============================================================================
# 2.5  SDK PDF 提取参数（v2 路径：glmocr SDK 流水线）
# ==============================================================================

# ── PDF 分流阈值（逐页检测）──────────────────────────────────────────────────
# 任何一页有效字符 < PDF_PAGE_MIN_CHARS → 整文档走 SDK 路径
PDF_PAGE_MIN_CHARS = int(os.environ.get("PDF_PAGE_MIN_CHARS", "30"))

# ── 标题层级重建方式 ─────────────────────────────────────────────────────────
# "rule" = 用编号模式正则推断层级（默认、快速、无额外依赖）
# "llm"  = 用 LLM 推断层级（更准确，需 LLM API 可用）
TITLE_REBUILD_MODE = os.environ.get("TITLE_REBUILD_MODE", "llm")

# ── SDK 配置文件路径 ─────────────────────────────────────────────────────────
SDK_CONFIG_PATH = os.environ.get("SDK_CONFIG_PATH",
    str(Path(_HERE) / "sdk_config.yaml"))

# ── SDK 实例复用 ─────────────────────────────────────────────────────────────
# True = 单例模式，多文件复用同一 GlmOcr 实例（避免重复加载版面检测模型）
# False = 每文件新建实例（仅调试用）
SDK_REUSE_INSTANCE = True

# ── PP-DocLayout-V3 版面检测 GPU ─────────────────────────────────────────────
# "0" = GPU0（与 vLLM GLM-OCR 共享，版面检测模型较轻量）
# "" = CPU 模式
SDK_LAYOUT_DEVICE = os.environ.get("SDK_LAYOUT_DEVICE", "0")

# ── SDK PDF 渲染 DPI ─────────────────────────────────────────────────────────
# PDF 页面栅格化为图像的 DPI。影响版面检测精度和 OCR 质量。
# 200 = 默认值（精度与速度的平衡点）
# 300 = 更高精度（细小文字/密集表格），但解析时间约增加 50%-100%
# 150 = 更快速度，适合文字清晰的文档
# 此值同时用于 sdk_config.yaml 的 pdf_dpi 和 bbox 坐标转换
SDK_PDF_DPI = int(os.environ.get("SDK_PDF_DPI", "200"))

# ═══════════════════════════════════════════════════════════════════════════════
# 2.6  表格处理优化参数（Phase 1：结构分离 + 格式转换）
# ═══════════════════════════════════════════════════════════════════════════════

# 表格分块最大行数（不含表头）
# 超过此行数的表格将被拆分，每块补充表头
TABLE_MAX_ROWS = 30

# 短正文合并阈值（字符数）
# 小于此值的正文片段优先合并到相邻同类型 chunk
SHORT_TEXT_THRESHOLD = 100


# ═══════════════════════════════════════════════════════════════════════════════
# 2.7  表格摘要生成参数（Phase 2：语义增强）
# ═══════════════════════════════════════════════════════════════════════════════

# 是否启用 LLM 表格摘要生成（关闭后 Embedding 使用原 text 字段）
ENABLE_TABLE_SUMMARY = True

# 表格前后上下文字数（从 parent_text 中提取，帮助 LLM 理解表格语义）
TABLE_CONTEXT_CHARS = 300

# 表格摘要缓存路径（按内容 SHA256 去重，避免重复调用 LLM）
TABLE_SUMMARY_CACHE_PATH = os.path.join(_ROOT, "data/processed/table_summary_cache.json")

# Reranker/LLM 上下文长度阈值（parent_text 超过此值时截取前后窗口）
MAX_PARENT_LEN = 2000

# 超过阈值时的上下文窗口大小（chunk 前后各取此字数）
CONTEXT_CHARS = 300

# 表格摘要生成并发数（与 DRAFT_CONCURRENCY 独立，可单独调整）
TABLE_SUMMARY_CONCURRENCY = 20


# ==============================================================================
# 3. 服务配置（地址/模型从环境变量读取，本文件提供默认值）
# ==============================================================================

# ── GLM-OCR（本地 vLLM） ──────────────────────────────────────────────────────
GLM_OCR_BASE_URL = os.environ.get("GLM_OCR_BASE_URL", "http://localhost:8080/v1")
GLM_OCR_MODEL    = os.environ.get("GLM_OCR_MODEL",    "glm-ocr")

# ── Embedding API（本地 Qwen3-Embedding-8B，由 src/embedding_server.py 提供）──
# 服务启动命令：CUDA_VISIBLE_DEVICES=1 conda run -n bge python3 src/embedding_server.py
OPENAI_API_KEY  = os.environ.get("OPENAI_API_KEY",  "local")
OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL", "http://localhost:8081/v1")
EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "Qwen3-Embedding-8B")

# 指标 query embedding 的 instruct 前缀（仅 query 侧使用，document/chunk 侧不加）
# 参考 Qwen3-Embedding 文档：query 侧加 instruct 可提升检索性能 1%-5%
# 格式：f"Instruct: {EMBEDDING_INSTRUCT}\nQuery: {query_text}"
EMBEDDING_INSTRUCT = (
    "Given an ESG (Environmental, Social, Governance) indicator description, "
    "retrieve relevant document sections that provide evidence or data for this indicator"
)

# ── Reranker（本地 Qwen3-Reranker-8B，由 src/reranker_server.py 提供）────────
# 服务启动命令：CUDA_VISIBLE_DEVICES=3 conda run -n ocr python3 src/reranker_server.py
RERANKER_BASE_URL = os.environ.get("RERANKER_BASE_URL", "http://localhost:8083")
RERANKER_MODEL    = os.environ.get("RERANKER_MODEL",    "Qwen3-Reranker-8B")

# Reranker task instruction（英文，与 Qwen3-Reranker-8B 训练语言对齐）
RERANKER_INSTRUCT = (
    "Given a section title and description from an ESG report, "
    "retrieve relevant document passages that provide evidence, data, "
    "or content useful for writing that section"
)

# ── VLM 图片分类与描述（本地 vLLM Qwen3-VL，由 src/vlm_server.py 提供） ────
# 服务启动命令：CUDA_VISIBLE_DEVICES=2 conda run -n ocr python3 src/vlm_server.py
VLM_BASE_URL     = os.environ.get("VLM_BASE_URL", "http://localhost:8082/v1")
VLM_MODEL        = os.environ.get("VLM_MODEL",    "qwen3-vl")

# ── VLM 图片过滤与处理 ──────────────────────────────────────────────────────
IMAGE_MIN_WIDTH  = 100    # 宽 < 此值跳过（排除图标/装饰元素）
IMAGE_MIN_HEIGHT = 100    # 高 < 此值跳过
IMAGE_MIN_BYTES  = 5120   # 字节 < 5KB 跳过
VLM_MAX_IMAGE_PX = 1024   # 长边超此值等比缩放（防 8192 token 上下文溢出）


# ==============================================================================
# 4. 语义检索 / 对齐参数
# ==============================================================================

EMBEDDING_TOP_K  = 5   # 每个 chunk 检索返回的候选指标数
CONSISTENCY_TOPN = 5   # 路径编码在语义 Top-N 内 → 标记为 ✅（需 ≤ EMBEDDING_TOP_K）
EXTRA_RELEVANCE_THRESHOLD = 0.75  # ➕ 额外关联的相似度阈值（score > 此值且非 folder_code → 额外关联）
MIN_RELEVANCE_SCORE = 0.40  # top1 相似度 < 此值 → 标记为 ➖ 低相关（不需审核）

# ── 报告初稿生成检索参数（generate_report_draft.py）─────────────────────────
DRAFT_BIENCODER_TOP_N  = 50   # bi-encoder 粗排阶段每节点召回的候选数（送入 reranker）
DRAFT_RERANKER_TOP_K   = 10   # reranker 精排后最终保留的 chunk 数（LLM 上下文）

# 是否默认启用 Reranker 精排（True = 默认做 rerank，命令行可用 --no-rerank 关闭）
ENABLE_RERANK = True

# ChromaDB 向量库持久化目录（相对项目根目录）
CHROMA_PERSIST_DIR = os.path.join(_ROOT, ".chroma_db")


# ==============================================================================
# 5. 运行控制
# ==============================================================================

# LLM 增强版指标查询文本（方案B：独立 JSON，不修改原始清单）
# 格式：{code: "LLM 生成的 embedding 友好型文本描述"}
# 若文件存在，build_indicator_queries() 优先使用增强文本；否则回退到原始公式。
ENHANCED_QUERY_PATH = os.path.join(_ROOT, "data/processed/indicator_query_enhanced.json")

# 阶段 2a 文本提取结果缓存（section 级别，提取完成后写入）
# 修改分块逻辑后只需删除 chunks_cache.json，无需重新提取。
SECTION_CACHE_PATH = os.path.join(_ROOT, "data/processed/sections_cache.json")

# 阶段 2b 分块结果缓存文件路径（存放于 processed/ 目录）
# 每次成功完成阶段 2b 后自动写入；下次运行时若文件存在则直接加载，跳过重新分块。
CHUNK_CACHE_PATH = os.path.join(_ROOT, "data/processed/chunks_cache.json")

# 阶段三 chunk embedding 缓存文件路径（numpy .npz 压缩格式）
# 42418 × 4096 float 的 embedding 矩阵，.npz 压缩后 ~300-400 MB，加载仅需几秒。
EMB_CACHE_PATH = os.path.join(_ROOT, "data/processed/chunks_emb_cache.npz")

# VLM 图片分类结果缓存（按图片 SHA256 去重，避免重复调用 VLM）
VLM_CACHE_PATH = os.path.join(_ROOT, "data/processed/vlm_cache.json")

# SDK 提取的图片缓存目录（裁切的 image/chart 区域保存为 PNG，供后续 VLM 描述溯源）
SDK_IMAGE_CACHE_DIR = os.path.join(_ROOT, "data/processed/sdk_images")

# 设为 True 时强制重新提取所有文件，忽略已有缓存（sections + chunks + embedding 均失效）。
# 适用场景：资料文件夹有新增/修改。
FORCE_REEXTRACT = False

# 设为 True 时强制重新分块（跳过 chunks_cache.json），但复用 sections_cache.json。
# 适用场景：修改了 merge_short_sections / recursive_split 等分块参数后。
# Phase 1 表格优化后需设为 True 一次，让 HTML → Markdown 转换生效。
FORCE_RECHUNK = False


# ==============================================================================
# 6. 初稿生成配置（generate_draft.py）
# ==============================================================================

# ── LLM API 配置 ──────────────────────────────────────────────────────────────
# 注意：OpenAI SDK 要求 base_url 包含 /v1 后缀
DRAFT_LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "http://127.0.0.1:8000/v1")
DRAFT_LLM_API_KEY  = os.environ.get("LLM_API_KEY",  "sk-leoi-888")
DRAFT_LLM_MODEL    = os.environ.get("LLM_MODEL",    "deepseek-thinking")

# ── 并发与重试 ────────────────────────────────────────────────────────────────
DRAFT_CONCURRENCY  = int(os.environ.get("DRAFT_CONCURRENCY", "6"))
DRAFT_LLM_TIMEOUT  = float(os.environ.get("DRAFT_LLM_TIMEOUT", "120.0"))
DRAFT_MAX_RETRIES  = int(os.environ.get("DRAFT_MAX_RETRIES", "3"))
DRAFT_TEMPERATURE  = float(os.environ.get("DRAFT_TEMPERATURE", "0.3"))
DRAFT_MAX_TOKENS   = int(os.environ.get("DRAFT_MAX_TOKENS", "2000"))

# ── 质量过滤与文本处理 ────────────────────────────────────────────────────────
DRAFT_SCORE_THRESHOLD = float(os.environ.get("DRAFT_SCORE_THRESHOLD", "0.25"))
DRAFT_TEXT_LIMIT      = int(os.environ.get("DRAFT_TEXT_LIMIT", "2000"))

# ── 输出路径 ──────────────────────────────────────────────────────────────────
DRAFT_OUTPUT_DIR = os.path.join(_ROOT, "data/processed/report_draft")


# ==============================================================================
# 7. BM25 混合检索配置（Phase 3）
# ==============================================================================

# 是否启用 BM25 第三路（False 可退回纯 Embedding 双路模式）
ENABLE_BM25 = True

# BM25 每查询返回的候选数（送入 RRF 融合）
BM25_TOP_N = 100

# RRF 平滑参数（值越大，排名差异影响越小；60 是经验值）
RRF_K = 60
