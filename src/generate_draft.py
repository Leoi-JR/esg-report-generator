"""
generate_draft.py
=================
ESG 报告初稿生成脚本。

基于检索结果（retrieval_results.json）调用 LLM 生成各章节初稿。

阶段1 → 加载检索结果 + 质量过滤（max_score < 0.3 跳过）
阶段2 → 上下文准备（按 rank 编号，文本截断）
阶段3 → 并发调用 LLM 生成初稿
阶段4 → 输出 draft_results.json + draft_preview.md

运行方式：
    conda run -n esg python3 src/generate_draft.py

可选参数：
    --input PATH           检索结果文件（默认 data/processed/report_draft/retrieval_results.json）
    --output-dir PATH      输出目录（默认 data/processed/report_draft）
    --concurrency N        并发数（默认 6）
    --score-threshold F    跳过阈值（默认 0.3）
    --text-limit N         文本截断阈值（默认 2000）
    --limit N              仅处理前 N 个章节（调试用）
    --dry-run              仅准备上下文，不调用 LLM
    --debug                调试模式，遇错即停
    --resume               断点续跑（跳过已生成的章节）
"""

import argparse
import asyncio
import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx
from tqdm import tqdm

# 导入配置
from config import (
    DRAFT_LLM_BASE_URL,
    DRAFT_LLM_API_KEY,
    DRAFT_LLM_MODEL,
    DRAFT_CONCURRENCY,
    DRAFT_LLM_TIMEOUT,
    DRAFT_MAX_RETRIES,
    DRAFT_TEMPERATURE,
    DRAFT_MAX_TOKENS,
    DRAFT_SCORE_THRESHOLD,
    DRAFT_TEXT_LIMIT,
    DRAFT_OUTPUT_DIR,
)

# ==============================================================================
# 常量
# ==============================================================================

_HERE = Path(__file__).parent
PROMPTS_DIR = _HERE / "prompts"

DEFAULT_INPUT = Path(DRAFT_OUTPUT_DIR) / "retrieval_results.json"


# ==============================================================================
# 工具函数
# ==============================================================================

def print_header():
    """打印脚本头部信息。"""
    print("=" * 70)
    print("ESG 报告初稿生成")
    print("=" * 70)
    print(f"  LLM 服务: {DRAFT_LLM_BASE_URL}")
    print(f"  模型: {DRAFT_LLM_MODEL}")
    print(f"  并发数: {DRAFT_CONCURRENCY}")
    print(f"  跳过阈值: {DRAFT_SCORE_THRESHOLD}")
    print(f"  文本截断: {DRAFT_TEXT_LIMIT} 字")
    print("=" * 70)
    print()


def load_prompt(filename: str) -> str:
    """加载 prompt 模板文件。"""
    path = PROMPTS_DIR / filename
    if not path.exists():
        raise FileNotFoundError(f"Prompt 文件不存在: {path}")
    return path.read_text(encoding="utf-8")


def load_retrieval_results(input_path: Path) -> list[dict]:
    """加载检索结果 JSON。"""
    with open(input_path, "r", encoding="utf-8") as f:
        return json.load(f)


def truncate_text(chunk: dict, limit: int = 2000) -> str:
    """
    智能截断：parent_text 优先，超长则用 text。

    Args:
        chunk: chunk 记录
        limit: 字符数上限

    Returns:
        截断后的文本
    """
    parent_text = chunk.get("parent_text", "") or ""
    text = chunk.get("text", "") or ""

    # 优先使用 parent_text（更完整的上下文）
    if parent_text and len(parent_text) <= limit:
        return parent_text

    # parent_text 超长，使用 text
    if text and len(text) <= limit:
        return text

    # 都超长，截断 text
    if text:
        return text[:limit] + "..."

    # fallback
    return parent_text[:limit] + "..." if parent_text else ""


