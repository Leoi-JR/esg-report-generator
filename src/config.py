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

多企业支持：
  - 使用 get_paths(project_dir=None) 获取 ProjectPaths 实例
  - project_dir=None → 向后兼容模式（旧的 data/ 路径）
  - project_dir="projects/企业名" → 新企业隔离模式
"""

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()  # 加载仓库根 .env 文件到 os.environ

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
# 2.5  PDF 提取参数（v2 路径：智谱线上 layout_parsing API）
# ==============================================================================

# ── PDF 分流阈值（逐页检测）──────────────────────────────────────────────────
# 任何一页有效字符 < PDF_PAGE_MIN_CHARS → 整文档走线上 OCR 路径
PDF_PAGE_MIN_CHARS = int(os.environ.get("PDF_PAGE_MIN_CHARS", "30"))

# ── 标题层级重建方式 ─────────────────────────────────────────────────────────
# "rule" = 用编号模式正则推断层级（默认、快速、无额外依赖）
# "llm"  = 用 LLM 推断层级（更准确，需 LLM API 可用）
TITLE_REBUILD_MODE = os.environ.get("TITLE_REBUILD_MODE", "llm")

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

# Reranker/LLM 上下文长度阈值（parent_text 超过此值时截取前后窗口）
MAX_PARENT_LEN = 2000

# 超过阈值时的上下文窗口大小（chunk 前后各取此字数）
CONTEXT_CHARS = 300

# 表格摘要生成并发数（与 DRAFT_CONCURRENCY 独立，可单独调整）
TABLE_SUMMARY_CONCURRENCY = 20


# ==============================================================================
# 3. 服务配置（地址/模型从环境变量读取，本文件提供默认值）
# ==============================================================================

# ── GLM-OCR（智谱线上 layout_parsing API，直接调用，无 GPU 依赖） ─────────
ZHIPU_API_KEY      = os.environ.get("ZHIPU_API_KEY", "")
ZHIPU_API_BASE_URL = os.environ.get("ZHIPU_API_BASE_URL",
                                     "https://open.bigmodel.cn/api/paas/v4")
GLM_OCR_MODEL      = os.environ.get("GLM_OCR_MODEL", "glm-ocr")

# ── Embedding API（DashScope text-embedding-v4，compute_embeddings() 直接调用 SDK）──
DASHSCOPE_API_KEY = os.environ.get("DASHSCOPE_API_KEY", "")
OPENAI_API_KEY    = os.environ.get("OPENAI_API_KEY", DASHSCOPE_API_KEY or "local")  # 兼容保留
OPENAI_BASE_URL   = os.environ.get("OPENAI_BASE_URL", "http://localhost:8081/v1")   # 兼容保留
EMBEDDING_MODEL   = os.environ.get("EMBEDDING_MODEL", "text-embedding-v4")
EMBEDDING_DIM     = int(os.environ.get("EMBEDDING_DIM", "2048"))
EMBEDDING_BATCH_SIZE = int(os.environ.get("EMBEDDING_BATCH_SIZE", "10"))
# DashScope RPS=30，并发 20 留 10 余量避免触发限流
EMBEDDING_CONCURRENCY = int(os.environ.get("EMBEDDING_CONCURRENCY", "20"))

# 指标 query embedding 的 instruct 前缀（仅 query 侧使用，document/chunk 侧不加）
# 调用端拼接格式：f"Instruct: {EMBEDDING_INSTRUCT}\nQuery: {query_text}"
# compute_embeddings() 自动解析此前缀，转为 DashScope 的 text_type="query" + instruct 参数
EMBEDDING_INSTRUCT = (
    "Given an ESG (Environmental, Social, Governance) indicator description, "
    "retrieve relevant document sections that provide evidence or data for this indicator"
)

# ── Reranker（DashScope qwen3-rerank，generate_report_draft.py 直接调用 SDK）──
RERANKER_BASE_URL = os.environ.get("RERANKER_BASE_URL", "http://localhost:8083")
RERANKER_MODEL    = os.environ.get("RERANKER_MODEL",    "qwen3-rerank")
# DashScope qwen3-rerank RPM=5400，并发 10 足够保守
RERANKER_CONCURRENCY = int(os.environ.get("RERANKER_CONCURRENCY", "10"))

# Reranker task instruction（英文，DashScope qwen3-rerank 的 instruct 参数）
RERANKER_INSTRUCT = (
    "Given a section title and description from an ESG report, "
    "retrieve relevant document passages that provide evidence, data, "
    "or content useful for writing that section"
)

# ── VLM 图片分类与描述（DashScope qwen3-vl-plus，直接调用 SDK，无 GPU 依赖）──
VLM_MODEL = os.environ.get("VLM_MODEL", "qwen3-vl-plus")
# DashScope qwen3-vl-plus RPM=3000，并发 10 保守够用
VLM_CONCURRENCY = int(os.environ.get("VLM_CONCURRENCY", "10"))

# ── 智谱 OCR 并发控制（layout_parsing API，未公开限制，设保守值）──
ZHIPU_OCR_CONCURRENCY = int(os.environ.get("ZHIPU_OCR_CONCURRENCY", "5"))

# ── 阶段 2a 文件级提取并发数 ─────────────────────────────────────────────
# 控制 align_evidence.py 阶段 2a 同时提取多少个文件。
# 瓶颈在 VLM 图片处理和智谱 OCR 解析，文件级并发可显著缩短总时间。
# 默认 5；内部 VLM/OCR 各有自己的并发限制（VLM_CONCURRENCY / ZHIPU_OCR_CONCURRENCY），
# 文件级并发主要让多个文件的 API 调用能重叠等待。
EXTRACT_CONCURRENCY = int(os.environ.get("EXTRACT_CONCURRENCY", "5"))

# ── API 调用重试参数 ─────────────────────────────────────────────────────
# 适用于 VLM 图片分类、智谱 OCR（PDF 级和图片级）
# 指数退避：等待 base_delay * 2^attempt 秒（即 2s, 4s, 8s）
API_MAX_RETRIES   = int(os.environ.get("API_MAX_RETRIES", "3"))
API_RETRY_BASE_DELAY = float(os.environ.get("API_RETRY_BASE_DELAY", "2.0"))

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


# VLM 图片分类结果缓存（按图片 SHA256 去重，避免重复调用 VLM）
VLM_CACHE_PATH = os.path.join(_ROOT, "data/processed/vlm_cache.json")



# ==============================================================================
# 6. 初稿生成配置（generate_draft.py）
# ==============================================================================

# ── LLM API 配置 ──────────────────────────────────────────────────────────────
# 注意：OpenAI SDK 要求 base_url 包含 /v1 后缀
DRAFT_LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
DRAFT_LLM_API_KEY  = os.environ.get("LLM_API_KEY") or os.environ.get("DASHSCOPE_API_KEY", "")
DRAFT_LLM_MODEL    = os.environ.get("LLM_MODEL",    "deepseek-v3.2")

# ── 并发与重试 ────────────────────────────────────────────────────────────────
DRAFT_CONCURRENCY  = int(os.environ.get("DRAFT_CONCURRENCY", "6"))
DRAFT_LLM_TIMEOUT  = float(os.environ.get("DRAFT_LLM_TIMEOUT", "300.0"))
DRAFT_MAX_RETRIES  = int(os.environ.get("DRAFT_MAX_RETRIES", "3"))
DRAFT_TEMPERATURE  = float(os.environ.get("DRAFT_TEMPERATURE", "0.3"))
DRAFT_MAX_TOKENS   = int(os.environ.get("DRAFT_MAX_TOKENS", "2000"))
DRAFT_ENABLE_THINKING = os.environ.get("DRAFT_ENABLE_THINKING", "true").lower() in ("true", "1", "yes")

# ── 质量过滤与文本处理 ────────────────────────────────────────────────────────
DRAFT_SCORE_THRESHOLD = float(os.environ.get("DRAFT_SCORE_THRESHOLD", "0.50"))
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


# ==============================================================================
# 8. 多企业支持：ProjectPaths dataclass + get_paths() 工厂函数
# ==============================================================================

@dataclass
class ProjectPaths:
    """
    一个企业项目目录对应的所有路径。

    通过 get_paths(project_dir) 获取实例，不要直接构造。

    目录约定（新模式，project_dir 非 None）：
        {project_dir}/
        ├── raw/
        │   ├── ESG报告框架.xlsx        ← 每家企业独立一份
        │   ├── 资料收集清单.xlsx        ← 固定文件名
        │   └── 整理后资料/              ← 甲方整理后的文件
        └── processed/                  ← 所有缓存和输出
            ├── .chroma_db/             ← 向量库（隔离）
            ├── sections_cache.json
            ├── chunks_cache.json
            ├── chunks_emb_cache.npz
            ├── vlm_cache.json
            ├── table_summary_cache.json
            ├── indicator_query_enhanced.json
            ├── framework_retrieval_queries.json
            ├── 对齐表_YYYYMMDD.xlsx
            ├── sdk_images/
            └── report_draft/
                ├── retrieval_results.json
                └── draft_results.json
    """
    project_dir: Path
    raw_dir: Path
    processed_dir: Path
    # ── 输入 ──────────────────────────────────────────────────────────────────
    framework_xlsx: Path        # raw/ESG报告框架.xlsx
    checklist_xlsx: Path        # raw/资料收集清单.xlsx
    materials_dir: Path         # raw/整理后资料/
    # ── 缓存 ──────────────────────────────────────────────────────────────────
    section_cache: Path         # processed/sections_cache.json
    chunk_cache: Path           # processed/chunks_cache.json
    emb_cache: Path             # processed/chunks_emb_cache.npz
    vlm_cache: Path             # processed/vlm_cache.json
    table_summary_cache: Path   # processed/table_summary_cache.json
    enhanced_query: Path        # processed/indicator_query_enhanced.json
    chroma_dir: Path            # processed/.chroma_db/（新模式隔离；旧模式在项目根）
    sdk_image_dir: Path         # processed/sdk_images/
    # ── 中间产物 ──────────────────────────────────────────────────────────────
    framework_queries: Path     # processed/framework_retrieval_queries.json
    rq_progress: Path           # processed/_rq_progress.json
    alignment_glob: str         # processed/对齐表_*.xlsx（glob 模式）
    # ── 输出 ──────────────────────────────────────────────────────────────────
    draft_output_dir: Path      # processed/report_draft/
    retrieval_results: Path     # processed/report_draft/retrieval_results.json
    draft_results: Path         # processed/report_draft/draft_results.json
    # ── 共享（不隔离） ────────────────────────────────────────────────────────
    jieba_dict: Path            # data/processed/esg_jieba_dict.txt（所有企业共用）


def get_paths(project_dir=None) -> ProjectPaths:
    """
    获取项目路径对象。

    Args:
        project_dir: 企业项目目录（必传）。可以是：
            - str / Path → 企业目录（绝对路径或相对项目根的相对路径）
                           例如："projects/艾森股份_2025"

    Returns:
        ProjectPaths：包含该企业所有输入/输出/缓存路径的数据类实例。

    Examples:
        paths = get_paths("projects/艾森股份_2025")
        paths = get_paths(Path("/absolute/path/to/project"))
    """
    root = Path(_ROOT)

    if project_dir is None:
        raise ValueError(
            "project_dir is required. Legacy data/ mode has been removed.\n"
            "Please pass --project-dir <path> (e.g. --project-dir projects/艾森股份_2025)"
        )

    pd = Path(project_dir)
    if not pd.is_absolute():
        pd = root / pd
    pd = pd.resolve()
    raw = pd / "raw"
    proc = pd / "processed"
    materials = raw / "整理后资料"
    checklist_xlsx = raw / "资料收集清单.xlsx"
    framework_xlsx = raw / "ESG报告框架.xlsx"
    chroma_dir = proc / ".chroma_db"

    return ProjectPaths(
        project_dir=pd,
        raw_dir=raw,
        processed_dir=proc,
        framework_xlsx=framework_xlsx,
        checklist_xlsx=checklist_xlsx,
        materials_dir=materials,
        section_cache=proc / "sections_cache.json",
        chunk_cache=proc / "chunks_cache.json",
        emb_cache=proc / "chunks_emb_cache.npz",
        vlm_cache=proc / "vlm_cache.json",
        table_summary_cache=proc / "table_summary_cache.json",
        enhanced_query=proc / "indicator_query_enhanced.json",
        chroma_dir=chroma_dir,
        sdk_image_dir=proc / "sdk_images",
        framework_queries=proc / "framework_retrieval_queries.json",
        rq_progress=proc / "_rq_progress.json",
        alignment_glob=str(proc / "对齐表_*.xlsx"),
        draft_output_dir=proc / "report_draft",
        retrieval_results=proc / "report_draft" / "retrieval_results.json",
        draft_results=proc / "report_draft" / "draft_results.json",
        # BM25 jieba 词典领域通用，所有企业共享，不隔离
        jieba_dict=root / "data" / "processed" / "esg_jieba_dict.txt",
    )
