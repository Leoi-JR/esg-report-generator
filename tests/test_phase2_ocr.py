"""
tests/test_phase2_ocr.py
========================
阶段二 OCR 连通性测试。

【前提条件】运行本测试前，必须先在 ocr 环境启动 vLLM 服务：

    conda run -n ocr vllm serve /workspace/data/llm_models/models/GLM-OCR \\
        --allowed-local-media-path / \\
        --port 8080 \\
        --speculative-config '{"method": "mtp", "num_speculative_tokens": 1}' \\
        --served-model-name glm-ocr \\
        --trust-remote-code

服务就绪标志：日志出现 "Application startup complete"。

运行方式（esg 环境，需服务在线）：
    conda run -n esg python3 tests/test_phase2_ocr.py

与 test_phase2_pdf.py 的区别：
    - test_phase2_pdf.py  离线可运行（不依赖 OCR 服务）
    - test_phase2_ocr.py  需要 vLLM 服务运行中才能通过
"""

import os
import sys

# 将 src/ 加入 sys.path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from extractors import call_glmocr, extract_pdf, classify_pdf

ROOT      = os.path.join(os.path.dirname(__file__), '..')
MOCK_DATA = os.path.join(ROOT, "data/processed/模拟甲方整理后资料")

# 扫描件 PDF 路径（固定，已知存在）
SCANNED_PDF = os.path.join(
    MOCK_DATA,
    "G-公司治理/GB-规范治理与党建/GB12/GB12-20231231审计报告扫描件.pdf"
)

GLM_OCR_BASE_URL = os.environ.get("GLM_OCR_BASE_URL", "http://localhost:8080/v1")


# ==============================================================================
# 辅助：生成最小的白底黑字 PNG（用于连通性探测，不依赖真实图片）
# ==============================================================================

def _make_minimal_png() -> bytes:
    """
    生成一张包含文字 "Test 123" 的最小 PNG（使用 fitz/PyMuPDF 渲染）。
    若 fitz 不可用则回退到内嵌的 1×1 白色 PNG（仍足够验证服务可达）。
    """
    try:
        import fitz  # PyMuPDF

        # 新建一张 200×60 白色页面，写入文字后渲染为 PNG
        doc  = fitz.open()
        page = doc.new_page(width=200, height=60)
        page.insert_text((10, 40), "Test 123 ABC", fontsize=20, color=(0, 0, 0))
        pix = page.get_pixmap(dpi=150)
        return pix.tobytes("png")

    except Exception:
        # 最小 1×1 白色 PNG（Base64 已解码后的字节）
        import base64
        B64 = (
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8"
            "z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg=="
        )
        return base64.b64decode(B64)


# ==============================================================================
# 测试 1：GLM-OCR 服务连通性
# ==============================================================================

def test_glmocr_connectivity():
    """
    发送一张简单图片，验证服务可达且返回非空字符串。

    失败常见原因：
      - vLLM 服务未启动（Connection refused）
      - 模型加载中（服务端返回 503）
      - 模型名不匹配（返回 404/model not found）
    """
    img_bytes = _make_minimal_png()

    try:
        result = call_glmocr(img_bytes)
    except Exception as e:
        raise AssertionError(
            f"call_glmocr() 抛出异常：{type(e).__name__}: {e}\n"
            f"请确认 vLLM 服务已在 {GLM_OCR_BASE_URL} 启动，且模型名为 glm-ocr"
        ) from e

    assert isinstance(result, str), \
        f"返回类型应为 str，实际 {type(result)}"
    assert len(result.strip()) > 0, \
        "返回字符串为空，OCR 服务未识别出任何内容"

    print(f"  GLM-OCR 返回（前 100 字符）：{result[:100]!r}")


# ==============================================================================
# 测试 2：对扫描件 PDF 进行完整提取
# ==============================================================================

def test_ocr_scanned_pdf():
    """
    对 GB12-20231231审计报告扫描件.pdf 跑完整 extract_pdf()。

    验收标准：
      - 返回 ≥1 个 chunk
      - 至少 1 个 chunk 的 char_count > 0
      - 所有必要字段均存在
    """
    if not os.path.isfile(SCANNED_PDF):
        raise AssertionError(
            f"扫描件 PDF 不存在：{SCANNED_PDF}\n"
            f"请先运行 simulate_client_sorting.py 生成模拟资料目录"
        )

    # 先确认 classify_pdf 判定为 scanned（独立于 OCR 服务）
    import fitz
    doc      = fitz.open(SCANNED_PDF)
    pdf_type = classify_pdf(doc)
    assert pdf_type == "scanned", \
        f"预期 scanned，实际 {pdf_type}（文件：{SCANNED_PDF}）"
    doc.close()

    rel_path = os.path.relpath(SCANNED_PDF, MOCK_DATA)
    file_record = {
        "file_path":     SCANNED_PDF,
        "relative_path": rel_path,
        "file_name":     os.path.basename(SCANNED_PDF),
        "folder_code":   "GB12",
        "extension":     ".pdf",
    }

    try:
        chunks = extract_pdf(file_record)
    except Exception as e:
        raise AssertionError(
            f"extract_pdf() 抛出异常：{type(e).__name__}: {e}"
        ) from e

    assert len(chunks) >= 1, \
        f"期望至少 1 个 chunk，实际返回 {len(chunks)} 个"

    required_fields = ("chunk_id", "parent_id", "file_path", "file_name",
                       "folder_code", "page_or_sheet", "chunk_index",
                       "text", "parent_text", "char_count")
    for c in chunks:
        for field in required_fields:
            assert field in c, f"chunk 缺少字段: {field}（chunk_id={c.get('chunk_id')}）"

    total_chars = sum(c["char_count"] for c in chunks)
    assert total_chars > 0, \
        f"所有 chunk 的 char_count 总和为 0，OCR 未能识别出有效文字"

    print(f"  扫描件提取：{len(chunks)} 个 chunk，合计 {total_chars} 有效字符")
    print(f"  前 3 个 chunk 预览：")
    for c in chunks[:3]:
        preview = c["text"][:80].replace("\n", "↵")
        print(f"    [{c['chunk_id'].split('#')[-1]}] "
              f"page={c['page_or_sheet']}  "
              f"chars={c['char_count']}  "
              f"「{preview}」")


# ==============================================================================
# 运行入口
# ==============================================================================

if __name__ == "__main__":
    tests = [
        test_glmocr_connectivity,
        test_ocr_scanned_pdf,
    ]

    passed = 0
    failed = 0

    print("=" * 60)
    print("OCR 连通性测试")
    print(f"服务地址：{GLM_OCR_BASE_URL}")
    print(f"扫描件：{os.path.basename(SCANNED_PDF)}")
    print("=" * 60)
    print()

    for t in tests:
        print(f"[测试] {t.__name__} ...")
        try:
            t()
            print(f"  ✓ 通过")
            passed += 1
        except AssertionError as e:
            print(f"  ✗ 失败: {e}")
            failed += 1
        except Exception as e:
            print(f"  ✗ 异常: {type(e).__name__}: {e}")
            failed += 1

    print()
    print(f"共 {passed}/{len(tests)} 个测试通过"
          + (f"，{failed} 个失败" if failed else ""))
