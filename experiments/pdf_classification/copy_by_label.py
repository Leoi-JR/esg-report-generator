"""
copy_by_label.py
================
根据 classify_pdfs.py 生成的 CSV 分类结果，将 PDF **复制**到按标签组织的文件夹中。

输出目录结构：
  experiments/pdf_classification/labeled/
  ├── 艾森股份_2025/
  │   ├── text_normal/
  │   ├── scanned/
  │   ├── mixed_scan/
  │   ├── ppt_pdf/
  │   ├── image_heavy/
  │   └── empty/
  └── 泓淋电力_2025/
      ├── text_normal/
      ├── scanned/
      └── ...

注意：
  - 源文件是原始 PDF，只做**复制**，不移动，不修改原始资料
  - 若同名文件已存在于目标目录，则跳过（不覆盖）
  - 若不同源路径的文件同名，自动追加序号后缀（_1, _2 ...）

运行方式（在项目根目录）：
  conda run -n esg python3 experiments/pdf_classification/copy_by_label.py
  conda run -n esg python3 experiments/pdf_classification/copy_by_label.py --dry-run   # 只打印，不实际复制
  conda run -n esg python3 experiments/pdf_classification/copy_by_label.py --company 艾森股份_2025
"""

import argparse
import csv
import shutil
import sys
from collections import defaultdict
from pathlib import Path

# ── 路径配置 ────────────────────────────────────────────────────────────────
SCRIPT_DIR   = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent

RESULTS_DIR = SCRIPT_DIR / "results"
LABELED_DIR = SCRIPT_DIR / "labeled"

COMPANIES = ["艾森股份_2025", "泓淋电力_2025", "国际复材_2025"]

ALL_LABELS = ["text_normal", "scanned", "mixed_scan", "ppt_pdf", "image_heavy", "empty", "error"]

LABEL_NAMES = {
    "text_normal":  "普通文字 PDF",
    "scanned":      "扫描件",
    "mixed_scan":   "混合扫描件",
    "ppt_pdf":      "PPT 转 PDF",
    "image_heavy":  "图片主体",
    "empty":        "空文件",
    "error":        "处理出错",
}


def load_csv(company: str) -> list[dict]:
    csv_path = RESULTS_DIR / f"{company}_pdf_classification.csv"
    if not csv_path.exists():
        print(f"[WARN] 找不到分类结果文件：{csv_path}")
        return []
    rows = []
    with open(csv_path, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            rows.append(row)
    return rows


def resolve_dest(dest_dir: Path, file_name: str, used_names: set[str]) -> Path:
    """解决同名冲突：若目标文件名已被使用，追加 _1, _2 ... 后缀。"""
    stem   = Path(file_name).stem
    suffix = Path(file_name).suffix
    candidate = file_name
    counter = 1
    while candidate in used_names:
        candidate = f"{stem}_{counter}{suffix}"
        counter += 1
    used_names.add(candidate)
    return dest_dir / candidate


def process_company(company: str, dry_run: bool) -> dict:
    rows = load_csv(company)
    if not rows:
        return {}

    stats: dict[str, int] = defaultdict(int)
    # 每个 label 子目录下已使用的文件名集合（避免同名覆盖）
    used_names: dict[str, set[str]] = defaultdict(set)

    for row in rows:
        label     = row.get("label", "error") or "error"
        file_path = row.get("file_path", "")
        file_name = row.get("file_name", "")

        src = PROJECT_ROOT / file_path
        if not src.exists():
            print(f"  [WARN] 源文件不存在，跳过：{src}")
            stats["missing"] += 1
            continue

        dest_dir = LABELED_DIR / company / label
        dest     = resolve_dest(dest_dir, file_name, used_names[label])

        if not dry_run:
            dest_dir.mkdir(parents=True, exist_ok=True)
            if dest.exists():
                # 理论上 resolve_dest 已避免重名，但防御性检查
                print(f"  [SKIP] 已存在：{dest.relative_to(PROJECT_ROOT)}")
                stats["skipped"] += 1
                continue
            shutil.copy2(src, dest)

        rel_dest = dest.relative_to(PROJECT_ROOT)
        print(f"  {'[DRY]' if dry_run else '[OK] '} {file_name}  →  {rel_dest}")
        stats[label] += 1

    return dict(stats)


def print_summary(company: str, stats: dict) -> None:
    total = sum(v for k, v in stats.items() if k not in ("missing", "skipped"))
    print(f"\n{'='*60}")
    print(f"  {company}  复制完成")
    print(f"{'='*60}")
    for label in ALL_LABELS:
        cnt = stats.get(label, 0)
        if cnt:
            name = LABEL_NAMES.get(label, label)
            print(f"  {name:<16} ({label:<12}) : {cnt:>4} 个")
    if stats.get("missing"):
        print(f"  ⚠️  源文件缺失：{stats['missing']} 个")
    if stats.get("skipped"):
        print(f"  ⚠️  已跳过（已存在）：{stats['skipped']} 个")
    print(f"  合计复制：{total} 个")
    print()


def main() -> None:
    parser = argparse.ArgumentParser(description="按标签将 PDF 复制到分类文件夹")
    parser.add_argument(
        "--dry-run", action="store_true",
        help="只打印操作，不实际复制文件"
    )
    parser.add_argument(
        "--company", type=str, default=None,
        help=f"只处理指定企业，可选值：{COMPANIES}"
    )
    args = parser.parse_args()

    if args.company:
        if args.company not in COMPANIES:
            print(f"[ERROR] 未知企业: {args.company}，可选值：{COMPANIES}")
            sys.exit(1)
        targets = [args.company]
    else:
        targets = COMPANIES

    if args.dry_run:
        print("[DRY-RUN 模式] 不会实际复制任何文件\n")

    for company in targets:
        print(f"\n[{company}] 开始{'（dry-run）' if args.dry_run else ''}...")
        stats = process_company(company, dry_run=args.dry_run)
        print_summary(company, stats)

    if not args.dry_run:
        print(f"输出目录：{LABELED_DIR}")

    print("完成。")


if __name__ == "__main__":
    main()
