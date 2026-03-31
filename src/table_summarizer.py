"""
table_summarizer.py
===================
Phase 2 表格摘要生成模块。

功能：
  - 为表格 chunk 批量生成 LLM 自然语言摘要
  - 基于内容 SHA256 去重，避免重复调用 LLM
  - 异步并发调用，支持重试和错误处理

使用：
  from table_summarizer import generate_table_summaries
  chunks = await generate_table_summaries(chunks, parents)

数据流：
  1. 筛选 is_table=True 的 chunks
  2. 对每个表格 chunk:
     - 获取 parent_text → 提取前后 300 字上下文
     - 调用 LLM 生成 table_summary
     - 更新 text = "[表格摘要]\\n{摘要}\\n\\n[表格数据]\\n{Markdown}"
  3. 保存摘要缓存（按内容 SHA256 去重）
"""

import asyncio
import hashlib
import json
from pathlib import Path
from typing import Optional

from openai import AsyncOpenAI
from tqdm import tqdm

from config import (
    DRAFT_LLM_BASE_URL,
    DRAFT_LLM_API_KEY,
    DRAFT_LLM_MODEL,
    DRAFT_MAX_RETRIES,
    TABLE_CONTEXT_CHARS,
    TABLE_SUMMARY_CACHE_PATH,
    TABLE_SUMMARY_CONCURRENCY,
    ENABLE_TABLE_SUMMARY,
)


# ==============================================================================
# 辅助函数：上下文提取
# ==============================================================================

def get_table_summary_context(
    chunk: dict,
    parent_text: str,
    context_chars: int = TABLE_CONTEXT_CHARS
) -> dict:
    """
    获取表格摘要生成所需的上下文。

    从 parent_text（Markdown 格式）中提取表格前后的正文。

    参数:
        chunk: 表格 chunk 记录
        parent_text: 完整的 section 文本（Markdown 格式）
        context_chars: 前后各取多少字符

    返回:
        {"before": str, "after": str}
    """
    table_markdown = chunk.get("table_markdown", "")

    if not table_markdown or not parent_text:
        return {"before": "", "after": ""}

    # 在 parent_text 中定位表格
    pos = parent_text.find(table_markdown)
    if pos == -1:
        # 尝试模糊匹配（表格前几行）
        lines = table_markdown.split("\n")
        first_lines = "\n".join(lines[:min(3, len(lines))])
        if first_lines:
            pos = parent_text.find(first_lines)

    if pos == -1:
        return {"before": "", "after": ""}

    # 提取前后文本
    before = parent_text[:pos].strip()
    after = parent_text[pos + len(table_markdown):].strip()

    # 截取指定长度
    before = before[-context_chars:] if len(before) > context_chars else before
    after = after[:context_chars] if len(after) > context_chars else after

    return {"before": before, "after": after}


# ==============================================================================
# 核心类：TableSummarizer
# ==============================================================================

