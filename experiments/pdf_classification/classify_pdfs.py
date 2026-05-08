"""
classify_pdfs.py
================
PDF 预分类实验脚本。

目标：对每个 PDF 提取多维数值指标并打上分类标签，为后续差异化文本提取逻辑提供数据支撑。

指标说明：
  - total_pages         : 总页数
  - total_chars         : 全文字符总数（PyMuPDF 直接提取）
  - avg_chars_per_page  : 页均字符数
  - min_chars_page      : 最少字符页的字符数
  - max_chars_page      : 最多字符页的字符数
  - low_char_pages      : 字符数 < LOW_CHAR_THRESHOLD 的页面数量
  - low_char_ratio      : 字符数 < LOW_CHAR_THRESHOLD 的页面占比
  - total_images        : 全文图片总数（xref 去重后）
  - avg_images_per_page : 页均图片数
  - avg_image_area_ratio: 页均图片面积占页面面积比例（通过 get_image_rects 获取显示位置）
  - max_image_area_ratio: 所有页中图片面积占比的最大值
  - garbled_ratio       : 非 Unicode 有效字符比例（乱码估计）
  - mean_aspect_ratio   : 前 N 页平均宽高比（判断是否为 PPT 转 PDF）
  - label               : 分类标签
  - error               : 异常信息（正常为空）

分类标签（label，按优先级顺序）：
  "empty"       → 空文件（0页 或 无文字无图片）
  "scanned"     → 扫描件（low_char_ratio >= 0.5）
  "mixed_scan"  → 混合型（0 < low_char_ratio < 0.5，部分页无文字）
  "ppt_pdf"     → PPT 转 PDF（mean_aspect_ratio > 1.2 且文字少或图片多）
  "image_heavy" → 图片主体（avg_image_area_ratio > 0.5）
  "text_normal" → 普通文字 PDF

运行方式（在项目根目录）：
  conda run -n esg python3 experiments/pdf_classification/classify_pdfs.py
  conda run -n esg python3 experiments/pdf_classification/classify_pdfs.py --limit 20
  conda run -n esg python3 experiments/pdf_classification/classify_pdfs.py --company 艾森股份_2025
"""

import argparse
import csv
import os
import re
import sys
import traceback
from pathlib import Path
from typing import Optional

# ── 路径配置 ────────────────────────────────────────────────────────────────
# 脚本位于 experiments/pdf_classification/，项目根目录在上两级
SCRIPT_DIR   = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent

COMPANIES = {
    "艾森股份_2025": PROJECT_ROOT / "projects" / "艾森股份_2025" / "raw" / "整理后资料",
    "泓淋电力_2025": PROJECT_ROOT / "projects" / "泓淋电力_2025" / "raw" / "整理后资料",
    "国际复材_2025": PROJECT_ROOT / "projects" / "国际复材_2025" / "raw" / "整理后资料",
}

RESULTS_DIR = SCRIPT_DIR / "results"

# ── 阈值常量 ────────────────────────────────────────────────────────────────
LOW_CHAR_THRESHOLD   = 30    # 页面字符数低于此值视为"低字符页"
PPT_ASPECT_RATIO     = 1.2   # 宽高比超过此值怀疑是 PPT 转 PDF
PPT_AVG_BLOCK_CHARS  = 80    # 配合宽高比判断 PPT：页均字符 < 此值
PPT_AVG_IMAGES       = 1     # 配合宽高比判断 PPT：页均图片 >= 此值
IMAGE_HEAVY_RATIO    = 0.5   # 页均图片面积占比 > 此值 → image_heavy
SAMPLE_PAGES_ASPECT  = 5     # 计算平均宽高比时的采样页数


# ── 有效字符 / 乱码检测 ──────────────────────────────────────────────────────
# 有效字符集：中文（CJK基本区 + 扩展A区）、ASCII 可打印字符、
#             中文常用标点、空白字符
_VALID_CHAR_PATTERN = re.compile(
    r'[\u4e00-\u9fff'          # CJK 统一汉字
    r'\u3400-\u4dbf'           # CJK 扩展 A
    r'\u0020-\u007e'           # ASCII 可打印（含英文字母、数字、标准标点）
    r'\uff00-\uffef'           # 全角字符（全角字母/数字/标点）
    r'\u3000-\u303f'           # CJK 符号和标点
    r'\s]'                     # 空白字符
)


def estimate_garbled_ratio(text: str) -> float:
    """估计文本中乱码字符的比例。

    乱码字符 = 非"有效字符集"内的字符。
    有效字符集包括：中文、英文字母、数字、常用标点、全角字符、空白。
    返回值范围 [0.0, 1.0]，值越大说明乱码越多。
    """
    if not text:
        return 0.0
    valid_count = len(_VALID_CHAR_PATTERN.findall(text))
    return 1.0 - valid_count / len(text)


# ── 单个 PDF 分析 ────────────────────────────────────────────────────────────

