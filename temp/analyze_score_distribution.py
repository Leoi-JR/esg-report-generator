"""
analyze_score_distribution.py
=============================
分析两个项目中 119 个章节的 Reranker max_score 分布，
输出统计表和直方图，辅助确定质量过滤阈值。

使用方式：
    conda run -n esg python3 temp/analyze_score_distribution.py

输出：
    temp/score_distribution.png
"""

import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

# ── 配置 ─────────────────────────────────────────────────────────────────────

ROOT = Path(__file__).resolve().parent.parent
PROJECTS_DIR = ROOT / "projects"
OUTPUT_PNG = ROOT / "temp" / "score_distribution.png"

CURRENT_THRESHOLD = 0.25  # 当前阈值


# ── 数据加载 ──────────────────────────────────────────────────────────────────

def load_project_scores(project_dir: Path) -> list[dict]:
    """从 retrieval_results.json 加载每个章节的 max_score。"""
    path = project_dir / "processed" / "report_draft" / "retrieval_results.json"
    if not path.exists():
        print(f"  ⚠ 未找到: {path}")
        return []
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    entries = []
    for item in data:
        stats = item.get("stats", {})
        entries.append({
            "id": item.get("id", ""),
            "full_path": item.get("full_path", ""),
            "max_score": stats.get("max_score", 0),
            "avg_score": stats.get("avg_score", 0),
            "chunk_count": stats.get("chunk_count", 0),
        })
    return entries


def print_statistics(name: str, scores: list[float]) -> None:
    """打印统计摘要。"""
    arr = np.array(scores)
    print(f"\n{'=' * 50}")
    print(f"  项目: {name}")
    print(f"{'=' * 50}")
    print(f"  总章节数: {len(arr)}")
    print(f"  最小值:   {arr.min():.4f}")
    print(f"  最大值:   {arr.max():.4f}")
    print(f"  均值:     {arr.mean():.4f}")
    print(f"  中位数:   {np.median(arr):.4f}")
    print(f"  标准差:   {arr.std():.4f}")
    print()
    percentiles = [10, 25, 50, 75, 90]
    for p in percentiles:
        print(f"  P{p:2d}: {np.percentile(arr, p):.4f}")
    print()
    # 分段统计
    bins = [(0.0, 0.35), (0.35, 0.40), (0.40, 0.45), (0.45, 0.50),
            (0.50, 0.55), (0.55, 0.60), (0.60, 0.65), (0.65, 0.70),
            (0.70, 0.80), (0.80, 1.00)]
    for lo, hi in bins:
        count = int(np.sum((arr >= lo) & (arr < hi)))
        if count > 0:
            bar = "█" * count
            print(f"  [{lo:.2f}, {hi:.2f}): {count:3d}  {bar}")


# ── 绘图 ─────────────────────────────────────────────────────────────────────

def plot_distribution(projects: dict[str, list[float]]) -> None:
    """并排绘制多个项目的 max_score 直方图。"""
    n = len(projects)
    fig, axes = plt.subplots(1, n, figsize=(7 * n, 5), sharey=True)
    if n == 1:
        axes = [axes]

    colors = ["#4F86C6", "#E07A5F"]
    bins_edges = np.arange(0.35, 0.90, 0.025)

    for idx, (name, scores) in enumerate(projects.items()):
        ax = axes[idx]
        arr = np.array(scores)
        ax.hist(arr, bins=bins_edges, color=colors[idx % len(colors)],
                edgecolor="white", linewidth=0.8, alpha=0.85)

        # 当前阈值线
        ax.axvline(CURRENT_THRESHOLD, color="#999999", linestyle="--",
                   linewidth=1.2, label=f"当前阈值 ({CURRENT_THRESHOLD})")

        # 建议阈值线（mean - 1.5 * std 或 P10，取较大者）
        suggested = max(np.percentile(arr, 10), arr.mean() - 1.5 * arr.std())
        suggested = round(suggested / 0.05) * 0.05  # 对齐到 0.05 的倍数
        ax.axvline(suggested, color="#E63946", linestyle="-",
                   linewidth=1.5, label=f"建议阈值 ({suggested:.2f})")

        # 标注
        ax.set_title(name, fontsize=13, fontweight="bold")
        ax.set_xlabel("max_score (Reranker 精排)", fontsize=10)
        if idx == 0:
            ax.set_ylabel("章节数", fontsize=10)
        ax.legend(fontsize=9, loc="upper right")
        ax.grid(axis="y", alpha=0.3)

        # 统计注释
        stats_text = (f"n={len(arr)}\n"
                      f"min={arr.min():.3f}\n"
                      f"mean={arr.mean():.3f}\n"
                      f"median={np.median(arr):.3f}\n"
                      f"max={arr.max():.3f}")
        ax.text(0.02, 0.97, stats_text, transform=ax.transAxes,
                fontsize=8, verticalalignment="top",
                fontfamily="monospace",
                bbox=dict(boxstyle="round,pad=0.4", facecolor="white", alpha=0.8))

    fig.suptitle("ESG 报告章节 Reranker max_score 分布", fontsize=15, fontweight="bold", y=1.02)
    fig.tight_layout()
    fig.savefig(OUTPUT_PNG, dpi=150, bbox_inches="tight")
    print(f"\n✅ 图表已保存: {OUTPUT_PNG}")


# ── 主入口 ────────────────────────────────────────────────────────────────────

def main():
    print("扫描项目目录...")
    projects: dict[str, list[float]] = {}

    for project_dir in sorted(PROJECTS_DIR.iterdir()):
        if not project_dir.is_dir():
            continue
        name = project_dir.name
        print(f"\n加载项目: {name}")
        entries = load_project_scores(project_dir)
        if not entries:
            continue
        scores = [e["max_score"] for e in entries]
        projects[name] = scores
        print_statistics(name, scores)

    if not projects:
        print("❌ 未找到任何项目的检索结果")
        return

    # 绘图
    plot_distribution(projects)

    # 给出建议
    print("\n" + "=" * 50)
    print("  建议")
    print("=" * 50)
    all_scores = []
    for scores in projects.values():
        all_scores.extend(scores)
    arr = np.array(all_scores)
    suggested = max(np.percentile(arr, 10), arr.mean() - 1.5 * arr.std())
    suggested = round(suggested / 0.05) * 0.05
    print(f"  当前阈值: {CURRENT_THRESHOLD}")
    print(f"  建议阈值: {suggested:.2f}")
    below = int(np.sum(arr < suggested))
    print(f"  低于建议阈值的章节数: {below} / {len(arr)}")
    print()


if __name__ == "__main__":
    main()
