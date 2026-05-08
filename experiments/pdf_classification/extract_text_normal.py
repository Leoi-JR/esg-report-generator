"""
extract_text_normal.py
======================
text_normal 类 PDF 的独立提取库。

从 src/extractors.py 中提取 "pymupdf" 路径所需的最小函数集，
不依赖 src/ 目录下的任何模块，可独立运行。

调用链：
  extract_text_normal_pdf(file_record)
      → parse_normal_pdf(doc)           # 按标题切 sections
      → make_chunks_from_sections(...)  # sections → chunks
          → merge_short_sections()
          → preprocess_section()        # HTML 表格转 Markdown + 正文/表格分离
          → make_chunks_from_preprocessed_section()
              → recursive_split()       # 正文分块
              → split_table_by_rows()   # 表格分块

公开 API：
  extract_text_normal_pdf(file_record) → dict
      {"parents": {parent_id: parent_text}, "chunks": [chunk_dict, ...]}

  file_record 字段：
      file_path   : 绝对路径或相对路径（fitz.open 使用）
      file_name   : 文件名（用于 chunk_id 前缀）
      relative_path (可选): chunk_id 中使用的路径标识，默认取 file_name
      folder_code (可选): ESG 编码
"""

import os
import re
from typing import List

# ── 分块参数（与 src/config.py 保持一致，可在此处独立调整） ──────────────────
CHUNK_MAX_SIZE = 1200
CHUNK_MIN_SIZE = 100
TABLE_MAX_ROWS = 30

# ── PDF 标题识别参数 ──────────────────────────────────────────────────────────
PDF_TITLE_MAX_CHARS      = 20    # 标题文本长度上限（超过此值不视为标题）
PDF_TITLE_SIZE_RATIO     = 1.3   # 字号 ≥ 主字号 × 此倍率 → 候选标题
PDF_TITLE_MIN_SIZE       = 8.0   # 字号低于此值直接排除（页眉页脚小字）
PDF_TITLE_MIN_COUNT      = 2     # 候选标题数低于此值 → 放弃切割，整文件单 section
PDF_TITLE_NOISE_MAXLEN   = 2     # 长度 ≤ 此值的文本直接排除（单字符、页码数字）

# 分块分隔符优先级（与 src/extractors.py 保持一致）
SPLIT_SEPARATORS = ['\n\n', '\n', '。', '，', '']


# ==============================================================================
# 基础工具
# ==============================================================================

def count_meaningful_chars(text: str) -> int:
    """只统计中文、英文字母、数字，过滤乱码字符。"""
    return len(re.findall(r'[\u4e00-\u9fff\u3400-\u4dbfa-zA-Z0-9]', text))


# ==============================================================================
# 分块：recursive_split + merge_short_sections
# ==============================================================================

def recursive_split(text: str, max_size: int, min_size: int) -> List[str]:
    """
    递归分块：按 SPLIT_SEPARATORS 优先级将 text 切成 ≤ max_size 的片段，
    然后贪心合并，使每个 chunk 尽量接近 max_size。
    """
    def _split(t: str, sep_idx: int) -> List[str]:
        if len(t) <= max_size:
            return [t] if t else []
        if sep_idx >= len(SPLIT_SEPARATORS):
            return [t[i:i + max_size] for i in range(0, len(t), max_size)]
        sep = SPLIT_SEPARATORS[sep_idx]
        if sep == '':
            return [t[i:i + max_size] for i in range(0, len(t), max_size)]
        parts = t.split(sep)
        if len(parts) == 1:
            return _split(t, sep_idx + 1)
        result: List[str] = []
        for i, part in enumerate(parts):
            frag = part + sep if i < len(parts) - 1 else part
            if not frag.strip():
                continue
            if len(frag) <= max_size:
                result.append(frag)
            else:
                result.extend(_split(frag, sep_idx + 1))
        return result

    raw_chunks = _split(text, 0)
    if not raw_chunks:
        return []

    # 贪心合并
    merged: List[str] = [raw_chunks[0]]
    for chunk in raw_chunks[1:]:
        prev = merged[-1]
        if len(prev) + len(chunk) <= max_size:
            merged[-1] = prev + chunk
        else:
            merged.append(chunk)

    # 兜底：末尾孤立过小片段合并到前一个
    if len(merged) >= 2 and len(merged[-1]) < min_size:
        merged[-2] = merged[-2] + merged[-1]
        merged.pop()

    return merged


