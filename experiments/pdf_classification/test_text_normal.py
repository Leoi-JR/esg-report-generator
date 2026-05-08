"""
test_text_normal.py
===================
text_normal 类 PDF 提取结果的测试脚本。

功能：
  1. 从 labeled/艾森股份_2025/text_normal/ 和 labeled/泓淋电力_2025/text_normal/
     各取若干 PDF 运行提取
  2. 对每个 PDF 打印：
     - sections 数量、chunks 数量
     - chunk 字符数分布（min/avg/max）
     - 是否存在表格 chunk
  3. 每个 PDF 单独生成一个可读 Markdown 文件（results/md/{stem}.md），
     按 section 分组展示全量文本，方便与 PDF 原文对比
  4. 将所有结果保存为 results/text_normal_extraction_test.json（供脚本读取）

输出：
  results/md/{文件名}.md          ← 每个 PDF 一个，人工对比用
  results/text_normal_extraction_test.json  ← 全量数据，脚本读取用

运行方式（在项目根目录）：
  conda run -n esg python3 experiments/pdf_classification/test_text_normal.py
  conda run -n esg python3 experiments/pdf_classification/test_text_normal.py --limit 3
  conda run -n esg python3 experiments/pdf_classification/test_text_normal.py --company 艾森股份_2025 --limit 5
  conda run -n esg python3 experiments/pdf_classification/test_text_normal.py --file path/to/file.pdf
"""

import argparse
import json
import sys
from pathlib import Path

SCRIPT_DIR   = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent

# 将实验目录加入 sys.path，使 extract_text_normal 可被直接导入
sys.path.insert(0, str(SCRIPT_DIR))
from extract_text_normal import extract_text_normal_pdf

LABELED_DIR  = SCRIPT_DIR / "labeled"
RESULTS_DIR  = SCRIPT_DIR / "results"
MD_DIR       = RESULTS_DIR / "md"
COMPANIES    = ["艾森股份_2025", "泓淋电力_2025", "国际复材_2025"]


# ── 工具函数 ────────────────────────────────────────────────────────────────────

def collect_pdfs(company: str, limit: int | None) -> list[Path]:
    """收集 labeled/{company}/text_normal/ 下的 PDF。"""
    label_dir = LABELED_DIR / company / "text_normal"
    if not label_dir.exists():
        print(f"[WARN] 目录不存在：{label_dir}")
        return []
    pdfs = sorted(label_dir.glob("*.pdf"))
    if limit:
        pdfs = pdfs[:limit]
    return pdfs


def build_file_record(pdf_path: Path) -> dict:
    """从 PDF 路径构造 file_record。"""
    rel_path = str(pdf_path.relative_to(PROJECT_ROOT))
    return {
        "file_path":     str(pdf_path),
        "file_name":     pdf_path.name,
        "relative_path": rel_path,
        "folder_code":   None,
    }


def analyze_result(result: dict) -> dict:
    """对提取结果做统计分析，返回摘要 dict。"""
    chunks   = result.get("chunks", [])
    parents  = result.get("parents", {})

    if not chunks:
        return {
            "sections_count": len(parents),
            "chunks_count":   0,
            "table_chunks":   0,
            "char_min":       0,
            "char_avg":       0.0,
            "char_max":       0,
        }

    char_counts   = [c.get("char_count", 0) for c in chunks]
    table_chunks  = sum(1 for c in chunks if c.get("is_table"))

    return {
        "sections_count": len(parents),
        "chunks_count":   len(chunks),
        "table_chunks":   table_chunks,
        "char_min":       min(char_counts),
        "char_avg":       round(sum(char_counts) / len(char_counts), 1),
        "char_max":       max(char_counts),
    }


def print_detail(pdf_path: Path, summary: dict) -> None:
    """控制台一行摘要输出。"""
    print(
        f"  sections={summary['sections_count']}  chunks={summary['chunks_count']}"
        f"  表格={summary['table_chunks']}"
        f"  字符 min={summary['char_min']} avg={summary['char_avg']} max={summary['char_max']}"
    )
    if summary['chunks_count'] == 0:
        print("  ⚠️  无有效 chunk")


