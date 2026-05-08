"""
extract_glm_ocr.py
==================
使用智谱 GLM layout_parsing API 提取 PDF 文本的独立实验脚本。

功能：
  - 调用智谱线上 layout_parsing API（含版面分析）
  - 将返回的 Markdown 按标题切割为 section 列表
  - 输出人类可读的 Markdown 文件（results/md_glm/{stem}.md）
  - 输出 JSON 结果（results/glm_ocr_extraction_test.json）
  - 不依赖 src/ 目录，可独立运行

注意：
  - 图片区域（image/chart）不做 VLM 处理，仅记录坐标信息
  - 标题层级使用规则方案（不调用 LLM），适合实验对比
  - 需要在 .env 或环境变量中配置 ZHIPU_API_KEY

运行方式（在项目根目录）：
  conda run -n esg python3 experiments/pdf_classification/extract_glm_ocr.py --file path/to/file.pdf 
  conda run -n esg python3 experiments/pdf_classification/extract_glm_ocr.py --company 国际复材_2025 --limit 3
  conda run -n esg python3 experiments/pdf_classification/extract_glm_ocr.py --label scanned --limit 5
"""

import argparse
import base64
import json
import os
import re
import sys
import threading
import time
from pathlib import Path
from typing import Optional

import fitz  # PyMuPDF

# ── 路径配置 ──────────────────────────────────────────────────────────────────
SCRIPT_DIR   = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent

LABELED_DIR    = SCRIPT_DIR / "labeled"
RESULTS_DIR    = SCRIPT_DIR / "results"
MD_DIR         = RESULTS_DIR / "md_glm"
IMAGES_DIR     = RESULTS_DIR / "images_glm"
ANNOTATED_DIR  = RESULTS_DIR / "annotated_glm"

COMPANIES    = ["艾森股份_2025", "泓淋电力_2025", "国际复材_2025"]