def merge_short_sections(
    sections: list,
    min_size: int,
    max_size: int,
) -> list:
    """
    合并过短的 section，减少碎片化 chunk。
    向前贪心 + 链式吸收，合并上限不超过 max_size。
    """
    if not sections:
        return []

    buf = [dict(s) for s in sections]
    i = 0
    while i < len(buf):
        cur = buf[i]
        if count_meaningful_chars(cur["text"]) >= min_size:
            i += 1
            continue

        merged = False

        # 向前合并（与 next）
        if i + 1 < len(buf):
            nxt = buf[i + 1]
            if len(cur["text"]) + len(nxt["text"]) + 1 <= max_size:
                nxt["text"] = cur["text"] + "\n" + nxt["text"]
                nxt["section_id"]    = cur["section_id"]
                nxt["page_or_sheet"] = cur["page_or_sheet"]
                nxt["section_title"] = cur.get("section_title", "") or nxt.get("section_title", "")
                buf.pop(i)
                merged = True

        # 向后合并（与 prev）
        if not merged and i > 0:
            prev = buf[i - 1]
            if len(prev["text"]) + len(cur["text"]) + 1 <= max_size:
                prev["text"] = prev["text"] + "\n" + cur["text"]
                prev["section_title"] = prev.get("section_title", "") or cur.get("section_title", "")
                buf.pop(i)
                merged = True

        if not merged:
            i += 1

    return buf


# ==============================================================================
# 表格处理：HTML → Markdown，按行分块
# ==============================================================================

def html_table_to_markdown(html_text: str) -> tuple:
    """
    将文本中的 HTML 表格转换为 Markdown，同时返回原始 HTML 表格列表。
    返回：(converted_text, table_html_list)
    """
    if '<table' not in html_text.lower():
        return html_text, []

    try:
        import pandas as pd
        from io import StringIO
    except ImportError:
        return html_text, []

    result = html_text
    table_html_list = []
    complete_pattern = re.compile(r'<table[^>]*>.*?</table>', re.DOTALL | re.IGNORECASE)

    for match in complete_pattern.finditer(html_text):
        table_html = match.group()
        table_html_list.append(table_html)
        md = _convert_single_table(table_html, pd, StringIO)
        if md:
            result = result.replace(table_html, '\n' + md + '\n')

    return result, table_html_list


def _convert_single_table(table_html: str, pd, StringIO) -> str:
    """将单个 HTML 表格转换为 Markdown，失败返回 None。"""
    try:
        dfs = pd.read_html(StringIO(table_html), header=0)
        if not dfs:
            return None
        df = dfs[0].fillna('').astype(str).replace('nan', '')
        try:
            return df.to_markdown(index=False)
        except ImportError:
            return None
    except Exception as e:
        print(f"[WARN] 表格转 Markdown 失败：{e}")
        return None


def _convert_single_table_to_markdown(table_html: str) -> str:
    """将单个 HTML 表格转换为 Markdown，转换失败返回原 HTML。"""
    try:
        import pandas as pd
        from io import StringIO
        dfs = pd.read_html(StringIO(table_html), header=0)
        if dfs:
            df = dfs[0].fillna('').astype(str).replace('nan', '')
            return df.to_markdown(index=False)
    except Exception:
        pass
    return table_html