def analyze_pdf(pdf_path: Path, company: str) -> dict:
    """分析单个 PDF，返回指标字典。出错时 label='error'，error 字段记录原因。"""
    import fitz  # PyMuPDF

    rel_path = str(pdf_path.relative_to(PROJECT_ROOT))
    result = {
        "file_path":           rel_path,
        "file_name":           pdf_path.name,
        "company":             company,
        "total_pages":         0,
        "total_chars":         0,
        "avg_chars_per_page":  0.0,
        "min_chars_page":      0,
        "max_chars_page":      0,
        "low_char_pages":      0,
        "low_char_ratio":      0.0,
        "total_images":        0,
        "avg_images_per_page": 0.0,
        "avg_image_area_ratio":0.0,
        "max_image_area_ratio":0.0,
        "garbled_ratio":       0.0,
        "mean_aspect_ratio":   0.0,
        "label":               "text_normal",
        "error":               "",
    }

    try:
        doc = fitz.open(str(pdf_path))
        total_pages = len(doc)
        result["total_pages"] = total_pages

        if total_pages == 0:
            result["label"] = "empty"
            doc.close()
            return result

        # ── 逐页统计 ────────────────────────────────────────────────────────
        page_chars:        list[int]   = []
        page_image_counts: list[int]   = []
        page_image_ratios: list[float] = []
        aspect_ratios:     list[float] = []
        all_text_parts:    list[str]   = []

        seen_xrefs: set[int] = set()

        for page_idx, page in enumerate(doc):
            # 1. 字符数（直接文字提取）
            text = page.get_text()
            chars = len(text)
            page_chars.append(chars)
            all_text_parts.append(text)

            # 2. 宽高比（仅前 SAMPLE_PAGES_ASPECT 页）
            if page_idx < SAMPLE_PAGES_ASPECT:
                rect = page.rect
                ratio = rect.width / rect.height if rect.height > 0 else 1.0
                aspect_ratios.append(ratio)

            # 3. 图片：数量 + 面积占比（get_image_rects 获取实际显示位置）
            page_area = page.rect.width * page.rect.height
            images    = page.get_images(full=True)
            img_area  = 0.0
            page_new_images = 0

            for img_info in images:
                xref = img_info[0]
                if xref not in seen_xrefs:
                    seen_xrefs.add(xref)
                    page_new_images += 1

                # 图片在页面上的显示矩形（可能被多页引用，只统计本页的显示面积）
                try:
                    rects = page.get_image_rects(xref)
                    for r in rects:
                        img_area += r.width * r.height
                except Exception:
                    pass

            page_image_counts.append(len(images))  # 本页引用图片数（含重复 xref）
            page_image_ratio = min(img_area / page_area, 1.0) if page_area > 0 else 0.0
            page_image_ratios.append(page_image_ratio)

        doc.close()

        # ── 汇总统计 ────────────────────────────────────────────────────────
        total_chars     = sum(page_chars)
        low_char_pages  = sum(1 for c in page_chars if c < LOW_CHAR_THRESHOLD)
        low_char_ratio  = low_char_pages / total_pages
        total_images    = len(seen_xrefs)
        avg_imgs        = sum(page_image_counts) / total_pages
        avg_img_ratio   = sum(page_image_ratios) / total_pages
        max_img_ratio   = max(page_image_ratios) if page_image_ratios else 0.0
        mean_aspect     = sum(aspect_ratios) / len(aspect_ratios) if aspect_ratios else 1.0
        full_text       = "".join(all_text_parts)
        garbled         = estimate_garbled_ratio(full_text)

        result.update({
            "total_chars":          total_chars,
            "avg_chars_per_page":   round(total_chars / total_pages, 1),
            "min_chars_page":       min(page_chars),
            "max_chars_page":       max(page_chars),
            "low_char_pages":       low_char_pages,
            "low_char_ratio":       round(low_char_ratio, 4),
            "total_images":         total_images,
            "avg_images_per_page":  round(avg_imgs, 2),
            "avg_image_area_ratio": round(avg_img_ratio, 4),
            "max_image_area_ratio": round(max_img_ratio, 4),
            "garbled_ratio":        round(garbled, 4),
            "mean_aspect_ratio":    round(mean_aspect, 3),
        })

        # ── 打分类标签（按优先级） ──────────────────────────────────────────
        result["label"] = _classify(result)

    except Exception as e:
        result["label"] = "error"
        result["error"] = f"{type(e).__name__}: {e}"

    return result


def _classify(r: dict) -> str:
    """根据指标字典返回分类标签（按优先级）。"""
    total_pages = r["total_pages"]
    total_chars = r["total_chars"]
    total_images = r["total_images"]

    # 1. 空文件
    if total_pages == 0:
        return "empty"
    if total_chars == 0 and total_images == 0:
        return "empty"

    low_char_ratio      = r["low_char_ratio"]
    mean_aspect         = r["mean_aspect_ratio"]
    avg_chars_per_page  = r["avg_chars_per_page"]
    avg_images_per_page = r["avg_images_per_page"]
    avg_img_ratio       = r["avg_image_area_ratio"]

    # 2. 扫描件（超半数页无文字）
    if low_char_ratio >= 0.5:
        return "scanned"

    # 3. 混合扫描件（部分页无文字）
    if low_char_ratio > 0:
        return "mixed_scan"

    # 4. PPT 转 PDF（横版 + 文字稀疏 或 图片多）
    if mean_aspect > PPT_ASPECT_RATIO and (
        avg_chars_per_page < PPT_AVG_BLOCK_CHARS
        or avg_images_per_page >= PPT_AVG_IMAGES
    ):
        return "ppt_pdf"

    # 5. 图片主体
    if avg_img_ratio > IMAGE_HEAVY_RATIO:
        return "image_heavy"

    # 6. 普通文字 PDF
    return "text_normal"