def prepare_context(
    top_chunks: list[dict],
    text_limit: int = 2000
) -> tuple[str, dict[str, dict]]:
    """
    准备 LLM 上下文。

    关键设计：来源编号 = rank，与原始 retrieval_results.json 完全对应。

    Args:
        top_chunks: retrieval_results 中的 top_chunks 列表
        text_limit: 单个 chunk 文本截断阈值

    Returns:
        context_text: 格式化的上下文字符串
        sources_mapping: {"1": {chunk_id, file_name, page, score}, ...}
    """
    lines = []
    sources_mapping = {}

    for chunk in top_chunks:
        rank = chunk.get("rank", 0)
        source_id = str(rank)

        # 提取元信息
        chunk_id = chunk.get("chunk_id", "unknown")
        file_name = chunk.get("file_name", "未知文件")
        page = chunk.get("page_or_sheet", "?")
        score = chunk.get("score", 0)

        # 智能截断
        text = truncate_text(chunk, text_limit)

        # 格式化单个来源
        lines.append(f"【来源{source_id}】{file_name} | 第{page}页 | 相关度: {score:.2f}")
        lines.append(text)
        lines.append("")  # 空行分隔

        # 记录映射
        sources_mapping[source_id] = {
            "chunk_id": chunk_id,
            "file_name": file_name,
            "page": str(page),
            "score": round(score, 4)
        }

    return "\n".join(lines), sources_mapping


def build_prompt(
    node: dict,
    context_text: str,
    sources_mapping: dict[str, dict]
) -> tuple[str, str]:
    """
    构建系统 prompt 和用户 prompt。

    Args:
        node: 叶节点信息
        context_text: 准备好的上下文
        sources_mapping: 来源映射

    Returns:
        (system_prompt, user_prompt)
    """
    system_prompt = load_prompt("draft_system.txt")
    user_template = load_prompt("draft_user.txt")

    # 生成可用来源编号列表
    available_sources = ", ".join(
        f"[来源{k}]" for k in sorted(sources_mapping.keys(), key=int)
    )

    user_prompt = user_template.format(
        full_path=node.get("full_path", ""),
        leaf_title=node.get("leaf_title", ""),
        gloss=node.get("gloss", ""),
        retrieval_query=node.get("retrieval_query", ""),
        context_text=context_text,
        available_sources=available_sources
    )

    return system_prompt, user_prompt


def count_words(text: str) -> int:
    """统计中文字数（不含空白和标点）。"""
    # 移除常见标点和空白
    cleaned = re.sub(r'[\s\[\]【】（）(),.，。、；;：:""''\"\'!！?？\-—\d]', '', text)
    return len(cleaned)


def extract_cited_sources(content: str) -> list[str]:
    """从生成内容中提取引用的来源编号。"""
    # 匹配 [来源1] [来源1,3] [来源1、2、3] 等格式
    pattern = r'\[来源([\d,、]+)\]'
    matches = re.findall(pattern, content)

    sources = set()
    for match in matches:
        # 分割逗号和顿号
        for part in re.split(r'[,、]', match):
            part = part.strip()
            if part.isdigit():
                sources.add(part)

    return sorted(sources, key=int)


# ==============================================================================
# LLM 调用
# ==============================================================================