def split_table_by_rows(table_html: str, max_rows: int = TABLE_MAX_ROWS) -> list:
    """
    按行数拆分表格，每个分块都保留表头。
    返回列表，每项含 table_html / table_markdown / row_range / row_count。
    """
    try:
        import pandas as pd
        from io import StringIO
        dfs = pd.read_html(StringIO(table_html), header=0)
        if not dfs:
            raise ValueError("No tables found")
        df = dfs[0]
    except Exception:
        return [{
            "table_html":     table_html,
            "table_markdown": _convert_single_table_to_markdown(table_html),
            "row_range":      (0, 0),
            "row_count":      0,
        }]

    total_rows = len(df)
    if total_rows <= max_rows:
        md = df.fillna('').astype(str).replace('nan', '').to_markdown(index=False)
        return [{"table_html": table_html, "table_markdown": md,
                 "row_range": (0, total_rows), "row_count": total_rows}]

    results = []
    for start in range(0, total_rows, max_rows):
        end = min(start + max_rows, total_rows)
        sub_df  = df.iloc[start:end]
        sub_md  = sub_df.fillna('').astype(str).replace('nan', '').to_markdown(index=False)
        sub_html = sub_df.to_html(index=False, border=1)
        results.append({"table_html": sub_html, "table_markdown": sub_md,
                         "row_range": (start, end), "row_count": end - start})
    return results


# ==============================================================================
# Section 预处理：正文 / 表格分离
# ==============================================================================

def _split_into_segments(raw_text: str, table_html_list: list) -> list:
    """
    将 Section 文本按表格位置分离为正文和表格片段序列。
    返回：[{"type": "content"/"table", "text": ..., "html"(可选): ...}, ...]
    """
    if not table_html_list:
        text = raw_text.strip()
        return [{"type": "content", "text": text}] if text else []

    segments = []
    last_end  = 0

    for table_html in table_html_list:
        start = raw_text.find(table_html, last_end)
        if start == -1:
            continue
        if start > last_end:
            content_text = raw_text[last_end:start].strip()
            if content_text:
                segments.append({"type": "content", "text": content_text})
        table_markdown = _convert_single_table_to_markdown(table_html)
        segments.append({"type": "table", "text": table_markdown,
                          "html": table_html})
        last_end = start + len(table_html)

    if last_end < len(raw_text):
        content_text = raw_text[last_end:].strip()
        if content_text:
            segments.append({"type": "content", "text": content_text})

    return segments


def preprocess_section(section: dict) -> dict:
    """
    预处理 Section：HTML→Markdown + 分离表格/正文。
    返回含 section_id / page_or_sheet / section_title / parent_text / segments 的字典。
    """
    raw_text = section["text"]
    _, table_html_list   = html_table_to_markdown(raw_text)
    parent_text, _       = html_table_to_markdown(raw_text)
    segments             = _split_into_segments(raw_text, table_html_list)

    return {
        "section_id":    section["section_id"],
        "page_or_sheet": section.get("page_or_sheet", "1"),
        "section_title": section.get("section_title", ""),
        "parent_text":   parent_text,
        "segments":      segments,
    }


# ==============================================================================
# Chunk 生成
# ==============================================================================

def _merge_short_content_chunks(raw_chunks: list, min_size: int) -> list:
    """合并短正文片段（优先向上合并，其次向下，前后都是表格则单独保留）。"""
    if not raw_chunks:
        return raw_chunks

    result        = []
    pending_merge = []

    for chunk in raw_chunks:
        if pending_merge and chunk["type"] == "content":
            for pm in pending_merge:
                chunk["text"]       = pm["text"] + "\n" + chunk["text"]
                chunk["char_count"] = chunk.get("char_count", 0) + pm.get("char_count", 0) + 1
            pending_merge = []

        if chunk["type"] != "content" or chunk.get("char_count", len(chunk["text"])) >= min_size:
            result.append(chunk)
            continue

        # 短正文：尝试向上合并
        merged = False
        for j in range(len(result) - 1, -1, -1):
            if result[j]["type"] == "content":
                result[j]["text"]       += "\n" + chunk["text"]
                result[j]["char_count"]  = result[j].get("char_count", 0) + chunk.get("char_count", 0) + 1
                merged = True
                break

        if not merged:
            pending_merge.append(chunk)

    for pm in pending_merge:
        result.append(pm)

    return result


