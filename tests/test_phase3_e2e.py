"""
tests/test_phase3_e2e.py
========================
阶段三端到端快速验证脚本。

目的：用少量有代表性的文件（~10 个，每种文件类型各 1 个）走完
「阶段二文本提取 → 阶段三 embedding → ChromaDB 写入」完整链路，
在 2-5 分钟内验证流程打通，无需处理全部 255 个文件。

选取原则：
  - 每种文件类型各 1 个（pdf / docx / doc / xlsx / xls / jpg / png / ppt）
  - 优先选取文件体积小的（减少处理时间）
  - 包含 1 个兜底文件夹文件（folder_code=None，验证 🔍 状态输入）

不验证：
  - OCR 文字质量（GLM-OCR 需要独立 vLLM 服务）
  - 阶段四对齐计算（未实现）

运行方式（需先启动 embedding_server）：
    conda run -n esg python3 tests/test_phase3_e2e.py

前置条件：
    CUDA_VISIBLE_DEVICES=1 conda run -n bge python3 src/embedding_server.py &
    curl http://localhost:8081/health  # 确认就绪
"""

import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

ROOT      = os.path.join(os.path.dirname(__file__), '..')
MOCK_DATA = os.path.join(ROOT, "data/processed/模拟甲方整理后资料")

from extractors import (
    extract_pdf, extract_docx, extract_doc,
    extract_xlsx, extract_xls,
    extract_ppt,
    extract_image,
)
from align_evidence import (
    load_indicator_details,
    build_indicator_queries,
    build_indicator_collection,
    embed_chunks,
)
from config import (
    OPENAI_API_KEY, OPENAI_BASE_URL, EMBEDDING_MODEL,
    EMBEDDING_DIM,
    CHROMA_PERSIST_DIR,
)

# ==============================================================================
# 测试文件集：每种类型 1 个，优先体积小，含 1 个兜底文件夹文件
# ==============================================================================

REFERENCE_EXCEL = os.path.join(
    ROOT, "data/raw/资料收集清单-to艾森/【艾森股份】1-【定性】ESG报告资料清单.xlsx"
)

# (相对路径, folder_code, 提取函数)
_BASE = MOCK_DATA
SAMPLE_FILES = [
    # PDF — 普通文档（小）
    (os.path.join(_BASE, "S-人权与社会/SD-安全生产/SD9/AQ-02-01-01安全方针和目标-2025.pdf"),
     "SD9", extract_pdf),
    # DOCX
    (os.path.join(_BASE, "D-产业价值/DA-科技创新/DA2/DA2-公司科技创新平台建设、高新技术企业认定情况.docx"),
     "DA2", extract_docx),
    # DOC
    (os.path.join(_BASE, "E-环境保护/EB-污染物管控/EB15/EB15：水电能耗节约方案.doc"),
     "EB15", extract_doc),
    # XLSX
    (os.path.join(_BASE, "A-总体概况/A7/清单.xlsx"),
     "A7", extract_xlsx),
    # XLS
    (os.path.join(_BASE, "D-产业价值/DC-产品质量与客户/DC2/2025年度质量培训汇总.xls"),
     "DC2", extract_xls),
    # JPG
    (os.path.join(_BASE, "A-总体概况/A10/b1b1f7cc268c882f7db4dfca290b211a.jpg"),
     "A10", extract_image),
    # PNG
    (os.path.join(_BASE, "E-环境保护/EB-污染物管控/EB8/EB8：网站查询.png"),
     "EB8", extract_image),
    # PPT
    (os.path.join(_BASE, "E-环境保护/EB-污染物管控/EB3/EB3：危废管理.ppt"),
     "EB3", extract_ppt),
    # 兜底文件夹（folder_code=None）— 验证无路径标签的 chunk 正确处理
    (os.path.join(_BASE, "【补充资料-不确定分类】/ASEMNTAQ-03-06-02供应商风险评价表.docx"),
     None, extract_docx),
    (os.path.join(_BASE, "【补充资料-不确定分类】/2025年计算公式.xlsx"),
     None, extract_xlsx),
]

# ChromaDB 使用独立测试目录，不污染生产数据
TEST_CHROMA_DIR = os.path.join(ROOT, ".chroma_db_test")
COMPANY_NAME    = "aisenESG-e2e-test"   # 独立 collection 名，不覆盖生产
                                        # ChromaDB 要求 [a-zA-Z0-9._-]，不能含中文


# ==============================================================================
# 辅助
# ==============================================================================