async def call_llm_async(
    node: dict,
    semaphore: asyncio.Semaphore,
    client: httpx.AsyncClient,
    debug: bool = False
) -> dict:
    """
    异步调用 LLM，带重试。

    Args:
        node: 包含 system_prompt 和 user_prompt 的节点
        semaphore: 并发控制
        client: HTTP 客户端
        debug: 调试模式（遇错即停）

    Returns:
        {
            "content": str | None,
            "token_usage": {"prompt": int, "completion": int},
            "error": str | None
        }
    """
    async with semaphore:
        payload = {
            "model": DRAFT_LLM_MODEL,
            "messages": [
                {"role": "system", "content": node["system_prompt"]},
                {"role": "user", "content": node["user_prompt"]}
            ],
            "temperature": DRAFT_TEMPERATURE,
            "max_tokens": DRAFT_MAX_TOKENS
        }

        last_error = None
        for attempt in range(DRAFT_MAX_RETRIES):
            try:
                # DRAFT_LLM_BASE_URL 已包含 /v1，直接拼接 /chat/completions
                resp = await client.post(
                    f"{DRAFT_LLM_BASE_URL}/chat/completions",
                    json=payload,
                    headers={"Authorization": f"Bearer {DRAFT_LLM_API_KEY}"},
                    timeout=DRAFT_LLM_TIMEOUT
                )
                resp.raise_for_status()
                data = resp.json()

                content = data["choices"][0]["message"]["content"]
                usage = data.get("usage", {})

                return {
                    "content": content,
                    "token_usage": {
                        "prompt": usage.get("prompt_tokens", 0),
                        "completion": usage.get("completion_tokens", 0)
                    },
                    "error": None
                }

            except Exception as e:
                last_error = str(e)
                if debug:
                    raise
                if attempt < DRAFT_MAX_RETRIES - 1:
                    await asyncio.sleep(2 ** attempt)  # 指数退避

        return {
            "content": None,
            "token_usage": {"prompt": 0, "completion": 0},
            "error": last_error
        }


async def generate_drafts_batch(
    nodes: list[dict],
    concurrency: int = 6,
    debug: bool = False
) -> list[dict]:
    """
    并发生成所有节点的初稿。

    Args:
        nodes: 准备好的节点列表（含 system_prompt, user_prompt）
        concurrency: 并发数
        debug: 调试模式

    Returns:
        生成结果列表
    """
    semaphore = asyncio.Semaphore(concurrency)

    async with httpx.AsyncClient() as client:
        tasks = [
            call_llm_async(node, semaphore, client, debug)
            for node in nodes
        ]

        # 使用 tqdm 显示进度
        results = []
        for coro in tqdm(
            asyncio.as_completed(tasks),
            total=len(tasks),
            desc="生成初稿"
        ):
            result = await coro
            results.append(result)

        # 注意：as_completed 不保证顺序，需要重新对齐
        # 这里改用 gather 保持顺序

    # 重新运行以保持顺序
    async with httpx.AsyncClient() as client:
        tasks = [
            call_llm_async(node, semaphore, client, debug)
            for node in nodes
        ]
        results = []
        for i, coro in enumerate(tqdm(
            asyncio.as_completed(tasks),
            total=len(tasks),
            desc="生成初稿"
        )):
            results.append(await coro)

    # 使用 gather 保持顺序
    async with httpx.AsyncClient() as client:
        results = await asyncio.gather(*[
            call_llm_async(node, semaphore, client, debug)
            for node in nodes
        ])

    return results


async def generate_drafts_with_progress(
    nodes: list[dict],
    concurrency: int = 6,
    debug: bool = False
) -> list[dict]:
    """
    带进度条的并发生成。

    Args:
        nodes: 准备好的节点列表
        concurrency: 并发数
        debug: 调试模式

    Returns:
        生成结果列表（与输入顺序一致）
    """
    semaphore = asyncio.Semaphore(concurrency)
    results = [None] * len(nodes)

    async with httpx.AsyncClient() as client:
        async def process_with_index(idx: int, node: dict):
            result = await call_llm_async(node, semaphore, client, debug)
            results[idx] = result
            return idx

        tasks = [
            process_with_index(i, node)
            for i, node in enumerate(nodes)
        ]

        # 使用 tqdm 显示进度
        pbar = tqdm(total=len(tasks), desc="生成初稿")
        for coro in asyncio.as_completed(tasks):
            await coro
            pbar.update(1)
        pbar.close()

    return results


# ==============================================================================
# 输出
# ==============================================================================