def make_chunks_from_preprocessed_section(
    preprocessed: dict,
    file_record: dict,
    rel_path_normalized: str,
    max_size: int = CHUNK_MAX_SIZE,
    min_size: int = CHUNK_MIN_SIZE,
    max_rows: int = TABLE_MAX_ROWS,
) -> list:
    """从预处理后的 Section 生成 chunks 列表。"""
    chunks          = []
    content_index   = 0
    table_index     = 0
    section_id      = preprocessed["section_id"]
    parent_id       = f"{rel_path_normalized}#{section_id}"
    raw_chunks      = []

    for segment in preprocessed["segments"]:
        if segment["type"] == "content":
            sub_texts = recursive_split(segment["text"], max_size, min_size)
            if not sub_texts:
                sub_texts = [segment["text"]] if segment["text"].strip() else []
            for i, sub_text in enumerate(sub_texts):
                if not sub_text.strip():
                    continue
                chunk_id = f"{rel_path_normalized}#{section_id}#c{content_index}"
                if len(sub_texts) > 1:
                    chunk_id += f"p{i}"
                raw_chunks.append({
                    "type":       "content",
                    "chunk_id":   chunk_id,
                    "text":       sub_text,
                    "char_count": count_meaningful_chars(sub_text),
                })
            content_index += 1
        else:  # table
            table_parts = split_table_by_rows(segment["html"], max_rows)
            for i, part in enumerate(table_parts):
                chunk_id = f"{rel_path_normalized}#{section_id}#t{table_index}"
                if len(table_parts) > 1:
                    chunk_id += f"p{i}"
                raw_chunks.append({
                    "type":           "table",
                    "chunk_id":       chunk_id,
                    "text":           part["table_markdown"],
                    "table_markdown": part["table_markdown"],
                    "table_html":     part["table_html"],
                    "table_rows":     part["row_count"],
                    "char_count":     count_meaningful_chars(part["table_markdown"]),
                })
            table_index += 1

    raw_chunks = _merge_short_content_chunks(raw_chunks, min_size)

    for rc in raw_chunks:
        chunk = {
            "chunk_id":      rc["chunk_id"],
            "parent_id":     parent_id,
            "file_path":     file_record["file_path"],
            "file_name":     file_record["file_name"],
            "folder_code":   file_record.get("folder_code"),
            "page_or_sheet": preprocessed["page_or_sheet"],
            "section_title": preprocessed["section_title"],
            "text":          rc["text"],
            "char_count":    rc.get("char_count", count_meaningful_chars(rc["text"])),
        }
        if rc["type"] == "table":
            chunk["is_table"]       = True
            chunk["table_markdown"] = rc["table_markdown"]
            chunk["table_html"]     = rc["table_html"]
            chunk["table_rows"]     = rc["table_rows"]
        chunks.append(chunk)

    return chunks


def make_chunks_from_sections(
    sections: list,
    file_record: dict,
    max_size: int = CHUNK_MAX_SIZE,
    min_size: int = CHUNK_MIN_SIZE,
    max_rows: int = TABLE_MAX_ROWS,
) -> dict:
    """
    将 sections 列表展开为 ChunkRecord 字典。
    返回：{"parents": {parent_id: parent_text}, "chunks": [...]}
    """
    sections = merge_short_sections(sections, min_size=min_size, max_size=max_size)

    rel_path            = file_record.get("relative_path", file_record["file_name"])
    rel_path_normalized = rel_path.replace(os.sep, "/")

    parents = {}
    chunks  = []

    for section in sections:
        preprocessed = preprocess_section(section)
        parent_id    = f"{rel_path_normalized}#{preprocessed['section_id']}"

        if preprocessed["parent_text"].strip():
            parents[parent_id] = preprocessed["parent_text"]

        if not preprocessed["segments"]:
            continue

        section_chunks = make_chunks_from_preprocessed_section(
            preprocessed, file_record, rel_path_normalized,
            max_size, min_size, max_rows
        )
        chunks.extend(section_chunks)

    return {"parents": parents, "chunks": chunks}