def write_markdown(pdf_path: Path, result: dict, summary: dict) -> Path:
    """
    将提取结果写成可读 Markdown 文件，每个 PDF 单独一个文件。

    格式结构：
      # 文件名
      > 统计摘要（sections / chunks / 字符数）

      ---
      ## Section 1  [section_id]  · 第 N 页
      > chunk 数量 / 含表格

      ### Chunk 1  [正文]  · 第 N 页  · 123 字
      正文内容……

      ### Chunk 2  [表格]  · 第 N 页  · 456 字
      | 表头 | … |
      |------|---|
      | 数据 | … |

      ---
      ## Section 2  …
    """
    chunks  = result.get("chunks", [])
    parents = result.get("parents", {})

    lines: list[str] = []

    # ── 文件头 ────────────────────────────────────────────────────────────────
    lines.append(f"# {pdf_path.stem}")
    lines.append("")
    lines.append("> **来源**：`{}`".format(pdf_path.name))
    lines.append(">")
    lines.append(
        f"> sections: **{summary['sections_count']}**　"
        f"chunks: **{summary['chunks_count']}**　"
        f"表格 chunks: **{summary['table_chunks']}**"
    )
    lines.append(
        f"> 字符数 min={summary['char_min']}　"
        f"avg={summary['char_avg']}　"
        f"max={summary['char_max']}"
    )
    lines.append("")

    if not chunks:
        lines.append("> ⚠️ 无有效 chunk，请检查 PDF 是否真为 text_normal 类型。")
        return _flush_md(pdf_path, lines)

    # ── 按 section 分组 ───────────────────────────────────────────────────────
    # 先建立 parent_id → chunks 的映射，保持 chunk 原始顺序
    from collections import defaultdict
    section_chunks: dict[str, list] = defaultdict(list)
    for chunk in chunks:
        section_chunks[chunk["parent_id"]].append(chunk)

    for sec_idx, (parent_id, parent_text) in enumerate(parents.items(), 1):
        sec_chunks  = section_chunks.get(parent_id, [])
        section_id  = parent_id.split("#")[-1]
        first_page  = sec_chunks[0]["page_or_sheet"] if sec_chunks else "?"
        table_count = sum(1 for c in sec_chunks if c.get("is_table"))

        lines.append("---")
        lines.append("")
        lines.append(
            f"## Section {sec_idx}　`{section_id}`　· 第 {first_page} 页"
        )
        lines.append("")
        meta_parts = [f"{len(sec_chunks)} 个 chunk"]
        if table_count:
            meta_parts.append(f"含 {table_count} 个表格")
        lines.append(f"> {' / '.join(meta_parts)}")
        lines.append("")

        for chunk_idx, chunk in enumerate(sec_chunks, 1):
            tag  = "表格" if chunk.get("is_table") else "正文"
            page = chunk["page_or_sheet"]
            cc   = chunk["char_count"]
            cid  = chunk["chunk_id"].split("#")[-1]   # 只取末段，保持简洁

            lines.append(
                f"### Chunk {chunk_idx}　`{cid}`　[{tag}]　· 第 {page} 页　· {cc} 字"
            )
            lines.append("")
            lines.append(chunk["text"])
            lines.append("")

    return _flush_md(pdf_path, lines)


def _flush_md(pdf_path: Path, lines: list[str]) -> Path:
    """将 lines 写入 MD_DIR/{stem}.md，返回输出路径。"""
    MD_DIR.mkdir(parents=True, exist_ok=True)
    out_path = MD_DIR / f"{pdf_path.stem}.md"
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    return out_path