def save_json_results(
    all_results: list[dict],
    config: dict,
    output_path: Path
):
    """保存完整 JSON 结果。"""
    # 统计
    generated = [r for r in all_results if r.get("status") == "generated"]
    skipped = [r for r in all_results if r.get("status") == "skipped"]
    errors = [r for r in all_results if r.get("status") == "error"]

    total_prompt_tokens = sum(
        r.get("draft", {}).get("token_usage", {}).get("prompt", 0)
        for r in generated
    )
    total_completion_tokens = sum(
        r.get("draft", {}).get("token_usage", {}).get("completion", 0)
        for r in generated
    )

    output = {
        "generated_at": datetime.now().isoformat(),
        "config": config,
        "summary": {
            "total": len(all_results),
            "generated": len(generated),
            "skipped": len(skipped),
            "error": len(errors),
            "total_tokens": {
                "prompt": total_prompt_tokens,
                "completion": total_completion_tokens
            }
        },
        "results": all_results
    }

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"  JSON 结果已保存: {output_path}")


def save_md_preview(all_results: list[dict], output_path: Path):
    """生成 Markdown 预览文件。"""
    lines = [
        "# ESG 报告初稿预览",
        "",
        f"生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M')}",
        "",
        "---",
        ""
    ]

    # 统计
    generated = len([r for r in all_results if r.get("status") == "generated"])
    skipped = len([r for r in all_results if r.get("status") == "skipped"])
    errors = len([r for r in all_results if r.get("status") == "error"])

    lines.extend([
        "## 统计",
        "",
        f"| 状态 | 数量 |",
        f"|------|------|",
        f"| ✅ 已生成 | {generated} |",
        f"| ⏭️ 跳过 | {skipped} |",
        f"| ❌ 错误 | {errors} |",
        "",
        "---",
        ""
    ])

    # 按章节输出
    for result in all_results:
        status = result.get("status", "unknown")
        full_path = result.get("full_path", "未知章节")

        if status == "generated":
            draft = result.get("draft", {})
            content = draft.get("content", "")
            word_count = draft.get("word_count", 0)
            sources_mapping = draft.get("sources_mapping", {})
            cited_sources = draft.get("cited_sources", [])

            lines.extend([
                f"## {full_path}",
                "",
                content,
                "",
                f"*字数：{word_count}，引用来源：{', '.join(f'[{s}]' for s in cited_sources) or '无'}*",
                "",
                "<details>",
                "<summary>来源信息</summary>",
                "",
                "| 编号 | 文件 | 页码 | 相关度 |",
                "|------|------|------|--------|",
            ])

            for src_id in sorted(sources_mapping.keys(), key=int):
                src_info = sources_mapping[src_id]
                cited_mark = "✓" if src_id in cited_sources else ""
                lines.append(
                    f"| {src_id}{cited_mark} | {src_info['file_name']} | "
                    f"{src_info['page']} | {src_info['score']:.2f} |"
                )

            lines.extend([
                "",
                "</details>",
                "",
                "---",
                ""
            ])

        elif status == "skipped":
            skip_reason = result.get("skip_reason", "未知原因")
            lines.extend([
                f"## {full_path}",
                "",
                f"⏭️ **跳过**：{skip_reason}",
                "",
                "---",
                ""
            ])

        elif status == "error":
            error_msg = result.get("error", "未知错误")
            lines.extend([
                f"## {full_path}",
                "",
                f"❌ **错误**：{error_msg}",
                "",
                "---",
                ""
            ])

    with open(output_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print(f"  Markdown 预览已保存: {output_path}")


def save_dry_run_output(prepared_nodes: list[dict], output_dir: Path):
    """Dry-run 模式：保存准备好的 prompt 供审阅。"""
    output_path = output_dir / "dry_run_prompts.json"

    # 只保留关键字段
    output = []
    for node in prepared_nodes:
        output.append({
            "id": node.get("id"),
            "full_path": node.get("full_path"),
            "status": node.get("status"),
            "skip_reason": node.get("skip_reason"),
            "context_text": node.get("context_text", "")[:500] + "..." if node.get("context_text") else None,
            "user_prompt_preview": node.get("user_prompt", "")[:1000] + "..." if node.get("user_prompt") else None,
            "sources_count": len(node.get("sources_mapping", {}))
        })

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"  Dry-run 输出已保存: {output_path}")