# ==============================================================================
# PDF 解析核心：TOC 优先 → 黑体/字号启发式
# ==============================================================================

_BOLD_FONT_KEYWORDS = ('Hei', 'hei', 'Bold', 'bold', 'Heavy', 'Black', 'Gothic')
_NOISE_EN_PATTERN   = re.compile(r'^[A-Za-z0-9/\-\*\+\.]+$')  # 纯英数符号（OK/NG/IQC…）


def _is_title_candidate(text: str, size: float, font: str, main_size: float) -> bool:
    """
    判断一个 block 文本是否为标题候选。

    排除（任意一条命中即排除）：
      - 长度 ≤ PDF_TITLE_NOISE_MAXLEN（单字符、页码）
      - 字号 < PDF_TITLE_MIN_SIZE（页眉页脚小字）
      - 文本长度 > PDF_TITLE_MAX_CHARS
      - 纯英文/数字/符号 且 长度 ≤ 5（OK/NG/IQC/L/S 等表格标签）

    命中（任意一条命中即为候选）：
      A. 字体名含黑体/粗体关键字
      B. 字号 ≥ 主字号 × PDF_TITLE_SIZE_RATIO
    """
    n = len(text)
    if n <= PDF_TITLE_NOISE_MAXLEN:
        return False
    if size < PDF_TITLE_MIN_SIZE:
        return False
    if n > PDF_TITLE_MAX_CHARS:
        return False
    if n <= 5 and _NOISE_EN_PATTERN.match(text):
        return False

    is_hei  = any(kw in font for kw in _BOLD_FONT_KEYWORDS)
    is_big  = (main_size > 0) and (size >= main_size * PDF_TITLE_SIZE_RATIO)
    return is_hei or is_big


def _dominant_size(all_sizes: List[float]) -> float:
    """返回出现频率最高的字号（众数）。"""
    if not all_sizes:
        return 12.0
    from collections import Counter
    return Counter(all_sizes).most_common(1)[0][0]


def _parse_by_toc(doc, toc: list) -> List[dict]:
    """
    有内嵌书签时，按 TOC 直接切割 section。
    每条 TOC 条目对应一个 section，文本从该页起到下一条目页前截止。
    """
    total_pages = len(doc)
    sections: List[dict] = []

    # 只使用第一级（或全部级别），按页码排序
    entries = sorted(toc, key=lambda x: x[2])  # x = [level, title, page]

    for i, (level, title, page) in enumerate(entries):
        page_idx  = max(0, page - 1)          # TOC 页码从 1 开始
        next_page = entries[i + 1][2] - 1 if i + 1 < len(entries) else total_pages

        parts = []
        for p in range(page_idx, min(next_page, total_pages)):
            parts.append(doc[p].get_text())

        body = "\n".join(parts).strip()
        sec_text = (title + "\n" + body).strip() if body else title
        if sec_text:
            sections.append({
                "section_id":    f"s{i}",
                "page_or_sheet": str(page),
                "text":          sec_text,
                "section_title": title,
            })

    return sections