class TableSummarizer:
    """
    表格摘要生成器。

    特性：
    - 异步并发调用 LLM
    - SHA256 内容去重缓存
    - 失败重试（3 次，指数退避）
    """

    def __init__(self, cache_path: Optional[str] = None):
        """
        初始化摘要生成器。

        参数:
            cache_path: 缓存文件路径（None 则不缓存）
        """
        self.client = AsyncOpenAI(
            base_url=DRAFT_LLM_BASE_URL,
            api_key=DRAFT_LLM_API_KEY,
        )
        self.cache_path = cache_path
        self.cache = self._load_cache() if cache_path else {}
        self.prompt_template = self._load_prompt()
        self._cache_hits = 0
        self._api_calls = 0

    def _load_cache(self) -> dict:
        """加载缓存文件"""
        if self.cache_path and Path(self.cache_path).exists():
            try:
                with open(self.cache_path, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except (json.JSONDecodeError, IOError) as e:
                print(f"  [警告] 加载缓存失败: {e}")
        return {}

    def _save_cache(self):
        """保存缓存文件"""
        if self.cache_path:
            try:
                Path(self.cache_path).parent.mkdir(parents=True, exist_ok=True)
                with open(self.cache_path, 'w', encoding='utf-8') as f:
                    json.dump(self.cache, f, ensure_ascii=False, indent=2)
            except IOError as e:
                print(f"  [警告] 保存缓存失败: {e}")

    def _load_prompt(self) -> str:
        """加载 Prompt 模板"""
        prompt_path = Path(__file__).parent / "prompts" / "table_summary.txt"
        if prompt_path.exists():
            return prompt_path.read_text(encoding='utf-8')
        return self._default_prompt()

    def _default_prompt(self) -> str:
        """默认 Prompt（备用）"""
        return """你是一个专业的文档分析师。请为以下表格生成简洁的自然语言摘要。

## 表格内容
{table_markdown}

## 上下文信息
- 文件名：{file_name}
- 所属章节：{section_title}
- 表格前文本：{context_before}
- 表格后文本：{context_after}

## 输出要求
1. 说明这是什么类型的表格
2. 提取 3-5 个关键数据点
3. 总字数控制在 100-300 字
4. 使用自然流畅的中文表述

## 输出格式
直接输出摘要文本，不要添加任何前缀或标记。
"""

    def _compute_cache_key(self, table_markdown: str, context: dict) -> str:
        """
        计算缓存 key（基于内容 SHA256）。

        相同表格 + 相同上下文 → 相同 key → 复用缓存
        """
        content = table_markdown + context.get("before", "") + context.get("after", "")
        return hashlib.sha256(content.encode('utf-8')).hexdigest()[:16]

    async def summarize_batch(
        self,
        table_chunks: list,
        parents: dict,
        concurrency: int = TABLE_SUMMARY_CONCURRENCY
    ) -> dict:
        """
        批量生成表格摘要（并发处理）。

        参数:
            table_chunks: 表格 chunk 列表
            parents: {parent_id: parent_text} 字典
            concurrency: 并发数

        返回:
            {chunk_id: summary} 字典
        """
        semaphore = asyncio.Semaphore(concurrency)
        summaries = {}

        # 预处理：计算缓存 key，分离缓存命中和需要调用 API 的
        tasks_to_run = []
        for chunk in table_chunks:
            chunk_id = chunk.get("chunk_id", "")
            parent_text = parents.get(chunk.get("parent_id", ""), "")
            context = get_table_summary_context(chunk, parent_text)
            cache_key = self._compute_cache_key(
                chunk.get("table_markdown", ""), context
            )

            # 检查缓存
            if cache_key in self.cache:
                summaries[chunk_id] = self.cache[cache_key]
                self._cache_hits += 1
            else:
                tasks_to_run.append((chunk, context, cache_key))

        if self._cache_hits > 0:
            print(f"  缓存命中 {self._cache_hits} 个，需调用 API {len(tasks_to_run)} 个")

        if not tasks_to_run:
            return summaries

        # 异步并发处理
        async def process_one(chunk: dict, context: dict, cache_key: str):
            async with semaphore:
                chunk_id = chunk.get("chunk_id", "")
                summary = await self._summarize_single(chunk, context, cache_key)
                return chunk_id, summary

        # 使用 tqdm 显示进度
        tasks = [process_one(c, ctx, ck) for c, ctx, ck in tasks_to_run]

        pbar = tqdm(
            asyncio.as_completed(tasks),
            total=len(tasks),
            desc="  生成摘要",
            unit="个",
            ncols=80
        )

        for coro in pbar:
            try:
                chunk_id, summary = await coro
                if summary:
                    summaries[chunk_id] = summary
            except Exception as e:
                print(f"\n  [警告] 摘要生成异常: {e}")

        pbar.close()
        self._save_cache()
        return summaries

    async def _summarize_single(
        self,
        chunk: dict,
        context: dict,
        cache_key: str
    ) -> str:
        """
        单个表格摘要生成（含重试）。

        参数:
            chunk: 表格 chunk 记录
            context: {"before": str, "after": str}
            cache_key: 缓存 key

        返回:
            摘要文本（失败返回空字符串）
        """
        table_markdown = chunk.get("table_markdown", "")

        # 构建 Prompt
        prompt = self.prompt_template.format(
            table_markdown=table_markdown,
            file_name=chunk.get("file_name", ""),
            section_title=chunk.get("section_title", ""),
            context_before=context.get("before") or "（无）",
            context_after=context.get("after") or "（无）",
        )

        # 重试调用 LLM
        for attempt in range(DRAFT_MAX_RETRIES):
            try:
                self._api_calls += 1
                response = await self.client.chat.completions.create(
                    model=DRAFT_LLM_MODEL,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.3,
                    max_tokens=500,
                )
                summary = response.choices[0].message.content.strip()

                # 保存到缓存
                self.cache[cache_key] = summary
                return summary

            except Exception as e:
                if attempt < DRAFT_MAX_RETRIES - 1:
                    wait_time = 2 ** attempt  # 指数退避：1s, 2s, 4s
                    await asyncio.sleep(wait_time)
                else:
                    chunk_id = chunk.get("chunk_id", "unknown")
                    print(f"\n  [警告] 表格摘要生成失败（{chunk_id}）: {e}")
                    return ""

        return ""


# ==============================================================================
# 主入口函数
# ==============================================================================

async def generate_table_summaries(
    chunks: list,
    parents: dict,
    enable: bool = ENABLE_TABLE_SUMMARY,
) -> list:
    """
    为所有表格 chunk 批量生成摘要，更新相关字段。

    参数:
        chunks: 所有 chunk 列表
        parents: {parent_id: parent_text} 字典
        enable: 是否启用（False 时直接返回原列表）

    返回:
        更新后的 chunks 列表
        - 表格 chunk 新增 table_summary 字段
        - 表格 chunk 的 text 更新为摘要 + Markdown

    更新逻辑:
        chunk["table_summary"] = summary
        chunk["text"] = f"[表格摘要]\\n{summary}\\n\\n[表格数据]\\n{table_markdown}"
        chunk["char_count"] = len(chunk["text"])
    """
    if not enable:
        return chunks

    # 筛选表格 chunk
    table_chunks = [c for c in chunks if c.get("is_table")]

    if not table_chunks:
        print("  无表格 chunk，跳过摘要生成")
        return chunks

    # 批量生成摘要
    summarizer = TableSummarizer(cache_path=TABLE_SUMMARY_CACHE_PATH)
    summaries = await summarizer.summarize_batch(table_chunks, parents)

    # 更新 chunk 字段
    updated_count = 0
    for chunk in chunks:
        if not chunk.get("is_table"):
            continue

        chunk_id = chunk.get("chunk_id", "")
        if chunk_id in summaries and summaries[chunk_id]:
            summary = summaries[chunk_id]
            table_markdown = chunk.get("table_markdown", "")

            chunk["table_summary"] = summary
            chunk["text"] = f"[表格摘要]\n{summary}\n\n[表格数据]\n{table_markdown}"
            chunk["char_count"] = len(chunk["text"])
            updated_count += 1

    print(f"  ✓ 已更新 {updated_count}/{len(table_chunks)} 个表格 chunk")
    print(f"    缓存命中: {summarizer._cache_hits}, API 调用: {summarizer._api_calls}")

    return chunks


# ==============================================================================
# 同步包装器（供非异步环境使用）
# ==============================================================================

def generate_table_summaries_sync(
    chunks: list,
    parents: dict,
    enable: bool = ENABLE_TABLE_SUMMARY,
) -> list:
    """
    同步版本的表格摘要生成。

    内部使用 asyncio.run() 调用异步实现。
    """
    return asyncio.run(generate_table_summaries(chunks, parents, enable))