def run_single(pdf_path: Path, all_results: list, verbose: bool = True) -> dict:
    """对单个 PDF 运行提取，写出 MD，返回摘要，并将详情追加到 all_results。"""
    file_record = build_file_record(pdf_path)
    result      = extract_text_normal_pdf(file_record)
    summary     = analyze_result(result)

    # ── 写 Markdown（全量文本，不截断） ───────────────────────────────────────
    md_path = write_markdown(pdf_path, result, summary)

    # ── 写 JSON（text 截断为前 200 字，避免文件过大） ─────────────────────────
    serializable_chunks = []
    for c in result.get("chunks", []):
        entry = {k: v for k, v in c.items() if k not in ("table_html",)}
        entry["text"] = c["text"][:200] + ("…" if len(c["text"]) > 200 else "")
        serializable_chunks.append(entry)

    all_results.append({
        "file_name": pdf_path.name,
        "file_path": str(pdf_path.relative_to(PROJECT_ROOT)),
        "md_path":   str(md_path.relative_to(PROJECT_ROOT)),
        "summary":   summary,
        "chunks":    serializable_chunks,
    })

    if verbose:
        name_col = (pdf_path.stem[:44] + "…") if len(pdf_path.stem) > 45 else pdf_path.stem
        md_rel   = str(md_path.relative_to(PROJECT_ROOT))
        print(
            f"  {name_col:<45} "
            f"{summary['sections_count']:>4} "
            f"{summary['chunks_count']:>4} "
            f"{summary['table_chunks']:>4} "
            f"{summary['char_avg']:>7}  "
            f"{md_rel}"
        )

    return summary


# ── 主流程 ───────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="text_normal PDF 提取测试")
    parser.add_argument("--limit",   type=int, default=5,
                        help="每个企业最多测试 N 个 PDF（默认 5）")
    parser.add_argument("--company", type=str, default=None,
                        help=f"只测试指定企业，可选：{COMPANIES}")
    parser.add_argument("--file",    type=str, default=None,
                        help="直接指定单个 PDF 路径（绝对或相对于项目根目录）")
    args = parser.parse_args()

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    MD_DIR.mkdir(parents=True, exist_ok=True)
    all_results: list = []

    # ── 模式一：直接指定单个文件 ──────────────────────────────────────────────
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

    # ── 模式二：批量测试 ────────────────────────────────────────────────────────
    targets = [args.company] if args.company else COMPANIES
    for company in targets:
        if company not in COMPANIES:
            print(f"[ERROR] 未知企业：{company}")
            continue

        pdfs = collect_pdfs(company, args.limit)
        if not pdfs:
            continue

        print(f"\n{'='*70}")
        print(f"  {company}  测试 {len(pdfs)} 个 text_normal PDF")
        print(f"{'='*70}")
        print(f"  {'文件名':<45} {'sec':>4} {'chk':>4} {'表格':>4} {'avg字符':>7}  md 输出")

        summaries = []
        for i, pdf_path in enumerate(pdfs, 1):
            summary = run_single(pdf_path, all_results)
            summaries.append(summary)

        # 企业汇总
        if summaries:
            avg_sections = sum(s["sections_count"] for s in summaries) / len(summaries)
            avg_chunks   = sum(s["chunks_count"]   for s in summaries) / len(summaries)
            avg_char     = sum(s["char_avg"]        for s in summaries) / len(summaries)
            table_files  = sum(1 for s in summaries if s["table_chunks"] > 0)
            print(f"\n\n  【{company} 汇总】")
            print(f"  平均 sections : {avg_sections:.1f}")
            print(f"  平均 chunks   : {avg_chunks:.1f}")
            print(f"  平均 chunk 字符数 : {avg_char:.1f}")
            print(f"  含表格的文件  : {table_files}/{len(summaries)}")

    _save_results(all_results)


def _save_results(all_results: list) -> None:
    out_path = RESULTS_DIR / "text_normal_extraction_test.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(all_results, f, ensure_ascii=False, indent=2)
    print(f"\n\n结果已保存：{out_path.relative_to(PROJECT_ROOT)}")
    print("完成。")


if __name__ == "__main__":
    main()