# ── 扫描目录、收集 PDF 路径 ──────────────────────────────────────────────────

def collect_pdfs(root_dir: Path) -> list[Path]:
    """递归收集目录下所有 PDF 文件，跳过 macOS 元数据文件（._开头）。"""
    pdfs = []
    for path in sorted(root_dir.rglob("*.pdf")):
        if path.name.startswith("._"):
            continue  # macOS 隐藏元数据文件
        pdfs.append(path)
    return pdfs


# ── 输出 CSV ────────────────────────────────────────────────────────────────

FIELDNAMES = [
    "file_path", "file_name", "company",
    "total_pages", "total_chars",
    "avg_chars_per_page", "min_chars_page", "max_chars_page",
    "low_char_pages", "low_char_ratio",
    "total_images", "avg_images_per_page",
    "avg_image_area_ratio", "max_image_area_ratio",
    "garbled_ratio", "mean_aspect_ratio",
    "label", "error",
]


def save_csv(rows: list[dict], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(rows)


# ── 控制台摘要 ───────────────────────────────────────────────────────────────

def print_summary(company: str, rows: list[dict]) -> None:
    from collections import Counter
    label_counts = Counter(r["label"] for r in rows)
    error_count  = sum(1 for r in rows if r["error"])

    print(f"\n{'='*60}")
    print(f"  {company}  共 {len(rows)} 个 PDF")
    print(f"{'='*60}")

    label_order = ["text_normal", "scanned", "mixed_scan", "ppt_pdf",
                   "image_heavy", "empty", "error"]
    label_names = {
        "text_normal":  "普通文字 PDF",
        "scanned":      "扫描件（全页无文字）",
        "mixed_scan":   "混合扫描件（部分页无文字）",
        "ppt_pdf":      "PPT 转 PDF",
        "image_heavy":  "图片主体 PDF",
        "empty":        "空文件",
        "error":        "处理出错",
    }
    for label in label_order:
        cnt = label_counts.get(label, 0)
        if cnt:
            pct = cnt / len(rows) * 100
            print(f"  {label_names[label]:<22} ({label:<12}) : {cnt:>4} 个  {pct:5.1f}%")

    # 未在 label_order 中的标签（理论上不应有）
    for label, cnt in label_counts.items():
        if label not in label_order:
            print(f"  {label:<34} : {cnt:>4} 个")

    if error_count:
        print(f"\n  ⚠️  {error_count} 个文件处理出错，详见 CSV 的 error 列")

    print()


# ── 主流程 ───────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="PDF 预分类实验脚本")
    parser.add_argument(
        "--limit", type=int, default=None,
        help="每个企业只处理前 N 个 PDF（调试用）"
    )
    parser.add_argument(
        "--company", type=str, default=None,
        help=f"只处理指定企业，可选值：{list(COMPANIES.keys())}"
    )
    args = parser.parse_args()

    # 确定要处理的企业列表
    if args.company:
        if args.company not in COMPANIES:
            print(f"[ERROR] 未知企业: {args.company}，可选值：{list(COMPANIES.keys())}")
            sys.exit(1)
        target_companies = {args.company: COMPANIES[args.company]}
    else:
        target_companies = COMPANIES

    for company, root_dir in target_companies.items():
        if not root_dir.exists():
            print(f"[WARN] 目录不存在，跳过：{root_dir}")
            continue

        print(f"\n[{company}] 扫描 PDF 文件：{root_dir}")
        pdfs = collect_pdfs(root_dir)
        print(f"[{company}] 共找到 {len(pdfs)} 个 PDF（已排除 ._ 元数据文件）")

        if args.limit:
            pdfs = pdfs[: args.limit]
            print(f"[{company}] --limit={args.limit}，实际处理 {len(pdfs)} 个")

        rows: list[dict] = []
        for i, pdf_path in enumerate(pdfs, 1):
            rel = str(pdf_path.relative_to(PROJECT_ROOT))
            print(f"  [{i}/{len(pdfs)}] {rel}", end="", flush=True)
            row = analyze_pdf(pdf_path, company)
            label = row["label"]
            err   = f" ⚠️ {row['error']}" if row["error"] else ""
            print(f"  →  {label}{err}")
            rows.append(row)

        # 保存 CSV
        output_csv = RESULTS_DIR / f"{company}_pdf_classification.csv"
        save_csv(rows, output_csv)
        print(f"\n[{company}] CSV 已保存：{output_csv}")

        # 打印摘要
        print_summary(company, rows)

    print("完成。")


if __name__ == "__main__":
    main()