def parse_normal_pdf(doc) -> List[dict]:
    """
    对普通文字 PDF 按标题结构切分 section，返回 section 列表。

    优先级：
      1. doc.get_toc() 有书签 → 直接按 TOC 切割
      2. 无 TOC → 启发式：黑体字体名 OR 字号 ≥ 主字号×1.3
      3. 无有效标题候选 → 整文件作单一 section
    """
    total_pages = len(doc)
    if total_pages == 0:
        return []

    # ── 阶段一：TOC 优先 ───────────────────────────────────────────────────────
    toc = doc.get_toc()
    if toc:
        sections = _parse_by_toc(doc, toc)
        if sections:
            return sections

    # ── 阶段二：收集所有 span，计算主字号 ────────────────────────────────────
    all_sizes: List[float] = []
    para_records: List[dict] = []

    for page_idx, page in enumerate(doc):
        for block in page.get_text("dict").get("blocks", []):
            if block.get("type") != 0:
                continue
            block_text  = ""
            max_size    = 0.0
            dominant_font = ""
            size_counts: dict = {}

            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    t    = span.get("text", "")
                    sz   = span.get("size", 0)
                    font = span.get("font", "")
                    block_text += t
                    if sz > 0:
                        all_sizes.append(sz)
                        size_counts[font] = size_counts.get(font, 0) + len(t)
                    if sz > max_size:
                        max_size = sz
                        dominant_font = font

            block_text = block_text.strip()
            if not block_text:
                continue
            para_records.append({
                "text":  block_text,
                "size":  max_size,
                "font":  dominant_font,
                "page":  page_idx + 1,
            })

    if not para_records:
        return []

    main_size = _dominant_size(all_sizes)

    # ── 阶段三：标记标题候选 ──────────────────────────────────────────────────
    for rec in para_records:
        rec["is_title"] = _is_title_candidate(
            rec["text"], rec["size"], rec["font"], main_size
        )

    title_count = sum(1 for r in para_records if r["is_title"])

    # ── 阶段四：候选数不足 → 整文件单 section ────────────────────────────────
    if title_count < PDF_TITLE_MIN_COUNT:
        full_text  = "\n".join(r["text"] for r in para_records)
        first_page = para_records[0]["page"]
        return [{"section_id":    "doc",
                 "page_or_sheet": str(first_page),
                 "text":          full_text,
                 "section_title": ""}]

    # ── 阶段五：按标题切割 section ────────────────────────────────────────────
    sections: List[dict] = []
    current_title = ""
    current_page  = para_records[0]["page"]
    body_parts: List[str] = []
    counter = 0

    def _flush():
        nonlocal counter
        body     = "\n".join(body_parts).strip()
        sec_text = (current_title + "\n" + body).strip() if current_title else body
        if sec_text:
            sections.append({
                "section_id":    f"s{counter}",
                "page_or_sheet": str(current_page),
                "text":          sec_text,
                "section_title": current_title,
            })
            counter += 1

    for rec in para_records:
        if rec["is_title"]:
            _flush()
            current_title = rec["text"]
            current_page  = rec["page"]
            body_parts    = []
        else:
            body_parts.append(rec["text"])

    _flush()
    return sections


# ==============================================================================
# 公开 API
# ==============================================================================

def extract_text_normal_pdf(file_record: dict) -> dict:
    """
    text_normal 类 PDF 的完整提取入口。

    参数：
        file_record: {
            "file_path":     str,  # PDF 文件路径（fitz.open 使用）
            "file_name":     str,  # 文件名
            "relative_path": str,  # 可选，用于 chunk_id 前缀
            "folder_code":   str,  # 可选，ESG 编码
        }

    返回：
        {
            "parents": {parent_id: parent_text, ...},
            "chunks":  [chunk_dict, ...]
        }

    异常时打印警告并返回空结果，不向外抛出。
    """
    try:
        import fitz
        doc      = fitz.open(file_record["file_path"])
        sections = parse_normal_pdf(doc)
        doc.close()
    except Exception as e:
        print(f"[WARN] PDF 解析失败：{file_record.get('file_name', '')} — {e}")
        return {"parents": {}, "chunks": []}

    if not sections:
        return {"parents": {}, "chunks": []}

    return make_chunks_from_sections(sections, file_record)
