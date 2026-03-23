#!/usr/bin/env python3
"""
方法一：直接调用 vLLM OpenAI 兼容接口（与项目 extractors.py call_glmocr() 一致）

逻辑：
  1. PyMuPDF 打开 PDF，逐页转 PNG（dpi=150）
  2. base64 编码，构造 data URI
  3. 通过 openai.OpenAI 调用 /v1/chat/completions
  4. prompt = "Text Recognition:"
  5. 汇总写入 temp/result_method1.md

关键参数（与 extractors.py 保持一致）：
  - dpi=150（config.PDF_OCR_DPI）
  - max_tokens=8192
  - temperature=0.01
  - model="glm-ocr"
"""

import base64
import io
import time
from pathlib import Path

import fitz  # PyMuPDF
from openai import OpenAI

# ── 配置 ──────────────────────────────────────────────────────────────────────
PDF_PATH = Path(__file__).resolve().parent.parent / (
    "data/processed/模拟甲方整理后资料/D-产业价值/DA-科技创新/DA10/"
    "AS-IP-01知识产权管理手册.pdf"
)
OUTPUT_PATH = Path(__file__).resolve().parent / "result_method1.md"

VLLM_BASE_URL = "http://localhost:8080/v1"
MODEL_NAME = "glm-ocr"
DPI = 150          # 与项目 PDF_OCR_DPI 一致
MAX_TOKENS = 8192
TEMPERATURE = 0.01


def pdf_page_to_png(doc: fitz.Document, page_idx: int, dpi: int = 150) -> bytes:
    """将 PDF 指定页转为 PNG 字节流"""
    page = doc[page_idx]
    zoom = dpi / 72.0
    mat = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=mat, alpha=False)
    return pix.tobytes(output="png")


def call_glmocr(client: OpenAI, img_bytes: bytes) -> str:
    """
    调用 vLLM GLM-OCR（与 extractors.py call_glmocr 完全一致）
    """
    data_uri = "data:image/png;base64," + base64.b64encode(img_bytes).decode()
    response = client.chat.completions.create(
        model=MODEL_NAME,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": data_uri}},
                {"type": "text",      "text": "Text Recognition:"},
            ],
        }],
        max_tokens=MAX_TOKENS,
        temperature=TEMPERATURE,
    )
    return response.choices[0].message.content or ""


def main():
    print(f"[方法一] 直接 vLLM OpenAI 接口")
    print(f"  PDF: {PDF_PATH}")
    print(f"  DPI: {DPI}, max_tokens: {MAX_TOKENS}, temperature: {TEMPERATURE}")
    print()

    if not PDF_PATH.exists():
        print(f"❌ PDF 文件不存在: {PDF_PATH}")
        return

    client = OpenAI(api_key="not-needed", base_url=VLLM_BASE_URL)

    doc = fitz.open(str(PDF_PATH))
    total_pages = len(doc)
    print(f"  共 {total_pages} 页\n")

    results = []
    total_time = 0.0

    for i in range(total_pages):
        print(f"  处理第 {i+1}/{total_pages} 页 ... ", end="", flush=True)
        png_bytes = pdf_page_to_png(doc, i, dpi=DPI)

        t0 = time.time()
        text = call_glmocr(client, png_bytes)
        elapsed = time.time() - t0

        total_time += elapsed
        char_count = len(text)
        results.append((i + 1, text, elapsed, char_count))
        print(f"完成 ({elapsed:.1f}s, {char_count} 字符)")

    doc.close()

    # 写入结果
    lines = [
        f"# 方法一：直接 vLLM OpenAI 接口 OCR 结果\n",
        f"- PDF: `{PDF_PATH.name}`",
        f"- DPI: {DPI}",
        f"- max_tokens: {MAX_TOKENS}",
        f"- temperature: {TEMPERATURE}",
        f"- 总页数: {total_pages}",
        f"- 总耗时: {total_time:.1f}s",
        f"- 平均每页: {total_time/total_pages:.1f}s\n",
        "---\n",
    ]

    for page_num, text, elapsed, char_count in results:
        lines.append(f"## 第 {page_num} 页 ({elapsed:.1f}s, {char_count} 字符)\n")
        lines.append(text)
        lines.append("\n---\n")

    OUTPUT_PATH.write_text("\n".join(lines), encoding="utf-8")
    print(f"\n✅ 结果已写入: {OUTPUT_PATH}")
    print(f"   总耗时: {total_time:.1f}s, 平均每页: {total_time/total_pages:.1f}s")


if __name__ == "__main__":
    main()