# ==============================================================================
# 主程序
# ==============================================================================

async def main_async(args):
    """异步主函数。"""
    print_header()

    # 配置
    config = {
        "model": DRAFT_LLM_MODEL,
        "text_limit": args.text_limit,
        "score_threshold": args.score_threshold,
        "concurrency": args.concurrency
    }

    # 阶段1: 加载检索结果
    print("阶段1: 加载检索结果...")
    input_path = Path(args.input)
    if not input_path.exists():
        print(f"  ❌ 文件不存在: {input_path}")
        return

    retrieval_results = load_retrieval_results(input_path)
    print(f"  共 {len(retrieval_results)} 个叶节点")

    # 限制数量（调试用）
    if args.limit:
        retrieval_results = retrieval_results[:args.limit]
        print(f"  限制处理前 {args.limit} 个")

    # 加载已有结果（断点续跑）
    existing_results = {}
    if args.resume:
        draft_path = Path(args.output_dir) / "draft_results.json"
        if draft_path.exists():
            with open(draft_path, "r", encoding="utf-8") as f:
                existing_data = json.load(f)
                for r in existing_data.get("results", []):
                    if r.get("status") == "generated":
                        existing_results[r["id"]] = r
            print(f"  已加载 {len(existing_results)} 个已生成结果")

    # 阶段2: 质量过滤 + 上下文准备
    print("\n阶段2: 质量过滤 + 上下文准备...")
    prepared_nodes = []
    skipped_nodes = []
    resumed_nodes = []

    for node in tqdm(retrieval_results, desc="准备上下文"):
        node_id = node.get("id")

        # 断点续跑：跳过已生成的
        if node_id in existing_results:
            resumed_nodes.append(existing_results[node_id])
            continue

        # 获取统计信息
        stats = node.get("stats", {})
        max_score = stats.get("max_score", 0)

        # 质量过滤
        if max_score < args.score_threshold:
            # 即使跳过，也生成 sources_mapping 用于 Web 端展示检索到的资料
            top_chunks = node.get("top_chunks", [])
            _, sources_mapping = prepare_context(top_chunks, args.text_limit)

            skipped_nodes.append({
                "id": node_id,
                "full_path": node.get("full_path", ""),
                "leaf_title": node.get("leaf_title", ""),
                "status": "skipped",
                "skip_reason": f"max_score ({max_score:.3f}) < {args.score_threshold}",
                "draft": {
                    "content": "",
                    "word_count": 0,
                    "cited_sources": [],
                    "sources_mapping": sources_mapping,
                },
                "context_summary": {
                    "chunks_provided": len(top_chunks),
                    "max_score": max_score,
                    "avg_score": stats.get("avg_score", 0)
                }
            })
            continue

        # 准备上下文
        top_chunks = node.get("top_chunks", [])
        context_text, sources_mapping = prepare_context(
            top_chunks,
            args.text_limit
        )

        # 构建 prompt
        system_prompt, user_prompt = build_prompt(node, context_text, sources_mapping)

        prepared_nodes.append({
            "id": node_id,
            "full_path": node.get("full_path", ""),
            "leaf_title": node.get("leaf_title", ""),
            "gloss": node.get("gloss", ""),
            "retrieval_query": node.get("retrieval_query", ""),
            "context_text": context_text,
            "sources_mapping": sources_mapping,
            "system_prompt": system_prompt,
            "user_prompt": user_prompt,
            "context_summary": {
                "chunks_provided": len(top_chunks),
                "max_score": max_score,
                "avg_score": stats.get("avg_score", 0)
            }
        })

    print(f"  待生成: {len(prepared_nodes)}, 跳过: {len(skipped_nodes)}, 续跑: {len(resumed_nodes)}")

    # Dry-run 模式
    if args.dry_run:
        output_dir = Path(args.output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        save_dry_run_output(prepared_nodes + skipped_nodes, output_dir)
        print("\n✅ Dry-run 完成")
        return

    # 阶段3: 并发调用 LLM
    print(f"\n阶段3: 调用 LLM (并发={args.concurrency})...")

    if prepared_nodes:
        start_time = time.time()
        llm_results = await generate_drafts_with_progress(
            prepared_nodes,
            concurrency=args.concurrency,
            debug=args.debug
        )
        elapsed = time.time() - start_time
        print(f"  耗时: {elapsed:.1f}s ({elapsed/len(prepared_nodes):.1f}s/章节)")
    else:
        llm_results = []
        print("  无需生成")

    # 处理结果
    generated_nodes = []
    error_nodes = []

    for node, llm_result in zip(prepared_nodes, llm_results):
        if llm_result.get("error"):
            error_nodes.append({
                "id": node["id"],
                "full_path": node["full_path"],
                "leaf_title": node["leaf_title"],
                "status": "error",
                "error": llm_result["error"],
                "context_summary": node["context_summary"]
            })
        else:
            content = llm_result["content"] or ""
            word_count = count_words(content)
            cited_sources = extract_cited_sources(content)

            generated_nodes.append({
                "id": node["id"],
                "full_path": node["full_path"],
                "leaf_title": node["leaf_title"],
                "status": "generated",
                "skip_reason": None,
                "draft": {
                    "content": content,
                    "word_count": word_count,
                    "cited_sources": cited_sources,
                    "sources_mapping": node["sources_mapping"],
                    "token_usage": llm_result["token_usage"]
                },
                "context_summary": node["context_summary"]
            })

    # 合并所有结果
    all_results = resumed_nodes + generated_nodes + skipped_nodes + error_nodes
    all_results.sort(key=lambda x: x.get("id", ""))

    # 阶段4: 保存结果
    print("\n阶段4: 保存结果...")
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    save_json_results(all_results, config, output_dir / "draft_results.json")
    save_md_preview(all_results, output_dir / "draft_preview.md")

    # 统计
    print("\n" + "=" * 70)
    print("完成统计")
    print("=" * 70)
    print(f"  ✅ 已生成: {len(generated_nodes) + len(resumed_nodes)}")
    print(f"  ⏭️ 跳过: {len(skipped_nodes)}")
    print(f"  ❌ 错误: {len(error_nodes)}")

    if generated_nodes:
        total_words = sum(r["draft"]["word_count"] for r in generated_nodes)
        avg_words = total_words / len(generated_nodes)
        print(f"  📝 本次生成总字数: {total_words}, 平均: {avg_words:.0f} 字/章节")


def main():
    """命令行入口。"""
    parser = argparse.ArgumentParser(
        description="ESG 报告初稿生成",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )

    parser.add_argument(
        "--input",
        default=str(DEFAULT_INPUT),
        help=f"检索结果文件 (默认: {DEFAULT_INPUT})"
    )
    parser.add_argument(
        "--output-dir",
        default=DRAFT_OUTPUT_DIR,
        help=f"输出目录 (默认: {DRAFT_OUTPUT_DIR})"
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=DRAFT_CONCURRENCY,
        help=f"并发数 (默认: {DRAFT_CONCURRENCY})"
    )
    parser.add_argument(
        "--score-threshold",
        type=float,
        default=DRAFT_SCORE_THRESHOLD,
        help=f"跳过阈值 (默认: {DRAFT_SCORE_THRESHOLD})"
    )
    parser.add_argument(
        "--text-limit",
        type=int,
        default=DRAFT_TEXT_LIMIT,
        help=f"文本截断阈值 (默认: {DRAFT_TEXT_LIMIT})"
    )
    parser.add_argument(
        "--limit",
        type=int,
        help="仅处理前 N 个章节（调试用）"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="仅准备上下文，不调用 LLM"
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="调试模式，遇错即停"
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="断点续跑（跳过已生成的章节）"
    )

    args = parser.parse_args()

    # 运行异步主函数
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