# ── API 配置（从环境变量读取，支持 .env 文件） ─────────────────────────────────
def _load_env() -> None:
    """从项目根目录的 .env 文件加载环境变量（仅补充未设置的变量）。"""
    env_path = PROJECT_ROOT / ".env"
    if not env_path.exists():
        return
    with open(env_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = val

_load_env()

ZHIPU_API_KEY      = os.environ.get("ZHIPU_API_KEY", "")
ZHIPU_API_BASE_URL = os.environ.get("ZHIPU_API_BASE_URL",
                                     "https://open.bigmodel.cn/api/paas/v4")
GLM_OCR_MODEL      = os.environ.get("GLM_OCR_MODEL", "glm-ocr")
ZHIPU_OCR_CONCURRENCY = int(os.environ.get("ZHIPU_OCR_CONCURRENCY", "5"))
API_MAX_RETRIES    = int(os.environ.get("API_MAX_RETRIES", "3"))
API_RETRY_BASE_DELAY = float(os.environ.get("API_RETRY_BASE_DELAY", "2.0"))


# ==============================================================================
# 并发控制
# ==============================================================================

_zhipu_semaphore: threading.Semaphore | None = None
_zhipu_sem_lock = threading.Lock()

def _get_semaphore() -> threading.Semaphore:
    global _zhipu_semaphore
    if _zhipu_semaphore is None:
        with _zhipu_sem_lock:
            if _zhipu_semaphore is None:
                _zhipu_semaphore = threading.Semaphore(ZHIPU_OCR_CONCURRENCY)
    return _zhipu_semaphore


# ==============================================================================
# API 调用
# ==============================================================================

def call_zhipu_layout_parsing(
    file_data: bytes,
    file_type: str = "pdf",
    start_page: Optional[int] = None,
    end_page: Optional[int] = None,
) -> dict:
    """
    调用智谱线上 layout_parsing API。

    参数:
        file_data  : PDF 或图片的二进制数据
        file_type  : "pdf" 或 "image"
        start_page : PDF 起始页（可选，从 0 开始）
        end_page   : PDF 结束页（可选）

    返回:
        {
            "md_results":     str,   # Markdown 格式的提取文本
            "layout_details": list,  # 分页版面结构（含 bbox、label 等）
        }

    API 限制:
        - 单图 ≤ 10MB，PDF ≤ 50MB，最多 100 页
        - layout_details 中 bbox_2d 为像素坐标，region 含 width/height 页面尺寸
    """
    import requests

    if not ZHIPU_API_KEY:
        raise RuntimeError("ZHIPU_API_KEY 未配置，请在 .env 文件或环境变量中设置")

    # Base64 编码
    b64 = base64.b64encode(file_data).decode()

    # 构造 data URI
    if file_type == "pdf":
        data_uri = f"data:application/pdf;base64,{b64}"
    else:
        if file_data[:4] == b'\x89PNG':
            mime = "image/png"
        elif file_data[:2] == b'\xff\xd8':
            mime = "image/jpeg"
        else:
            mime = "image/png"
        data_uri = f"data:{mime};base64,{b64}"

    payload: dict = {
        "model": GLM_OCR_MODEL,
        "file":  data_uri,
    }
    if file_type == "pdf":
        if start_page is not None:
            payload["start_page_id"] = start_page
        if end_page is not None:
            payload["end_page_id"] = end_page

    url     = f"{ZHIPU_API_BASE_URL}/layout_parsing"
    headers = {
        "Authorization": f"Bearer {ZHIPU_API_KEY}",
        "Content-Type":  "application/json",
    }

    with _get_semaphore():
        resp = requests.post(url, headers=headers, json=payload, timeout=300)
    resp.raise_for_status()

    raw = resp.json()
    # 智谱返回结构：{"data": {"md_results": ..., "layout_details": ...}, ...}
    data = raw.get("data", raw)
    return {
        "md_results":     data.get("md_results", ""),
        "layout_details": data.get("layout_details", []),
    }


def call_with_retry(
    file_data: bytes,
    file_name: str,
    file_type: str = "pdf",
) -> Optional[dict]:
    """带重试的 API 调用，失败返回 None。"""
    for attempt in range(API_MAX_RETRIES):
        try:
            t0 = time.time()
            print(f"  GLM 解析中：{file_name} ...", flush=True)
            result = call_zhipu_layout_parsing(file_data, file_type=file_type)
            elapsed = time.time() - t0
            print(f"  ✓ 解析完成（{elapsed:.1f}s）：{file_name}")
            return result
        except Exception as e:
            wait = API_RETRY_BASE_DELAY * (2 ** attempt)
            if attempt < API_MAX_RETRIES - 1:
                print(f"  [警告] 第 {attempt + 1} 次失败：{e}，{wait:.0f}s 后重试")
                time.sleep(wait)
            else:
                print(f"  [错误] 解析失败（已重试 {API_MAX_RETRIES} 次）：{e}")
    return None


# ==============================================================================
# 标题层级推断（规则方案，不依赖 LLM）
# ==============================================================================

def _heading_numeric_level(text: str) -> int:
    """
    从标题文本推断数字编号层级。
    "1.目的" → 1，"3.1 总经理" → 2，"6.2.2.1 熟悉…" → 4
    汉字编号/第X章 → 1，无法识别 → 0
    """
    m = re.match(r'^(\d+(?:\.\d+)*)[\.、\s]', text)
    if m:
        return len(m.group(1).split('.'))
    if re.match(r'^(?:[一二三四五六七八九十]+[\.、\s]|第[一二三四五六七八九十百\d]+[章节条款])', text):
        return 1
    return 0


def rebuild_title_levels(titles: list) -> list:
    """
    规则方案：根据 SDK 标签和编号模式推断标题层级。

    输入:
        [{"index": 0, "sdk_label": "doc_title"|"paragraph_title",
          "raw_text": "1.1 目的"}, ...]
    输出:
        [{"index": 0, "level": 1|2|..., "text": "1.1 目的"}, ...]
    """
    result = []
    for t in titles:
        text  = t["raw_text"]
        label = t["sdk_label"]

        if label == "doc_title":
            level = 1
        else:
            lv = _heading_numeric_level(text)
            level = lv if lv > 0 else 2

        result.append({"index": t["index"], "level": level, "text": text})
    return result


# ==============================================================================
# Markdown → section 列表
# ==============================================================================

def parse_markdown_to_sections(markdown: str, titles_with_levels: list) -> list:
    """
    将 SDK 返回的 Markdown 按标题层级切割为 section 列表。

    返回:
        [{"section_id": "s0", "page_or_sheet": "1",
          "text": "...", "section_title": "..."}, ...]

    注意：SDK 不提供逐行页码，page_or_sheet 统一为 "1"。
    """
    lines = markdown.split("\n")

    # ── Step 1：将 Markdown 标题行匹配到 titles_with_levels ──────────────────
    title_queue = list(titles_with_levels)
    title_idx   = 0
    line_records = []

    for line in lines:
        stripped      = line.strip()
        heading_match = re.match(r'^(#{1,6})\s+(.+)$', stripped)
        if heading_match and title_idx < len(title_queue):
            heading_text  = heading_match.group(2).strip()
            expected_text = title_queue[title_idx]["text"].strip()
            if heading_text == expected_text or heading_text.startswith(expected_text[:10]):
                line_records.append({
                    "is_title": True,
                    "level":    title_queue[title_idx]["level"],
                    "text":     heading_text,
                })
                title_idx += 1
                continue

        line_records.append({"is_title": False, "level": 0, "text": line})

    # ── Step 2：确定切割层级 ─────────────────────────────────────────────────
    max_level = max((r["level"] for r in line_records if r["is_title"]), default=0)

    if max_level == 0:
        full_text = "\n".join(r["text"] for r in line_records).strip()
        if not full_text:
            return []
        return [{"section_id": "doc", "page_or_sheet": "1",
                 "text": full_text, "section_title": ""}]

    # max_level <= 2 → cut_level=1；max_level >= 3 → cut_level=2
    cut_level = 1 if max_level <= 2 else 2

    # ── Step 3：按 cut_level 切割 ────────────────────────────────────────────
    sections      = []
    current_l1    = ""
    current_title = ""
    body_parts    = []
    counter       = 0

    def _flush():
        nonlocal counter
        body     = "\n".join(body_parts).strip()
        sec_text = (current_title + "\n" + body).strip() if current_title else body
        if sec_text:
            sections.append({
                "section_id":    f"s{counter}",
                "page_or_sheet": "1",
                "text":          sec_text,
                "section_title": current_l1 if cut_level == 2 else "",
            })
            counter += 1

    for rec in line_records:
        if not rec["is_title"]:
            body_parts.append(rec["text"])
            continue

        lv = rec["level"]
        if cut_level == 1:
            _flush()
            current_title = rec["text"]
            body_parts    = []
        else:
            if lv == 1:
                _flush()
                current_l1    = rec["text"]
                current_title = ""
                body_parts    = [rec["text"]]
            elif lv == 2:
                _flush()
                current_title = rec["text"]
                body_parts    = []
            else:
                body_parts.append(rec["text"])

    _flush()
    return sections


# ==============================================================================
# layout_details 分析（版面结构摘要，不调 VLM）
# ==============================================================================

def summarize_layout(layout_details: list) -> dict:
    """
    统计 layout_details 中各类型区域的数量和页码分布。

    layout_details 格式（线上 API）:
        [[{native_label, bbox_2d, width, height, content, ...}, ...], ...]
        外层列表对应页，内层列表对应该页的各个区域。

    返回:
        {
            "pages": int,
            "regions_total": int,
            "label_counts": {"text": N, "table": N, "image": N, ...},
            "image_regions": [{"page": 1, "bbox": [...], "label": "image"}, ...]
        }
    """
    if not layout_details or not isinstance(layout_details, list):
        return {"pages": 0, "regions_total": 0, "label_counts": {}, "image_regions": []}

    label_counts:  dict = {}
    image_regions: list = []
    total          = 0

    for page_idx, page_regions in enumerate(layout_details):
        if not isinstance(page_regions, list):
            continue
        for region in page_regions:
            label = region.get("native_label", "unknown")
            label_counts[label] = label_counts.get(label, 0) + 1
            total += 1
            if label in ("image", "chart"):
                image_regions.append({
                    "page":  page_idx + 1,
                    "bbox":  region.get("bbox_2d", []),
                    "label": label,
                })

    return {
        "pages":          len(layout_details),
        "regions_total":  total,
        "label_counts":   label_counts,
        "image_regions":  image_regions,
    }


# ==============================================================================
# 图片区域裁剪保存
# ==============================================================================

CLIP_DPI = 150  # 裁剪图片分辨率（DPI），150 足够可读，不过大

def crop_and_save_images(pdf_path: Path, layout_details: list) -> list:
    """
    从 PDF 中裁剪 layout_details 标注的 image/chart 区域，保存为 PNG。

    layout_details 中每个区域包含：
        - native_label : "image" | "chart" | ...
        - bbox_2d      : [x0, y0, x1, y1]（单位：SDK 坐标系像素）
        - width        : 该页在 SDK 坐标系中的宽度（用于缩放）

    保存路径: results/images_glm/{pdf_stem}/p{page}_{label}_{idx}.png

    返回:
        [{"page": 1, "label": "image", "bbox": [...], "saved_path": "..."}, ...]
    """
    saved = []

    if not layout_details:
        return saved

    try:
        doc = fitz.open(str(pdf_path))
    except Exception as e:
        print(f"  [警告] 打开 PDF 失败（图片裁剪跳过）：{e}")
        return saved

    out_dir = IMAGES_DIR / pdf_path.stem
    out_dir.mkdir(parents=True, exist_ok=True)

    label_counter: dict = {}

    try:
        for page_idx, page_regions in enumerate(layout_details):
            if not isinstance(page_regions, list):
                continue
            if page_idx >= len(doc):
                break

            page = doc[page_idx]
            page_w_pt = page.rect.width   # PyMuPDF 坐标系（pt）

            for region in page_regions:
                label = region.get("native_label", "")
                if label not in ("image", "chart"):
                    continue

                bbox_sdk = region.get("bbox_2d", [])
                sdk_width = region.get("width", 0)

                if len(bbox_sdk) != 4 or sdk_width <= 0:
                    continue

                # 坐标缩放：SDK 像素 → PyMuPDF pt
                scale = page_w_pt / sdk_width
                x0, y0, x1, y1 = [v * scale for v in bbox_sdk]

                # 边界保护
                pw = page.rect.width
                ph = page.rect.height
                x0 = max(0.0, min(x0, pw))
                y0 = max(0.0, min(y0, ph))
                x1 = max(0.0, min(x1, pw))
                y1 = max(0.0, min(y1, ph))

                if (x1 - x0) < 5 or (y1 - y0) < 5:
                    continue  # 面积过小，跳过

                rect = fitz.Rect(x0, y0, x1, y1)
                mat  = fitz.Matrix(CLIP_DPI / 72.0, CLIP_DPI / 72.0)

                try:
                    pix = page.get_pixmap(matrix=mat, clip=rect)
                except Exception as e:
                    print(f"  [警告] 裁剪失败 p{page_idx+1} {label}：{e}")
                    continue

                # 生成文件名，同一页同标签按序号区分
                key = (page_idx + 1, label)
                cnt = label_counter.get(key, 0)
                label_counter[key] = cnt + 1
                fname = f"p{page_idx + 1}_{label}_{cnt}.png"
                save_path = out_dir / fname

                pix.save(str(save_path))

                saved.append({
                    "page":       page_idx + 1,
                    "label":      label,
                    "bbox":       bbox_sdk,
                    "saved_path": str(save_path.relative_to(PROJECT_ROOT)),
                })
    finally:
        doc.close()

    if saved:
        print(f"  ✓ 裁剪并保存 {len(saved)} 张图片 → {out_dir.relative_to(PROJECT_ROOT)}")

    return saved


# ==============================================================================
# 版面标注（bbox 可视化）
# ==============================================================================

# 每种 native_label 的标注颜色（RGB 0-1 浮点）
_LABEL_COLORS: dict[str, tuple] = {
    "doc_title":        (0.85, 0.10, 0.10),   # 深红
    "paragraph_title":  (0.95, 0.45, 0.10),   # 橙色
    "text":             (0.10, 0.55, 0.20),   # 绿色
    "content":          (0.10, 0.55, 0.20),
    "abstract":         (0.10, 0.55, 0.40),
    "table":            (0.10, 0.30, 0.85),   # 蓝色
    "image":            (0.60, 0.10, 0.85),   # 紫色
    "chart":            (0.80, 0.10, 0.70),   # 品红
    "header":           (0.50, 0.50, 0.50),   # 灰色
    "header_image":     (0.50, 0.50, 0.50),
    "footer":           (0.50, 0.50, 0.50),
    "footer_image":     (0.50, 0.50, 0.50),
    "footnote":         (0.50, 0.50, 0.50),
    "number":           (0.50, 0.50, 0.50),
    "seal":             (0.85, 0.65, 0.10),   # 金色
    "formula":          (0.20, 0.70, 0.85),   # 青色
    "display_formula":  (0.20, 0.70, 0.85),
    "inline_formula":   (0.20, 0.70, 0.85),
    "figure_title":     (0.40, 0.20, 0.60),
}
_DEFAULT_COLOR = (0.30, 0.30, 0.30)

ANNOTATE_DPI    = 150   # 标注图输出分辨率
LABEL_FONT_SIZE = 8     # bbox 标签字体大小（pt）


def annotate_pdf_pages(pdf_path: Path, layout_details: list) -> list[Path]:
    """
    在 PDF 每页上绘制 layout_details 的 bbox 矩形框和标签，输出标注图。

    每页输出一张 PNG：results/annotated_glm/{pdf_stem}/p{N}.png

    layout_details 格式（线上 API）：
        [[{native_label, bbox_2d, width, content, ...}, ...], ...]
        外层列表 = 页，内层列表 = 该页各区域。

    标注内容：
        - 彩色矩形框（按 native_label 分色）
        - 框左上角标注：label 缩写（+ content 前 12 字，若存在）

    返回：
        [Path, ...]  每页标注图的路径列表（仅已成功写出的页）
    """
    if not layout_details:
        return []

    out_dir = ANNOTATED_DIR / pdf_path.stem
    out_dir.mkdir(parents=True, exist_ok=True)

    saved_pages: list[Path] = []

    try:
        doc = fitz.open(str(pdf_path))
    except Exception as e:
        print(f"  [警告] 打开 PDF 失败（标注跳过）：{e}")
        return []

    try:
        for page_idx, page_regions in enumerate(layout_details):
            if not isinstance(page_regions, list) or not page_regions:
                continue
            if page_idx >= len(doc):
                break

            page       = doc[page_idx]
            page_w_pt  = page.rect.width
            page_h_pt  = page.rect.height

            # 渲染当前页为高清图（可写入）
            mat = fitz.Matrix(ANNOTATE_DPI / 72.0, ANNOTATE_DPI / 72.0)
            pix = page.get_pixmap(matrix=mat)

            # 转为 fitz.Pixmap（RGBA 以便半透明填充）
            if pix.alpha == 0:
                pix = fitz.Pixmap(fitz.csRGB, pix)

            # 用 fitz.ImageDraw 绘制（通过新建临时 Document + Page 来绘制）
            # 方案：直接用 Page 的 draw 方法，在 PDF 层绘制后再渲染
            # 更简单：用 page.draw_rect() 在原 PDF page 上绘制，再渲染为图
            # （fitz page 本身支持直接绘制，但会修改 doc — 用 copy 避免污染）
            tmp_doc  = fitz.open()                  # 新建临时文档
            tmp_page = tmp_doc.new_page(
                width=page_w_pt, height=page_h_pt
            )

            # 把原始页面内容贴到临时页（XObject 引用）
            tmp_page.show_pdf_page(tmp_page.rect, doc, page_idx)

            for region in page_regions:
                native_label = region.get("native_label", "unknown")
                bbox_sdk     = region.get("bbox_2d", [])
                sdk_width    = region.get("width", 0)
                content      = region.get("content") or ""

                if len(bbox_sdk) != 4 or sdk_width <= 0:
                    continue

                # 坐标缩放：SDK 像素 → PDF pt
                scale = page_w_pt / sdk_width
                x0, y0, x1, y1 = [v * scale for v in bbox_sdk]

                # 边界保护
                x0 = max(0.0, min(x0, page_w_pt))
                y0 = max(0.0, min(y0, page_h_pt))
                x1 = max(0.0, min(x1, page_w_pt))
                y1 = max(0.0, min(y1, page_h_pt))

                if (x1 - x0) < 2 or (y1 - y0) < 2:
                    continue

                rect  = fitz.Rect(x0, y0, x1, y1)
                color = _LABEL_COLORS.get(native_label, _DEFAULT_COLOR)

                # 半透明填充（fill_opacity）+ 彩色边框
                tmp_page.draw_rect(
                    rect,
                    color=color,          # 边框颜色
                    fill=color,           # 填充颜色
                    fill_opacity=0.12,    # 半透明填充
                    width=1.0,            # 边框线宽（pt）
                )

                # 标签文字：native_label + content 前 12 字
                label_text = native_label
                preview = content.replace("\n", " ").strip()[:12]
                if preview:
                    label_text += f" {preview}"

                # 文字绘制在框左上角（稍微内缩 1pt）
                text_pt = fitz.Point(x0 + 1, y0 + LABEL_FONT_SIZE)
                tmp_page.insert_text(
                    text_pt,
                    label_text,
                    fontsize=LABEL_FONT_SIZE,
                    color=color,
                )

            # 渲染标注后的临时页为图片
            ann_mat = fitz.Matrix(ANNOTATE_DPI / 72.0, ANNOTATE_DPI / 72.0)
            ann_pix = tmp_page.get_pixmap(matrix=ann_mat)
            tmp_doc.close()

            # 保存
            out_path = out_dir / f"p{page_idx + 1}.png"
            ann_pix.save(str(out_path))
            saved_pages.append(out_path)

    finally:
        doc.close()

    if saved_pages:
        print(f"  ✓ 标注图已保存 {len(saved_pages)} 页 → {out_dir.relative_to(PROJECT_ROOT)}")

    return saved_pages


# ==============================================================================
# 完整提取入口
# ==============================================================================

def extract_glm_ocr(file_record: dict) -> dict:
    """
    对单个 PDF 调用 GLM layout_parsing，返回提取结果。

    参数:
        file_record: {
            "file_path":     str,  # PDF 绝对路径
            "file_name":     str,  # 文件名（显示用）
            "relative_path": str,  # 可选
        }

    返回:
        {
            "sections":       list,  # section 列表
            "markdown_raw":   str,   # API 返回的原始 Markdown
            "layout_summary": dict,  # 版面结构摘要
            "title_count":    int,
        }
    """
    file_path = file_record["file_path"]
    file_name = file_record.get("file_name", Path(file_path).name)

    # 1. 读取文件
    try:
        with open(file_path, "rb") as f:
            pdf_bytes = f.read()
    except Exception as e:
        print(f"  [错误] 读取文件失败：{e}")
        return {"sections": [], "markdown_raw": "", "layout_summary": {}, "title_count": 0}

    # 2. 调用 API（带重试）
    api_result = call_with_retry(pdf_bytes, file_name, file_type="pdf")
    if api_result is None:
        return {"sections": [], "markdown_raw": "", "layout_summary": {}, "title_count": 0}

    markdown       = api_result.get("md_results", "")
    layout_details = api_result.get("layout_details", [])

    if not markdown.strip():
        print(f"  [警告] API 返回空 markdown：{file_name}")
        return {"sections": [], "markdown_raw": "", "layout_summary": {}, "title_count": 0}

    # 3. 提取标题列表
    title_list  = []
    title_index = 0
    for line in markdown.split("\n"):
        m = re.match(r'^(#{1,6})\s+(.+)$', line.strip())
        if m:
            sdk_label = "doc_title" if len(m.group(1)) == 1 else "paragraph_title"
            title_list.append({
                "index":     title_index,
                "sdk_label": sdk_label,
                "raw_text":  m.group(2).strip(),
            })
            title_index += 1

    # 4. 标题层级重建（规则方案）
    titles_with_levels = rebuild_title_levels(title_list) if title_list else []

    # 5. Markdown → sections
    sections = parse_markdown_to_sections(markdown, titles_with_levels)

    # 6. 版面结构摘要
    layout_summary = summarize_layout(layout_details)

    # 7. 裁剪并保存图片区域
    pdf_path_obj = Path(file_path)
    saved_images = crop_and_save_images(pdf_path_obj, layout_details)

    # 8. 版面标注（bbox 可视化）
    annotated_pages = annotate_pdf_pages(pdf_path_obj, layout_details)

    # 将保存路径回填到 layout_summary.image_regions
    if saved_images:
        # 建立 (page, label, nth) → saved_path 映射
        _img_counter: dict = {}
        _img_path_map: dict = {}
        for si in saved_images:
            key = (si["page"], si["label"])
            n = _img_counter.get(key, 0)
            _img_path_map[(si["page"], si["label"], n)] = si["saved_path"]
            _img_counter[key] = n + 1

        _counter2: dict = {}
        for region in layout_summary.get("image_regions", []):
            key = (region["page"], region["label"])
            n = _counter2.get(key, 0)
            sp = _img_path_map.get((region["page"], region["label"], n))
            if sp:
                region["saved_path"] = sp
            _counter2[key] = n + 1

    return {
        "sections":        sections,
        "markdown_raw":    markdown,
        "layout_summary":  layout_summary,
        "title_count":     len(title_list),
        "saved_images":    saved_images,
        "annotated_pages": [str(p.relative_to(PROJECT_ROOT)) for p in annotated_pages],
    }


# ==============================================================================
# Markdown 输出
# ==============================================================================

def write_markdown(pdf_path: Path, result: dict) -> Path:
    """
    将提取结果写成可读 Markdown 文件。

    格式：
      # 文件名
      > 统计摘要

      （版面结构摘要）

      ---
      ## Section 1  `s0`
      正文内容……
    """
    sections        = result["sections"]
    layout_summary  = result["layout_summary"]
    title_count     = result["title_count"]
    markdown_raw    = result["markdown_raw"]
    annotated_pages = result.get("annotated_pages", [])

    lines: list[str] = []

    # ── 文件头 ────────────────────────────────────────────────────────────────
    lines.append(f"# {pdf_path.stem}")
    lines.append("")
    lines.append(f"> **来源**：`{pdf_path.name}`")
    lines.append(">")
    lines.append(f"> sections: **{len(sections)}**　"
                 f"标题数: **{title_count}**　"
                 f"版面区域总数: **{layout_summary.get('regions_total', 0)}**")

    label_counts = layout_summary.get("label_counts", {})
    if label_counts:
        lc_str = "　".join(f"{k}={v}" for k, v in sorted(label_counts.items()))
        lines.append(f"> 版面标签: {lc_str}")

    img_regions = layout_summary.get("image_regions", [])
    if img_regions:
        lines.append(f"> 图片/图表区域: {len(img_regions)} 个"
                     f"（页码: {sorted({r['page'] for r in img_regions})}）")
        for r in img_regions:
            sp = r.get("saved_path", "")
            bbox_str = str(r.get("bbox", []))
            if sp:
                lines.append(f">   - p{r['page']} [{r['label']}] → `{sp}`")
            else:
                lines.append(f">   - p{r['page']} [{r['label']}] bbox={bbox_str}（未保存）")

    if annotated_pages:
        lines.append(f"> 版面标注图: {len(annotated_pages)} 页")
        for ap in annotated_pages:
            lines.append(f">   - `{ap}`")
    lines.append("")

    if not sections:
        lines.append("> ⚠️ 无有效 section，请检查 API 返回。")
        lines.append("")
        lines.append("## 原始 Markdown")
        lines.append("")
        lines.append(markdown_raw[:2000] + ("…（截断）" if len(markdown_raw) > 2000 else ""))
    else:
        for idx, sec in enumerate(sections, 1):
            lines.append("---")
            lines.append("")
            sid   = sec["section_id"]
            page  = sec["page_or_sheet"]
            title = sec["section_title"]
            title_str = f"  上级标题: *{title}*" if title else ""
            lines.append(f"## Section {idx}　`{sid}`　· 第 {page} 页{title_str}")
            lines.append("")
            lines.append(sec["text"])
            lines.append("")

    MD_DIR.mkdir(parents=True, exist_ok=True)
    out_path = MD_DIR / f"{pdf_path.stem}.md"
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    return out_path


# ==============================================================================
# 主流程
# ==============================================================================

def run_single(pdf_path: Path, all_results: list) -> None:
    """对单个 PDF 运行提取，写出 MD，将摘要追加到 all_results。"""
    file_record = {
        "file_path":     str(pdf_path),
        "file_name":     pdf_path.name,
        "relative_path": str(pdf_path.relative_to(PROJECT_ROOT)),
    }

    result  = extract_glm_ocr(file_record)
    md_path = write_markdown(pdf_path, result)

    sections = result["sections"]
    char_counts = [len(s["text"]) for s in sections] if sections else [0]

    summary = {
        "sections_count":  len(sections),
        "title_count":     result["title_count"],
        "char_min":        min(char_counts),
        "char_avg":        round(sum(char_counts) / len(char_counts), 1) if char_counts else 0,
        "char_max":        max(char_counts),
        "layout_summary":  result["layout_summary"],
        "saved_images":    result.get("saved_images", []),
        "annotated_pages": result.get("annotated_pages", []),
    }

    # JSON 中截断 text 为前 200 字
    serializable_sections = []
    for s in sections:
        entry = dict(s)
        entry["text"] = s["text"][:200] + ("…" if len(s["text"]) > 200 else "")
        serializable_sections.append(entry)

    all_results.append({
        "file_name": pdf_path.name,
        "file_path": str(pdf_path.relative_to(PROJECT_ROOT)),
        "md_path":   str(md_path.relative_to(PROJECT_ROOT)),
        "summary":   summary,
        "sections":  serializable_sections,
    })

    name_col = (pdf_path.stem[:44] + "…") if len(pdf_path.stem) > 45 else pdf_path.stem
    md_rel   = str(md_path.relative_to(PROJECT_ROOT))
    print(
        f"  {name_col:<45} "
        f"sec={summary['sections_count']:>3} "
        f"title={summary['title_count']:>3} "
        f"avg={summary['char_avg']:>7}  "
        f"{md_rel}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="GLM layout_parsing PDF 提取测试")
    parser.add_argument("--file",    type=str, default=None,
                        help="直接指定单个 PDF 路径（绝对或相对于项目根目录）")
    parser.add_argument("--company", type=str, default=None,
                        help=f"指定企业，可选：{COMPANIES}")
    parser.add_argument("--label",   type=str, default="text_normal",
                        help="labeled/ 下的子目录标签（默认 text_normal）")
    parser.add_argument("--limit",   type=int, default=3,
                        help="每个企业最多测试 N 个 PDF（默认 3）")
    args = parser.parse_args()

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    MD_DIR.mkdir(parents=True, exist_ok=True)
    all_results: list = []

    # ── 单文件模式 ────────────────────────────────────────────────────────────
    if args.file:
        pdf_path = Path(args.file)
        if not pdf_path.is_absolute():
            pdf_path = PROJECT_ROOT / pdf_path
        if not pdf_path.exists():
            print(f"[ERROR] 文件不存在：{pdf_path}")
            sys.exit(1)
        print(f"\n[单文件模式] {pdf_path.name}")
        run_single(pdf_path, all_results)
        _save_results(all_results)
        return

    # ── 批量模式 ──────────────────────────────────────────────────────────────
    targets = [args.company] if args.company else COMPANIES
    for company in targets:
        if company not in COMPANIES:
            print(f"[ERROR] 未知企业：{company}")
            continue

        label_dir = LABELED_DIR / company / args.label
        if not label_dir.exists():
            print(f"[WARN] 目录不存在：{label_dir}")
            continue

        pdfs = sorted(label_dir.glob("*.pdf"))[:args.limit]
        if not pdfs:
            print(f"[WARN] {label_dir} 下无 PDF")
            continue

        print(f"\n{'='*70}")
        print(f"  {company}  /  {args.label}  测试 {len(pdfs)} 个 PDF")
        print(f"{'='*70}")
        print(f"  {'文件名':<45} {'sec':>3} {'title':>5} {'avg字符':>7}  md 输出")

        for pdf_path in pdfs:
            run_single(pdf_path, all_results)

    _save_results(all_results)


def _save_results(all_results: list) -> None:
    out_path = RESULTS_DIR / "glm_ocr_extraction_test.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(all_results, f, ensure_ascii=False, indent=2)
    print(f"\n结果已保存：{out_path.relative_to(PROJECT_ROOT)}")
    print("完成。")


if __name__ == "__main__":
    main()