def _make_file_record(file_path: str, folder_code) -> dict:
    return {
        "file_path":     file_path,
        "file_name":     os.path.basename(file_path),
        "relative_path": os.path.relpath(file_path, MOCK_DATA),
        "folder_code":   folder_code,
        "extension":     os.path.splitext(file_path)[1].lower(),
    }


def _sep(title: str):
    print()
    print(f"{'─' * 50}")
    print(f"  {title}")
    print(f"{'─' * 50}")


# ==============================================================================
# 主验证流程
# ==============================================================================

def run_e2e():
    print("═" * 55)
    print("  阶段三端到端验证 — 快速模式（~10 个文件）")
    print("═" * 55)

    # GLM-OCR 已切换至智谱线上 API，无需手动配置

    # ── Step 1：加载指标详情 ──────────────────────────────────────────────
    _sep("Step 1 / 4  加载指标详情映射")
    t0 = time.time()
    indicator_details = load_indicator_details(REFERENCE_EXCEL)
    print(f"  ✓ 加载 {len(indicator_details)} 个指标（{time.time()-t0:.1f}s）")

    # ── Step 2：文本提取与分块（抽样文件）────────────────────────────────
    _sep("Step 2 / 4  文本提取与分块（抽样文件）")
    chunk_records = []
    skip_count    = 0

    for file_path, folder_code, extractor in SAMPLE_FILES:
        fname = os.path.basename(file_path)
        if not os.path.exists(file_path):
            print(f"  [跳过] 文件不存在：{fname}")
            skip_count += 1
            continue

        t0     = time.time()
        fr     = _make_file_record(file_path, folder_code)
        chunks = extractor(fr)
        elapsed = time.time() - t0

        ext_label   = os.path.splitext(fname)[1].upper()
        code_label  = folder_code or "（兜底）"
        char_total  = sum(c.get("char_count", 0) for c in chunks)

        if chunks:
            print(f"  ✓ [{ext_label}] {fname[:45]:<45} "
                  f"→ {len(chunks):3d} 块 / {char_total:5d} 字  ({elapsed:.1f}s)  [{code_label}]")
        else:
            print(f"  ⚠ [{ext_label}] {fname[:45]:<45} "
                  f"→ 0 块（OCR 服务未启动或文件异常）        [{code_label}]")

        chunk_records.extend(chunks)

    print()
    print(f"  合计：{len(chunk_records)} 个文本块，{skip_count} 个文件跳过")

    if not chunk_records:
        print()
        print("  [中止] 没有成功提取到任何文本块，无法继续阶段三验证。")
        print("  提示：图片/扫描件类文件需要 GLM-OCR 服务，其他类型应能正常提取。")
        return False

    # 字段完整性检查
    required = {"chunk_id", "parent_id", "file_path", "file_name",
                "folder_code", "text", "char_count", "page_or_sheet", "chunk_index"}
    missing_fields = set()
    for c in chunk_records:
        missing_fields |= required - set(c.keys())
    if missing_fields:
        print(f"  [错误] chunk 缺少字段：{missing_fields}")
        return False
    print(f"  ✓ 所有 chunk 字段完整（必填字段 {len(required)} 个）")

    # folder_code=None 的兜底 chunk 数量
    fallback_chunks = [c for c in chunk_records if c["folder_code"] is None]
    print(f"  ✓ 兜底 chunk（folder_code=None）：{len(fallback_chunks)} 个")

    # ── Step 3a：构建指标查询文本 ─────────────────────────────────────────
    _sep("Step 3 / 4  构建向量库")
    t0 = time.time()
    indicator_queries = build_indicator_queries(indicator_details)
    print(f"  ✓ 3a 构建 {len(indicator_queries)} 条指标查询文本（{time.time()-t0:.1f}s）")

    # 抽样展示 2 条（跳过 A 类总体概况，topic/indicator 为空是已知限制）
    shown = 0
    for code, q in indicator_queries.items():
        if shown >= 2:
            break
        if not indicator_details.get(code, {}).get("topic"):
            continue
        print(f"     {code}: {q[:80]}...")
        shown += 1

    # ── Step 3b+3c：指标 embedding → ChromaDB ─────────────────────────────
    print()
    print("  [3b+3c] 计算指标 embedding 并写入 ChromaDB...")
    t0 = time.time()
    collection = build_indicator_collection(
        indicator_queries,
        indicator_details,
        OPENAI_API_KEY,
        OPENAI_BASE_URL,
        EMBEDDING_MODEL,
        TEST_CHROMA_DIR,
        COMPANY_NAME,
    )
    elapsed_3bc = time.time() - t0

    if collection is None:
        print("  [错误] build_indicator_collection 返回 None，检查 chromadb 安装")
        return False

    stored_count = collection.count()
    print(f"  ✓ 3b+3c ChromaDB collection 写入完成：{stored_count} 条（{elapsed_3bc:.1f}s）")

    if stored_count == 0:
        print("  [错误] collection 为空，embedding API 可能未响应")
        return False

    # 抽查：取 1 个指标的向量，验证维度正确
    sample_result = collection.get(ids=["GA1"], include=["embeddings"])
    embs = sample_result.get("embeddings") if sample_result else None
    if embs is not None and len(embs) > 0 and embs[0] is not None and len(embs[0]) > 0:
        dim = len(embs[0])
        print(f"  ✓ 向量维度检查（GA1）：{dim} 维"
              f"{'（✓ 符合预期维度）' if dim == EMBEDDING_DIM else f'（警告：预期 {EMBEDDING_DIM}，实际 {dim}）'}")
    else:
        print("  [警告] 无法取回 GA1 的 embedding 做维度检查")

    # ── Step 3d：chunk embedding（内存驻留）──────────────────────────────
    print()
    print(f"  [3d] 计算 {len(chunk_records)} 个 chunk 的 embedding...")
    t0 = time.time()
    chunk_records_with_emb = embed_chunks(
        chunk_records,
        OPENAI_API_KEY,
        OPENAI_BASE_URL,
        EMBEDDING_MODEL,
    )
    elapsed_3d = time.time() - t0

    valid_emb   = [c for c in chunk_records_with_emb if c.get("embedding") is not None]
    empty_emb   = [c for c in chunk_records_with_emb if c.get("embedding") is None]
    valid_nonempty = [c for c in valid_emb if c.get("embedding")]

    print(f"  ✓ 3d chunk embedding 完成（{elapsed_3d:.1f}s）")
    print(f"     有效向量：{len(valid_nonempty)} 个 / 零向量（API 失败）：{len(valid_emb)-len(valid_nonempty)} 个 / 空文本跳过：{len(empty_emb)} 个")

    if valid_nonempty:
        sample_emb = valid_nonempty[0]["embedding"]
        print(f"     样本维度：{len(sample_emb)} 维"
              f"{'（✓）' if len(sample_emb) == EMBEDDING_DIM else f'（警告：预期 {EMBEDDING_DIM}）'}")

    # ── Step 4：复用检测验证 ──────────────────────────────────────────────
    _sep("Step 4 / 4  复用检测（第二次调用应跳过重建）")
    t0 = time.time()
    collection2 = build_indicator_collection(
        indicator_queries,
        indicator_details,
        OPENAI_API_KEY,
        OPENAI_BASE_URL,
        EMBEDDING_MODEL,
        TEST_CHROMA_DIR,
        COMPANY_NAME,
    )
    elapsed_reuse = time.time() - t0
    print(f"  ✓ 第二次调用耗时 {elapsed_reuse:.2f}s（首次 {elapsed_3bc:.1f}s）"
          f" → {'✓ 复用缓存生效' if elapsed_reuse < elapsed_3bc * 0.1 else '⚠ 未见明显加速，请检查日志'}")

    # ── 最终摘要 ──────────────────────────────────────────────────────────
    print()
    print("═" * 55)
    print("  端到端验证结果摘要")
    print("═" * 55)
    print(f"  文件类型覆盖  : {len([f for f,_,_ in SAMPLE_FILES if os.path.exists(f)])} / {len(SAMPLE_FILES)} 个文件成功处理")
    print(f"  文本块提取    : {len(chunk_records)} 个")
    print(f"  指标 embedding: {stored_count} / {len(indicator_queries)} 条写入 ChromaDB")
    print(f"  chunk embedding: {len(valid_nonempty)} / {len(chunk_records)} 个有效向量")
    print(f"  ChromaDB 路径  : {TEST_CHROMA_DIR}")
    print()

    all_ok = (
        stored_count > 0 and
        len(valid_nonempty) > 0 and
        len(chunk_records) > 0
    )
    if all_ok:
        print("  ✅ 阶段三链路验证通过，可以进入阶段四开发。")
    else:
        print("  ❌ 部分验证未通过，请检查上方警告信息。")

    print()
    return all_ok


if __name__ == "__main__":
    success = run_e2e()
    sys.exit(0 if success else 1)
