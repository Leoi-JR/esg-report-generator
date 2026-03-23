"""
extractors.py
=============
阶段二：各文件类型的文本提取函数。

架构分为两层：
  1. 提取层（返回 section 列表）：parse_*() / _extract_*_sections()
  2. 分块层（返回 chunk 列表）：extract_*() — 内部调用提取层 + make_chunks_from_sections

公开 API：
  extract_sections(file_record)  → List[dict] | None   # 阶段 2a：纯提取
  extract_*(file_record)         → List[dict]           # 阶段 2a+2b：提取 + 分块

Section 字段：
    section_id, page_or_sheet, text, section_title

ChunkRecord 字段：
    chunk_id, parent_id, file_path, file_name, folder_code,
    page_or_sheet, chunk_index, text, parent_text, char_count

已实现：
    extract_pdf(file_record)   → List[dict]  # 步骤 2-1（含 GLM-OCR）
    extract_docx(file_record)  → List[dict]  # 步骤 2-2
    extract_doc(file_record)   → List[dict]  # 步骤 2-3（LibreOffice 转换）
    extract_xlsx(file_record)  → List[dict]  # 步骤 2-4
    extract_xls(file_record)   → List[dict]  # 步骤 2-4
    extract_pptx(file_record)  → List[dict]  # 步骤 2-5
    extract_ppt(file_record)   → List[dict]  # 步骤 2-5（LibreOffice 转换）
    extract_image(file_record) → List[dict]  # 步骤 2-6（JPG/PNG，GLM-OCR）
"""

import os
import re
from typing import List

from config import (
    # 分块参数（全局默认 + 各类型覆盖）
    chunk_params,
    # PDF 分类阈值
    PDF_SAMPLE_PAGES,
    PDF_PPT_ASPECT_RATIO,
    PDF_PPT_AVG_BLOCK_CHARS,
    PDF_PPT_AVG_IMAGES,
    PDF_SCANNED_CHARS_PER_PAGE,
    PDF_OCR_DPI,
    PDF_TITLE_SIZE_PERCENTILE,
    PDF_TITLE_MAX_CHARS,
    PDF_TITLE_RATIO_MAX,
    PDF_TITLE_MIN_COUNT,
    # DOCX 标题识别
    DOCX_HEADING_MAX_CHARS,
    # LibreOffice 超时
    SOFFICE_DOC_TIMEOUT,
    SOFFICE_PPT_TIMEOUT,
    # GLM-OCR 服务
    GLM_OCR_BASE_URL as _GLM_OCR_BASE_URL_DEFAULT,
    GLM_OCR_MODEL    as _GLM_OCR_MODEL_DEFAULT,
    # VLM 图片分类与描述服务
    VLM_BASE_URL as _VLM_BASE_URL_DEFAULT,
    VLM_MODEL    as _VLM_MODEL_DEFAULT,
    # VLM 图片过滤与处理
    IMAGE_MIN_WIDTH,
    IMAGE_MIN_HEIGHT,
    IMAGE_MIN_BYTES,
    VLM_MAX_IMAGE_PX,
    # VLM 缓存
    VLM_CACHE_PATH,
)


# ==============================================================================
# 2-0  基础设施：字符统计 + 分块
# ==============================================================================

def count_meaningful_chars(text: str) -> int:
    """只统计中文、英文字母、数字，过滤乱码字符（如私有区字符）。"""
    return len(re.findall(r'[\u4e00-\u9fff\u3400-\u4dbfa-zA-Z0-9]', text))


# 分块时按优先级依次尝试的分隔符列表；空字符串 '' 代表按单字符切
SPLIT_SEPARATORS = ['\n\n', '\n', '。', '，', '']

# 分块参数统一在 src/config.py 中管理（CHUNK_MAX_SIZE / CHUNK_MIN_SIZE 及各类型覆盖值）
# 各 parse_* 函数通过 chunk_params('<type>') 获取对应的 (max_size, min_size)


def recursive_split(text: str, max_size: int, min_size: int) -> List[str]:
    """
    递归分块：按 SPLIT_SEPARATORS 优先级将 text 切成 ≤ max_size 的片段，
    然后贪心合并，使每个 chunk 尽量接近 max_size。

    合并策略：
      - 贪心：只要"当前累积 + 下一片段"≤ max_size，就持续合并
      - 兜底：合并后仍 < min_size 的孤立片段与前一个合并（即使超过 max_size 也接受，
              但 _split 保证单片段本身不超 max_size，所以不会出现超限）
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

    # 贪心合并：只要累积长度 + 下一片段 ≤ max_size，持续合并
    merged: List[str] = [raw_chunks[0]]
    for chunk in raw_chunks[1:]:
        prev = merged[-1]
        if len(prev) + len(chunk) <= max_size:
            merged[-1] = prev + chunk
        else:
            merged.append(chunk)

    # 兜底：末尾孤立的过小片段（< min_size）合并到前一个
    if len(merged) >= 2 and len(merged[-1]) < min_size:
        merged[-2] = merged[-2] + merged[-1]
        merged.pop()

    return merged


def merge_short_sections(
    sections: list[dict],
    min_size: int,
    max_size: int,
) -> list[dict]:
    """
    合并过短的 section，减少碎片化 chunk。

    算法：向前贪心 + 链式吸收
      - 正向遍历，短 section（meaningful chars < min_size）优先向前（next）合并，
        其次向后（prev）合并；合并后不推进索引，实现链式吸收。
      - 合并上限：两段 text 拼接后长度（含 \\n）不超过 max_size。
      - 两方向均超限时保留原样（安全阀）。

    元数据继承规则：
      - 向前合并（cur → next）：next 继承 cur 的 section_id 和 page_or_sheet
      - 向后合并（cur → prev）：prev 保持自己的 section_id 和 page_or_sheet
      - section_title：取两者中第一个非空值

    不修改原列表和原 dict。
    """
    if not sections:
        return []

    # 浅拷贝列表，每个 dict 也拷贝一份
    buf = [dict(s) for s in sections]

    i = 0
    while i < len(buf):
        cur = buf[i]
        if count_meaningful_chars(cur["text"]) >= min_size:
            i += 1
            continue

        # cur 是短 section，尝试合并
        merged = False

        # 尝试向前合并（与 next）
        if i + 1 < len(buf):
            nxt = buf[i + 1]
            combined_len = len(cur["text"]) + len(nxt["text"]) + 1  # +1 for \n
            if combined_len <= max_size:
                # 将 cur 文本 prepend 到 next
                nxt["text"] = cur["text"] + "\n" + nxt["text"]
                # next 继承 cur 的 section_id 和 page_or_sheet
                nxt["section_id"] = cur["section_id"]
                nxt["page_or_sheet"] = cur["page_or_sheet"]
                # section_title：取第一个非空值
                cur_title = cur.get("section_title", "")
                nxt_title = nxt.get("section_title", "")
                nxt["section_title"] = cur_title or nxt_title
                buf.pop(i)
                merged = True

        # 尝试向后合并（与 prev）
        if not merged and i > 0:
            prev = buf[i - 1]
            combined_len = len(prev["text"]) + len(cur["text"]) + 1  # +1 for \n
            if combined_len <= max_size:
                # 将 cur 文本 append 到 prev
                prev["text"] = prev["text"] + "\n" + cur["text"]
                # prev 保持自己的 section_id 和 page_or_sheet
                # section_title：取第一个非空值
                prev_title = prev.get("section_title", "")
                cur_title = cur.get("section_title", "")
                prev["section_title"] = prev_title or cur_title
                buf.pop(i)
                merged = True

        if not merged:
            # 安全阀：两方向都超 max_size，保留 cur
            i += 1

    return buf


def make_chunks_from_sections(sections: list, file_record: dict,
                               max_size: int, min_size: int) -> List[dict]:
    """
    将 sections 列表展开为 ChunkRecord 列表。

    sections 格式：
        [{"section_id": str, "page_or_sheet": str, "text": str,
          "section_title": str (optional)}, ...]

    section_title：当文档采用"第2层切割"策略时，存放第1层标题文本，
                   供对齐表审查时提供上下文（如"3.权责"）。
    """
    sections = merge_short_sections(sections, min_size=min_size, max_size=max_size)

    rel_path = file_record.get("relative_path", file_record["file_name"])
    rel_path_normalized = rel_path.replace(os.sep, "/")

    chunks: List[dict] = []
    for section in sections:
        section_id    = section["section_id"]
        page_or_sheet = section["page_or_sheet"]
        parent_text   = section["text"]
        section_title = section.get("section_title", "")   # 第1层标题（可选）
        parent_id     = f"{rel_path_normalized}#{section_id}"

        sub_chunks = recursive_split(parent_text, max_size=max_size, min_size=min_size)
        if not sub_chunks:
            sub_chunks = [""]  # 保留空 section 占位

        # 过滤无有效字符的 chunk（全为空格/制表符等），但空 section 的唯一占位保留
        is_empty_section = (len(sub_chunks) == 1 and sub_chunks[0] == "")
        if not is_empty_section:
            sub_chunks = [t for t in sub_chunks if count_meaningful_chars(t) > 0]
            if not sub_chunks:
                continue  # 整个 section 无有效字符，跳过

        for m, sub_text in enumerate(sub_chunks):
            chunks.append({
                "chunk_id":      f"{parent_id}#c{m}",
                "parent_id":     parent_id,
                "file_path":     file_record["file_path"],
                "file_name":     file_record["file_name"],
                "folder_code":   file_record.get("folder_code"),
                "page_or_sheet": page_or_sheet,
                "chunk_index":   m,
                "text":          sub_text,
                "parent_text":   parent_text,
                "section_title": section_title,
                "char_count":    count_meaningful_chars(sub_text),
            })

    return chunks


# ==============================================================================
# 2-1  GLM-OCR 调用封装
# ==============================================================================

# GLM-OCR 服务配置（从 config.py 读取默认值；可由 configure_glmocr() 覆盖）
_GLM_OCR_BASE_URL = _GLM_OCR_BASE_URL_DEFAULT
_GLM_OCR_MODEL    = _GLM_OCR_MODEL_DEFAULT

_glmocr_client = None  # 懒加载单例


def configure_glmocr(base_url: str, model: str) -> None:
    """
    由 align_evidence.py 在启动时调用，将主配置区的参数注入到本模块。
    必须在首次调用 call_glmocr() 之前执行。
    """
    global _GLM_OCR_BASE_URL, _GLM_OCR_MODEL, _glmocr_client
    _GLM_OCR_BASE_URL = base_url
    _GLM_OCR_MODEL    = model
    _glmocr_client    = None  # 重置单例，使下次调用重新创建


# ==============================================================================
# 2-1b  VLM 图片分类与描述调用封装
# ==============================================================================

# VLM 服务配置（从 config.py 读取默认值；可由 configure_vlm() 覆盖）
_VLM_BASE_URL  = _VLM_BASE_URL_DEFAULT
_VLM_MODEL     = _VLM_MODEL_DEFAULT

_vlm_client    = None   # 懒加载单例（OpenAI 兼容客户端）
_vlm_available = None   # None=未探测, True=可用, False=不可用
_vlm_context:  dict = {}  # {code: enhanced_query_text}，由 configure_vlm_context() 注入
_vlm_cache:    dict = {}  # {sha256_hex: {"type": str, "description": str}}


def configure_vlm(base_url: str, model: str) -> None:
    """
    由 align_evidence.py 在启动时调用，将 VLM 服务配置注入本模块。
    必须在首次调用 call_vlm_classify() 之前执行。
    """
    global _VLM_BASE_URL, _VLM_MODEL, _vlm_client, _vlm_available
    _VLM_BASE_URL  = base_url
    _VLM_MODEL     = model
    _vlm_client    = None   # 重置单例
    _vlm_available = None   # 重置探测状态


def configure_vlm_context(enhanced_queries: dict) -> None:
    """
    注入 {code: enhanced_query_text} 映射，供 VLM prompt 提供上下文。
    在 align_evidence.py 加载增强查询文本后调用。
    """
    global _vlm_context
    _vlm_context = enhanced_queries or {}


def load_vlm_cache() -> None:
    """从 VLM_CACHE_PATH 加载已有缓存到 _vlm_cache。align_evidence.py 启动时调用。"""
    global _vlm_cache
    import json as _json
    if os.path.isfile(VLM_CACHE_PATH):
        try:
            with open(VLM_CACHE_PATH, "r", encoding="utf-8") as f:
                _vlm_cache = _json.load(f)
            print(f"  ✓ VLM 缓存加载：{len(_vlm_cache)} 条")
        except Exception:
            _vlm_cache = {}


def save_vlm_cache() -> None:
    """将 _vlm_cache 持久化到 VLM_CACHE_PATH。align_evidence.py 阶段 2a 完成后调用。"""
    import json as _json
    if not _vlm_cache:
        return
    try:
        os.makedirs(os.path.dirname(VLM_CACHE_PATH), exist_ok=True)
        with open(VLM_CACHE_PATH, "w", encoding="utf-8") as f:
            _json.dump(_vlm_cache, f, ensure_ascii=False, indent=2)
        print(f"  ✓ VLM 缓存已保存：{len(_vlm_cache)} 条 → {VLM_CACHE_PATH}")
    except Exception as e:
        print(f"  [警告] VLM 缓存保存失败：{e}")


# 合法图片类型集合（VLM 分类输出选项）
_VLM_VALID_TYPES = {"文档扫描件", "表格截图", "照片", "流程图", "数据图表", "证书", "其他"}


def _parse_vlm_response(raw: str) -> dict:
    """
    解析 VLM 返回的分类+描述文本。

    期望格式：
        类型：xxx
        描述：yyy

    容错：若解析失败，type 设为 "其他"，description 取原始输出前 100 字。
    """
    result = {"type": "其他", "description": ""}

    type_match = re.search(r'类型[：:]\s*(.+?)(?:\n|$)', raw)
    desc_match = re.search(r'描述[：:]\s*(.+?)(?:\n|$)', raw)

    if type_match:
        t = type_match.group(1).strip()
        if t in _VLM_VALID_TYPES:
            result["type"] = t
        else:
            # 模糊匹配：包含关系
            for valid in _VLM_VALID_TYPES:
                if valid in t or t in valid:
                    result["type"] = valid
                    break

    if desc_match:
        result["description"] = desc_match.group(1).strip()[:200]
    elif raw.strip():
        # 回退：使用原始输出截断
        result["description"] = raw.strip()[:100]

    return result


def call_vlm_classify(
    img_bytes: bytes,
    filename: str = "",
    page: str = "",
    idx: int = 0,
    folder_code: str | None = None,
    source_path: str = "",
) -> dict | None:
    """
    调用 VLM 对图片进行分类和描述。

    参数:
        img_bytes    - PNG 格式图片字节流（应已 resize）
        filename     - 来源文件名（供 prompt 上下文）
        page         - 所在页码/sheet
        idx          - 该页/文件中的第几张图（0-based）
        folder_code  - 路径编码（若有）
        source_path  - 来源文件相对路径（供缓存溯源，如 G-公司治理/GA1/报告.pdf）

    返回:
        {"type": str, "description": str, "source": str, "page": str, "idx": int}
        或 None（服务不可用时）

    分类选项：文档扫描件 / 表格截图 / 照片 / 流程图 / 数据图表 / 证书 / 其他
    """
    import base64
    import hashlib
    from openai import OpenAI

    global _vlm_client, _vlm_available

    # ── 已探测为不可用 → 短路返回 ────────────────────────────────────────
    if _vlm_available is False:
        return None

    # ── 缓存命中检查 ─────────────────────────────────────────────────────
    img_hash = hashlib.sha256(img_bytes).hexdigest()
    if img_hash in _vlm_cache:
        return _vlm_cache[img_hash]

    # ── 构建 prompt ───────────────────────────────────────────────────────
    location_str = f"第{page}页 第{idx+1}张图" if page else f"第{idx+1}张图"
    context_parts = []
    if filename:
        context_parts.append(f"- 文件：{filename}")
    context_parts.append(f"- 位置：{location_str}")

    if folder_code and folder_code in _vlm_context:
        context_parts.append(f"- 所属分类：{folder_code} — {_vlm_context[folder_code]}")
    elif folder_code:
        context_parts.append(f"- 所属分类：{folder_code}")

    context_block = "\n".join(context_parts)

    prompt = (
        "你是一个图片分类与描述助手。请根据以下信息对图片进行分类和简要描述。\n\n"
        f"图片来源信息：\n{context_block}\n\n"
        "请输出：\n"
        "1. 图片类型（从以下选一个）：文档扫描件 / 表格截图 / 照片 / 流程图 / "
        "数据图表 / 证书 / 其他\n"
        "2. 一句话描述（30-80字，说清楚图片展示了什么内容）\n\n"
        "输出格式（严格遵守，不要多余文字）：\n"
        "类型：xxx\n"
        "描述：yyy"
    )

    # ── 懒加载 VLM 客户端 ─────────────────────────────────────────────────
    if _vlm_client is None:
        try:
            _vlm_client = OpenAI(api_key="not-needed", base_url=_VLM_BASE_URL)
            _vlm_client.models.list()   # 探测连通性
            _vlm_available = True
        except Exception as e:
            print(f"  [警告] VLM 服务不可用（{_VLM_BASE_URL}）：{e}")
            _vlm_available = False
            return None

    # ── 调用 VLM ──────────────────────────────────────────────────────────
    try:
        data_uri = "data:image/png;base64," + base64.b64encode(img_bytes).decode()
        response = _vlm_client.chat.completions.create(
            model=_VLM_MODEL,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": data_uri}},
                    {"type": "text",      "text": prompt},
                ],
            }],
            max_tokens=256,
            temperature=0.1,
        )
        raw = response.choices[0].message.content or ""
        result = _parse_vlm_response(raw)
        result["source"] = source_path or filename
        result["page"]   = page
        result["idx"]    = idx
        _vlm_cache[img_hash] = result
        return result
    except Exception as e:
        print(f"  [警告] VLM 调用失败：{e}")
        return None


# ==============================================================================
# 2-1c  图片过滤 / Resize / 格式转换 工具函数
# ==============================================================================

def _filter_image(img_bytes: bytes, width: int, height: int) -> bool:
    """
    判断图片是否通过最小尺寸和最小字节过滤。
    通过 → True（应处理），不通过 → False（应跳过）。
    """
    if len(img_bytes) < IMAGE_MIN_BYTES:
        return False
    if width < IMAGE_MIN_WIDTH or height < IMAGE_MIN_HEIGHT:
        return False
    return True


def _resize_image_bytes(img_bytes: bytes, max_px: int | None = None) -> bytes:
    """
    将图片字节流等比缩放至长边不超过 max_px，返回 PNG 字节流。
    若已在范围内或 max_px 为 None，直接返回原始字节。
    """
    from PIL import Image
    import io

    if max_px is None:
        max_px = VLM_MAX_IMAGE_PX

    img = Image.open(io.BytesIO(img_bytes))
    w, h = img.size
    if max(w, h) <= max_px:
        return img_bytes

    scale = max_px / max(w, h)
    new_w = int(w * scale)
    new_h = int(h * scale)
    img = img.resize((new_w, new_h), Image.LANCZOS)

    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="PNG")
    return buf.getvalue()


def _to_png_bytes(img_bytes: bytes, ext: str = "") -> tuple[bytes, int, int]:
    """
    将任意图片格式（JPEG/PNG/BMP/TIFF 等）转为 PNG 字节流。
    返回 (png_bytes, width, height)。
    """
    from PIL import Image
    import io

    img = Image.open(io.BytesIO(img_bytes))
    w, h = img.size
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="PNG")
    return buf.getvalue(), w, h


def _assemble_image_section_text(
    vlm_result: dict,
    filename: str,
    page: str,
    idx: int,
    png_bytes: bytes | None = None,
) -> str:
    """
    根据 VLM 分类结果组装 section text。

    对于 文档扫描件/表格截图：追加 OCR 获取精确文本。
    对于其他类型：使用 VLM 描述。

    格式：
        [图片] 来源：{filename} 第{page}页 | 类型：{type}
        {description_or_ocr_text}
    """
    img_type    = vlm_result.get("type", "其他")
    description = vlm_result.get("description", "")

    # 文档扫描件/表格截图 → 追加 OCR
    final_text = description
    if img_type in ("文档扫描件", "表格截图") and png_bytes is not None:
        try:
            ocr_text = call_glmocr(png_bytes)
            if ocr_text and count_meaningful_chars(ocr_text) > 10:
                final_text = ocr_text  # OCR 文本替代 VLM 描述
        except Exception:
            pass  # OCR 失败时保留 VLM 描述

    header = f"[图片] 来源：{filename} 第{page}页 | 类型：{img_type}"
    return f"{header}\n{final_text}"


def _process_single_image(
    png_bytes: bytes,
    width: int,
    height: int,
    filename: str,
    page: str,
    idx: int,
    folder_code: str | None = None,
    source_path: str = "",
) -> str | None:
    """
    图片处理公共管线：过滤 → 缩放 → VLM 分类+描述 → 组装 section 文本。

    参数:
        png_bytes    - 已转为 PNG 格式的图片字节流（原始尺寸，OCR 用）
        width/height - 图片原始尺寸（用于过滤判断）
        filename     - 来源文件名
        page         - 所在页码/sheet（字符串）
        idx          - 该页/文件中的图片序号（0-based，用于 VLM prompt）
        folder_code  - 路径编码（若有）
        source_path  - 来源文件相对路径（供缓存溯源）

    返回:
        组装好的 section 文本字符串，或 None（过滤/VLM 不可用时）。
    """
    if not _filter_image(png_bytes, width, height):
        return None

    png_resized = _resize_image_bytes(png_bytes)

    vlm_result = call_vlm_classify(
        img_bytes=png_resized,
        filename=filename,
        page=page,
        idx=idx,
        folder_code=folder_code,
        source_path=source_path,
    )

    if vlm_result is None:
        return None

    return _assemble_image_section_text(
        vlm_result=vlm_result,
        filename=filename,
        page=page,
        idx=idx + 1,
        png_bytes=png_bytes,
    )


def call_glmocr(img_bytes: bytes) -> str:
    """
    调用本地 vLLM 部署的 GLM-OCR 服务（OpenAI 兼容接口）。
    img_bytes: PNG 格式的图片字节流
    返回: 识别出的文本（Markdown 格式）

    vLLM 服务需提前在 GPU 服务器上启动：
        vllm serve zai-org/GLM-OCR \\
            --allowed-local-media-path / \\
            --port 8080 \\
            --speculative-config '{"method": "mtp", "num_speculative_tokens": 1}' \\
            --served-model-name glm-ocr
    """
    import base64
    from openai import OpenAI

    global _glmocr_client
    if _glmocr_client is None:
        _glmocr_client = OpenAI(
            api_key="not-needed",       # vLLM 本地服务无需真实 key
            base_url=_GLM_OCR_BASE_URL,
        )

    data_uri = "data:image/png;base64," + base64.b64encode(img_bytes).decode()
    response = _glmocr_client.chat.completions.create(
        model=_GLM_OCR_MODEL,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": data_uri}},
                {"type": "text",      "text": "Text Recognition:"},
            ],
        }],
        max_tokens=8192,
        temperature=0.01,
    )
    return response.choices[0].message.content or ""


# ==============================================================================
# 2-1  PDF 提取
# ==============================================================================

def classify_pdf(doc) -> str:
    """
    判断 PDF 类型：
      "ppt"     - PPT 转 PDF（横向页面 + 碎片文字或大量图片）
      "scanned" - 扫描件（有效字符极少）
      "normal"  - 普通文字 PDF
    """
    total_pages = len(doc)
    if total_pages == 0:
        return "normal"

    # ── PPT 转 PDF 判断（只看前 N 页）───────────────────────────────────────
    sample_pages = [doc[i] for i in range(min(PDF_SAMPLE_PAGES, total_pages))]

    aspect_ratios   = []
    avg_block_chars = []
    img_counts      = []

    for page in sample_pages:
        rect = page.rect
        aspect_ratios.append(rect.width / rect.height if rect.height > 0 else 1.0)

        blocks      = page.get_text("blocks")
        text_blocks = [b for b in blocks if b[6] == 0]  # type 0 = text
        if text_blocks:
            avg_block_chars.append(sum(len(b[4]) for b in text_blocks) / len(text_blocks))
        else:
            avg_block_chars.append(0)

        img_counts.append(len(page.get_images(full=False)))

    mean_aspect    = sum(aspect_ratios)   / len(aspect_ratios)
    mean_blk_chars = sum(avg_block_chars) / len(avg_block_chars)
    mean_imgs      = sum(img_counts)      / len(img_counts)

    if mean_aspect > PDF_PPT_ASPECT_RATIO and (mean_blk_chars < PDF_PPT_AVG_BLOCK_CHARS or mean_imgs >= PDF_PPT_AVG_IMAGES):
        return "ppt"

    # ── 扫描件判断（遍历全文）───────────────────────────────────────────────
    total_meaningful = sum(count_meaningful_chars(page.get_text()) for page in doc)
    if total_meaningful / total_pages < PDF_SCANNED_CHARS_PER_PAGE:
        return "scanned"

    return "normal"


def ocr_pdf(doc, source_path: str = "") -> List[dict]:
    """
    对扫描件 / PPT 转 PDF 逐页 OCR，返回 section 列表。
    增强：OCR 质量差的页面（有效字符 < 20），追加 VLM 描述作为语义补充。
    """
    sections = []
    for i, page in enumerate(doc):
        img_bytes = page.get_pixmap(dpi=PDF_OCR_DPI).tobytes("png")
        ocr_text  = call_glmocr(img_bytes)

        # OCR 质量检查：有效字符过少时 VLM 补充
        meaningful = count_meaningful_chars(ocr_text)
        if meaningful < 20:
            try:
                vlm_result = call_vlm_classify(
                    img_bytes=_resize_image_bytes(img_bytes),
                    page=str(i + 1),
                    idx=0,
                    source_path=source_path,
                )
                if vlm_result and vlm_result.get("description"):
                    vlm_desc = f"类型：{vlm_result['type']} | {vlm_result['description']}"
                    if ocr_text.strip():
                        ocr_text = f"{ocr_text}\n[VLM补充] {vlm_desc}"
                    else:
                        ocr_text = f"[VLM描述] {vlm_desc}"
            except Exception:
                pass  # VLM 失败不影响 OCR 结果

        sections.append({
            "section_id":    f"p{i + 1}",
            "page_or_sheet": str(i + 1),
            "text":          ocr_text,
            "section_title": "",
        })
    return sections


def _find_title_threshold(
    all_sizes: List[float],
    para_records: List[dict],
) -> float:
    """
    根据字号分布和 block 级命中率，选取最佳标题阈值。

    算法（逐级上探）：
    1. 从 P75 百分位开始，计算该阈值下标题 block 占比
    2. 若占比 > PDF_TITLE_RATIO_MAX（50%），说明阈值过低
    3. 收集所有去重字号并升序排列，从当前阈值向上逐级尝试
    4. 取第一个满足条件的阈值：
       - 命中 block 数 > PDF_TITLE_MIN_COUNT（2）
       - 命中 block 占比 ≤ PDF_TITLE_RATIO_MAX（50%）
    5. 若所有更高字号均不满足 → 返回 0（放弃标题切割）

    Args:
        all_sizes:    全文所有 span 的 font size 列表（含重复）
        para_records: block 级记录列表，每条需含 'max_size' 和 'text' 字段

    Returns:
        float: 标题阈值（size ≥ 此值的 block 视为标题）。
               返回 0 表示无法识别有效标题层级。
    """
    if not all_sizes or not para_records:
        return 0

    # Step 1: P75 基础阈值（与原逻辑一致）
    sorted_sizes = sorted(all_sizes)
    p_idx = int(len(sorted_sizes) * PDF_TITLE_SIZE_PERCENTILE)
    base_threshold = sorted_sizes[min(p_idx, len(sorted_sizes) - 1)]

    # Step 2: 计算 block 级命中率
    def _title_stats(threshold: float) -> tuple:
        """返回 (命中数, 总数, 占比)"""
        total = len(para_records)
        hits = sum(1 for r in para_records
                   if r["max_size"] >= threshold
                   and len(r["text"]) <= PDF_TITLE_MAX_CHARS)
        return hits, total, hits / total if total > 0 else 0.0

    hits, total, ratio = _title_stats(base_threshold)

    # P75 命中率合理 → 直接采用
    if ratio <= PDF_TITLE_RATIO_MAX:
        return base_threshold if hits > 0 else 0

    # Step 3: P75 命中率过高 → 逐级上探
    unique_sizes = sorted(set(all_sizes))
    higher_levels = [s for s in unique_sizes if s > base_threshold]

    for level in higher_levels:
        hits, total, ratio = _title_stats(level)
        if hits > PDF_TITLE_MIN_COUNT and ratio <= PDF_TITLE_RATIO_MAX:
            return level

    # Step 4: 所有更高字号都不满足 → 放弃标题切割
    return 0


def parse_normal_pdf(doc) -> List[dict]:
    """
    对普通文字 PDF 按标题结构切分 section，返回 section 列表。

    标题识别逻辑（逐级上探）：
    1. 收集全文所有 span 的 size，取 P75 百分位作为初始阈值
    2. 若该阈值命中的 block 占比 > 50%，逐级尝试更高字号
    3. 取第一个命中数 > 2 且占比 ≤ 50% 的字号作为标题阈值
    4. 所有字号均不满足时，整文件作一个 section（section_id = "doc"）
    """
    total_pages = len(doc)
    if total_pages == 0:
        return []

    # ── 第一遍：收集所有 span size ──────────────────────────────────────
    all_sizes: List[float] = []
    for page in doc:
        for block in page.get_text("dict").get("blocks", []):
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    size = span.get("size", 0)
                    if size > 0:
                        all_sizes.append(size)

    # ── 第二遍：按页收集段落记录（携带 max_size） ────────────────────────
    para_records: List[dict] = []
    for page_idx, page in enumerate(doc):
        for block in page.get_text("dict").get("blocks", []):
            if block.get("type") != 0:
                continue
            block_text       = ""
            max_size_in_block = 0.0
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    block_text += span.get("text", "")
                    size = span.get("size", 0)
                    if size > max_size_in_block:
                        max_size_in_block = size

            block_text = block_text.strip()
            if not block_text:
                continue

            para_records.append({
                "max_size": max_size_in_block,
                "text":     block_text,
                "page":     page_idx + 1,
            })

    # ── 第三步：确定标题阈值（逐级上探） ─────────────────────────────────
    title_threshold = _find_title_threshold(all_sizes, para_records)

    # 根据最终阈值标记每个 block 的 is_title
    for rec in para_records:
        rec["is_title"] = (title_threshold > 0
                           and rec["max_size"] >= title_threshold
                           and len(rec["text"]) <= PDF_TITLE_MAX_CHARS)

    # ── 第四步：按标题切割 section ───────────────────────────────────────
    sections: List[dict] = []

    if not para_records or not any(r["is_title"] for r in para_records):
        full_text  = "\n".join(r["text"] for r in para_records)
        first_page = para_records[0]["page"] if para_records else 1
        sections.append({"section_id": "doc",
                          "page_or_sheet": str(first_page),
                          "text": full_text,
                          "section_title": ""})
        return sections

    current_title = ""
    current_page  = para_records[0]["page"]
    body_parts: List[str] = []
    counter       = 0

    def _flush():
        nonlocal counter
        body     = "\n".join(body_parts).strip()
        sec_text = (current_title + "\n" + body).strip() if current_title else body
        if sec_text:
            sections.append({"section_id":    f"s{counter}",
                              "page_or_sheet": str(current_page),
                              "text":          sec_text,
                              "section_title": ""})
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


def _extract_pdf_images(doc, file_record: dict) -> List[dict]:
    """
    从 PDF 中提取嵌入式图片，返回 image section 列表。

    逻辑：
    1. 逐页遍历，对每页调用 page.get_images(full=True) 获取图片 xref
    2. 按 xref 去重（同一张图可能被多页引用）
    3. doc.extract_image(xref) 获取原始字节
    4. 过滤（尺寸 + 字节）→ 转 PNG → resize → VLM 分类+描述
    5. 若类型为 文档扫描件/表格截图 → 追加 OCR
    6. 组装为 section dict

    section_id 格式: "img_p{page}_{idx}"，区别于文本 section
    """
    sections: List[dict] = []
    seen_xrefs: set = set()
    filename    = file_record.get("file_name", "")
    folder_code = file_record.get("folder_code")
    source_path = file_record.get("relative_path", filename)
    global_img_idx = 0  # 全局图片计数器

    for page_idx, page in enumerate(doc):
        try:
            images = page.get_images(full=True)
        except Exception:
            continue

        for img_info in images:
            xref = img_info[0]
            if xref in seen_xrefs:
                continue
            seen_xrefs.add(xref)

            try:
                base_image = doc.extract_image(xref)
                if base_image is None:
                    continue
                raw_bytes = base_image["image"]
                img_ext   = base_image.get("ext", "png")

                png_bytes, w, h = _to_png_bytes(raw_bytes, img_ext)
                text = _process_single_image(
                    png_bytes, w, h,
                    filename=filename,
                    page=str(page_idx + 1),
                    idx=global_img_idx,
                    folder_code=folder_code,
                    source_path=source_path,
                )
                global_img_idx += 1

                if text is None:
                    continue

                sections.append({
                    "section_id":    f"img_p{page_idx + 1}_{global_img_idx}",
                    "page_or_sheet": str(page_idx + 1),
                    "text":          text,
                    "section_title": "",
                })

            except Exception:
                continue  # 单张图片失败不影响其他

    return sections


def _extract_pdf_sections(file_record: dict) -> List[dict]:
    """PDF 文本提取：返回 section 列表（不分块）。含嵌入式图片提取。"""
    try:
        import fitz
        doc      = fitz.open(file_record["file_path"])
        pdf_type = classify_pdf(doc)
        source_path = file_record.get("relative_path", file_record.get("file_name", ""))
        if pdf_type in ("ppt", "scanned"):
            text_sections = ocr_pdf(doc, source_path=source_path)
        else:
            text_sections = parse_normal_pdf(doc)
        img_sections = _extract_pdf_images(doc, file_record)
        return text_sections + img_sections
    except Exception as e:
        print(f"  [警告] PDF 提取失败：{file_record['file_name']} — {e}")
        return []


def extract_pdf(file_record: dict) -> List[dict]:
    """
    PDF 提取对外入口。
    自动判断类型（normal / ppt / scanned）并分发到对应提取函数。
    异常时打印警告并返回空列表，不向外抛出。
    """
    sections = _extract_pdf_sections(file_record)
    if not sections:
        return []
    _max, _min = chunk_params("pdf")
    return make_chunks_from_sections(sections, file_record,
                                     max_size=_max, min_size=_min)


# ==============================================================================
# 2-2  DOCX 提取
# ==============================================================================

# 识别"标题段落"的两种信号：
#   1. 段落 style.name 包含 "Heading" 或 "标题"（标准 Word 样式）
#   2. 段落文本匹配数字/汉字编号前缀，且字数 ≤ 80
#
# 注意：此正则匹配所有层级（1. / 1.1 / 1.1.1），层级裁剪由 parse_docx 动态决定。
_HEADING_STYLE_RE = re.compile(r'[Hh]eading|标题|\bTitle\b', re.IGNORECASE)
_HEADING_TEXT_RE  = re.compile(
    r'^(?:'
    r'\d+(?:\.\d+)*[\.、\s]'       # 1. / 1.1 / 1.1.1 等多级数字编号
    r'|[一二三四五六七八九十]+[\.、\s]'  # 一、 二、 等汉字编号
    r'|第[一二三四五六七八九十百\d]+[章节条款]'  # 第一章 / 第2节
    r')'
)


def _heading_numeric_level(text: str) -> int:
    """
    从标题文本推断数字编号层级（点分层级数）。
    "1.目的" → 1，"3.1 总经理" → 2，"6.2.2.1 熟悉…" → 4
    汉字编号/第X章 → 1
    无法识别 → 0
    """
    m = re.match(r'^(\d+(?:\.\d+)*)[\.、\s]', text)
    if m:
        return len(m.group(1).split('.'))
    if re.match(r'^(?:[一二三四五六七八九十]+[\.、\s]|第[一二三四五六七八九十百\d]+[章节条款])', text):
        return 1
    return 0


def _is_heading_para(para) -> bool:
    """判断 python-docx Paragraph 是否为标题段落（任意层级）。"""
    style_name = para.style.name if para.style else ""
    if _HEADING_STYLE_RE.search(style_name):
        return True
    text = para.text.strip()
    if not text or len(text) > DOCX_HEADING_MAX_CHARS:
        return False
    return bool(_HEADING_TEXT_RE.match(text))


def _detect_max_heading_level(element_records: list) -> int:
    """
    扫描元素记录，返回所有标题段落中最深的数字编号层级。
    Word Heading 样式的段落也纳入计算（视为层级 1）。
    """
    max_lv = 0
    for rec in element_records:
        if not rec.get("is_title"):
            continue
        lv = rec.get("heading_level", 0)
        if lv > max_lv:
            max_lv = lv
    return max_lv


def _table_to_text(table) -> str:
    """
    将 python-docx Table 转换为可读文本。
    每行用制表符分隔单元格，行间用换行符分隔。
    合并单元格处理：
      - 列合并（colspan）：同行内 _tc 相同的单元格只取一次
      - 行合并（rowspan）：不同行间 _tc 可能相同，但每行独立去重，避免漏行
    """
    row_texts: List[str] = []
    for row in table.rows:
        seen_in_row: set = set()   # 只在行内去重，避免跨行合并误删整行
        cell_texts: List[str] = []
        for cell in row.cells:
            cell_id = id(cell._tc)
            if cell_id in seen_in_row:
                continue
            seen_in_row.add(cell_id)
            cell_text = cell.text.strip()
            if cell_text:
                cell_texts.append(cell_text)
        if cell_texts:
            row_texts.append("\t".join(cell_texts))
    return "\n".join(row_texts)


def _iter_body_elements(doc_obj):
    """
    按 Word 文档的原始顺序（XML 顺序）迭代段落与表格，
    保持表格在正文中的相对位置。
    每个元素返回 ("para", Paragraph) 或 ("table", Table)。
    """
    body = doc_obj.element.body
    para_iter  = iter(doc_obj.paragraphs)
    table_iter = iter(doc_obj.tables)

    cur_para  = next(para_iter,  None)
    cur_table = next(table_iter, None)

    for child in body:
        tag = child.tag.split("}")[-1] if "}" in child.tag else child.tag
        if tag == "p" and cur_para is not None and cur_para._element is child:
            yield ("para", cur_para)
            cur_para = next(para_iter, None)
        elif tag == "tbl" and cur_table is not None and cur_table._tbl is child:
            yield ("table", cur_table)
            cur_table = next(table_iter, None)


def parse_docx(doc_obj) -> List[dict]:
    """
    对 python-docx Document 对象按标题结构切 section，返回 section 列表。

    内容来源（按 XML 顺序遍历，保留原始位置）：
      - 段落：非空段落文本
      - 表格：转换为"单元格文本 tab 分隔"的多行文本，附加到当前 section

    动态层级切割策略：
      - 探测文档最大标题层级 max_level
      - max_level ≤ 2：用"第1层"标题切 section（现有逻辑）
      - max_level ≥ 3：用"第2层"标题切 section，
          第1层标题不触发切割，记入 section_title 字段（供对齐表审查上下文）

    无任何标题时整文件作一个 section（section_id="doc"）。
    """
    # ── 按 XML 顺序收集元素记录，标注标题层级 ──────────────────────────────────
    element_records: List[dict] = []
    for kind, elem in _iter_body_elements(doc_obj):
        if kind == "para":
            text = elem.text.strip()
            if not text:
                continue
            is_title = _is_heading_para(elem)
            lv = _heading_numeric_level(text) if is_title else 0
            # Word Heading 样式但无数字编号，视为第 1 层
            if is_title and lv == 0:
                lv = 1
            element_records.append({
                "is_title":      is_title,
                "heading_level": lv,
                "text":          text,
            })
        else:  # table
            tbl_text = _table_to_text(elem)
            if not tbl_text.strip():
                continue
            element_records.append({
                "is_title":      False,
                "heading_level": 0,
                "text":          tbl_text,
            })

    if not element_records:
        return []

    # ── 无标题：整文件作一个 section ─────────────────────────────────────────
    if not any(r["is_title"] for r in element_records):
        full_text = "\n".join(r["text"] for r in element_records)
        sections = [{"section_id": "doc", "page_or_sheet": "1",
                     "text": full_text, "section_title": ""}]
        return sections

    # ── 动态确定切割层级 ──────────────────────────────────────────────────────
    max_level = _detect_max_heading_level(element_records)
    # max_level ≤ 2：用第1层切；max_level ≥ 3：用第2层切
    cut_level = 1 if max_level <= 2 else 2

    # ── 按 cut_level 切割 section ────────────────────────────────────────────
    sections:      List[dict] = []
    current_l1     = ""   # 第1层标题（仅 cut_level=2 时用作 section_title）
    current_title  = ""   # 当前 section 的标题行
    body_parts:    List[str] = []
    counter        = 0

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

    for rec in element_records:
        if not rec["is_title"]:
            body_parts.append(rec["text"])
            continue

        lv = rec["heading_level"]

        if cut_level == 1:
            # 所有标题都触发切割
            _flush()
            current_title = rec["text"]
            body_parts    = []
        else:
            # cut_level == 2
            if lv == 1:
                # 第1层：不切，更新 l1 上下文；将标题文本并入当前 body
                _flush()
                current_l1    = rec["text"]
                current_title = ""
                body_parts    = [rec["text"]]  # l1 标题保留在正文开头
            elif lv == 2:
                # 第2层：触发切割
                _flush()
                current_title = rec["text"]
                body_parts    = []
            else:
                # 第3层及以下：不切，作为正文保留
                body_parts.append(rec["text"])

    _flush()

    return sections


def _extract_docx_images(file_path: str, file_record: dict) -> List[dict]:
    """
    从 DOCX 中提取嵌入式图片（word/media/ 目录下的文件）。

    原理：.docx 是 ZIP 格式，word/media/ 下存放所有嵌入图片。
    直接解压读取，避免依赖 InlineShape（python-docx 对图片支持有限）。
    跳过 EMF/WMF 矢量格式（Pillow 不支持）。

    返回 image section 列表，section_id 格式："img_d_{idx}"
    """
    import zipfile

    sections: List[dict] = []
    filename    = file_record.get("file_name", "")
    folder_code = file_record.get("folder_code")
    source_path = file_record.get("relative_path", filename)
    _IMG_EXTS = {"png", "jpg", "jpeg", "bmp", "tiff", "gif"}

    try:
        with zipfile.ZipFile(file_path, "r") as zf:
            media_files = sorted([
                n for n in zf.namelist()
                if n.startswith("word/media/")
                and n.rsplit(".", 1)[-1].lower() in _IMG_EXTS
            ])

            for idx, media_path in enumerate(media_files):
                try:
                    raw_bytes = zf.read(media_path)
                    media_ext = media_path.rsplit(".", 1)[-1].lower()

                    png_bytes, w, h = _to_png_bytes(raw_bytes, media_ext)
                    text = _process_single_image(
                        png_bytes, w, h,
                        filename=filename,
                        page="1",
                        idx=idx,
                        folder_code=folder_code,
                        source_path=source_path,
                    )

                    if text is None:
                        continue

                    sections.append({
                        "section_id":    f"img_d_{idx + 1}",
                        "page_or_sheet": "1",
                        "text":          text,
                        "section_title": "",
                    })
                except Exception:
                    continue
    except Exception:
        pass  # ZIP 打开失败（可能不是有效 DOCX）

    return sections


def _extract_docx_sections(file_record: dict) -> List[dict]:
    """DOCX 文本提取：返回 section 列表（不分块）。含嵌入式图片提取。"""
    try:
        import docx
        doc = docx.Document(file_record["file_path"])
        text_sections = parse_docx(doc)
        img_sections  = _extract_docx_images(file_record["file_path"], file_record)
        return text_sections + img_sections
    except Exception as e:
        print(f"  [警告] DOCX 提取失败：{file_record['file_name']} — {e}")
        return []


def extract_docx(file_record: dict) -> List[dict]:
    """
    .docx 提取对外入口。
    使用 python-docx 解析文档结构，按标题切 section。
    异常时打印警告并返回空列表，不向外抛出。
    """
    sections = _extract_docx_sections(file_record)
    if not sections:
        return []
    _max, _min = chunk_params("docx")
    return make_chunks_from_sections(sections, file_record,
                                     max_size=_max, min_size=_min)


# ==============================================================================
# 2-3  DOC 提取（LibreOffice 转换）
# ==============================================================================

# LibreOffice 转换输出的临时目录
_DOC_TMP_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'processed', '_doc_tmp')

# 懒加载警告：避免重复打印 LibreOffice 缺失提示
_soffice_warned = False


def _soffice_available() -> bool:
    """检查 soffice（LibreOffice）是否在 PATH 中可用。"""
    import shutil
    return shutil.which("soffice") is not None


def convert_doc_to_docx(doc_path: str) -> str | None:
    """
    用 LibreOffice 将 .doc 转换为 .docx，返回转换后的文件路径。
    转换失败返回 None。
    输出文件放在 _DOC_TMP_DIR 临时目录，调用方负责清理（或保留缓存）。
    """
    global _soffice_warned
    if not _soffice_available():
        if not _soffice_warned:
            print("  [警告] 未找到 soffice（LibreOffice），.doc 文件将跳过文本提取。")
            print("         安装方式：sudo apt install libreoffice-core libreoffice-writer")
            _soffice_warned = True
        return None

    import subprocess
    os.makedirs(_DOC_TMP_DIR, exist_ok=True)

    try:
        result = subprocess.run(
            ["soffice", "--headless", "--convert-to", "docx",
             "--outdir", _DOC_TMP_DIR, doc_path],
            capture_output=True, text=True, timeout=SOFFICE_DOC_TIMEOUT,
        )
        if result.returncode != 0:
            print(f"  [警告] soffice 转换失败（returncode={result.returncode}）："
                  f"{os.path.basename(doc_path)}")
            return None

        # 输出文件名 = 原文件名 stem + .docx
        stem    = os.path.splitext(os.path.basename(doc_path))[0]
        out_path = os.path.join(_DOC_TMP_DIR, stem + ".docx")
        if os.path.exists(out_path):
            return out_path

        print(f"  [警告] soffice 转换后未找到输出文件：{out_path}")
        return None
    except subprocess.TimeoutExpired:
        print(f"  [警告] soffice 转换超时：{os.path.basename(doc_path)}")
        return None
    except Exception as e:
        print(f"  [警告] soffice 转换异常：{os.path.basename(doc_path)} — {e}")
        return None


def _extract_doc_sections(file_record: dict) -> List[dict]:
    """DOC 文本提取：LibreOffice 转 .docx 后提取 sections（不分块）。"""
    docx_path = convert_doc_to_docx(file_record["file_path"])
    if docx_path is None:
        return []
    tmp_record = dict(file_record)
    tmp_record["file_path"] = docx_path
    return _extract_docx_sections(tmp_record)


def extract_doc(file_record: dict) -> List[dict]:
    """
    .doc 提取对外入口。
    先用 LibreOffice 转换为 .docx，再复用 extract_docx()。
    LibreOffice 不可用或转换失败时返回空列表（路径编码标签仍保留）。
    """
    sections = _extract_doc_sections(file_record)
    if not sections:
        return []
    _max, _min = chunk_params("docx")
    return make_chunks_from_sections(sections, file_record,
                                     max_size=_max, min_size=_min)


# ==============================================================================
# 2-4  XLSX / XLS 提取（openpyxl / xlrd）
# ==============================================================================

def _sheet_to_text(sheet_obj, fmt: str) -> str:
    """
    将单张 sheet 转换为可读文本。

    格式：单元格间 Tab 分隔，行间换行，与 _table_to_text() 保持一致。
    空行（所有单元格均为空）跳过。

    fmt:
        "xlsx" — openpyxl Worksheet（iter_rows(values_only=True)）
        "xls"  — xlrd Sheet（row_values(i)）
    """
    row_texts: List[str] = []

    if fmt == "xlsx":
        for row in sheet_obj.iter_rows(values_only=True):
            cell_texts = [str(v).strip() for v in row if v is not None and str(v).strip()]
            if cell_texts:
                row_texts.append("\t".join(cell_texts))
    else:  # xls
        for i in range(sheet_obj.nrows):
            cell_texts = [str(v).strip() for v in sheet_obj.row_values(i)
                          if v is not None and str(v).strip()]
            if cell_texts:
                row_texts.append("\t".join(cell_texts))

    return "\n".join(row_texts)


def parse_xlsx(workbook, fmt: str) -> List[dict]:
    """
    对 openpyxl Workbook 或 xlrd Workbook 对象，
    按 sheet 切 section，返回 section 列表。

    section 划分规则：
        每个有内容的 Sheet = 1 个 section
        section_id    = "s{i}"（i 为 sheet 的从零开始的索引）
        page_or_sheet = sheet 名称
        section_title = ""（Excel 无标题层级）

    空 sheet（text 无有效字符）在此处直接过滤。
    """
    sections: List[dict] = []

    if fmt == "xlsx":
        for i, name in enumerate(workbook.sheetnames):
            ws = workbook[name]
            text = _sheet_to_text(ws, "xlsx")
            if not count_meaningful_chars(text):
                continue  # 空 sheet，跳过
            sections.append({
                "section_id":    f"s{i}",
                "page_or_sheet": name,
                "text":          text,
                "section_title": "",
            })
    else:  # xls
        for i in range(workbook.nsheets):
            ws = workbook.sheet_by_index(i)
            text = _sheet_to_text(ws, "xls")
            if not count_meaningful_chars(text):
                continue  # 空 sheet，跳过
            sections.append({
                "section_id":    f"s{i}",
                "page_or_sheet": ws.name,
                "text":          text,
                "section_title": "",
            })

    return sections


def _extract_xlsx_sections(file_record: dict) -> List[dict]:
    """XLSX 文本提取：返回 section 列表（不分块）。"""
    try:
        import openpyxl
        wb = openpyxl.load_workbook(file_record["file_path"],
                                     read_only=True, data_only=True)
        return parse_xlsx(wb, "xlsx")
    except Exception as e:
        print(f"  [警告] XLSX 提取失败：{file_record['file_name']} — {e}")
        return []


def _extract_xls_sections(file_record: dict) -> List[dict]:
    """XLS 文本提取：返回 section 列表（不分块）。"""
    try:
        import xlrd
        wb = xlrd.open_workbook(file_record["file_path"])
        return parse_xlsx(wb, "xls")
    except Exception as e:
        print(f"  [警告] XLS 提取失败：{file_record['file_name']} — {e}")
        return []


def extract_xlsx(file_record: dict) -> List[dict]:
    """
    .xlsx 提取对外入口。
    使用 openpyxl 逐 sheet 读取，每 sheet 作一个 section。
    异常时打印警告并返回空列表，不向外抛出。
    """
    sections = _extract_xlsx_sections(file_record)
    if not sections:
        return []
    _max, _min = chunk_params("xlsx")
    return make_chunks_from_sections(sections, file_record,
                                     max_size=_max, min_size=_min)


def extract_xls(file_record: dict) -> List[dict]:
    """
    .xls 提取对外入口。
    使用 xlrd 逐 sheet 读取，每 sheet 作一个 section。
    异常时打印警告并返回空列表，不向外抛出。
    """
    sections = _extract_xls_sections(file_record)
    if not sections:
        return []
    _max, _min = chunk_params("xlsx")
    return make_chunks_from_sections(sections, file_record,
                                     max_size=_max, min_size=_min)


# ==============================================================================
# 2-5  PPTX / PPT 提取（python-pptx / LibreOffice 转换）
# ==============================================================================

_PPT_TMP_DIR        = os.path.join(os.path.dirname(__file__), '..', 'data', 'processed', '_ppt_tmp')
_soffice_ppt_warned = False


def _slide_to_text(slide) -> str:
    """
    提取单张 slide 的全部文本。

    处理规则：
    - 文本框 / placeholder（has_text_frame=True）：段落间 \\n 连接，shape 间 \\n\\n 分隔
    - 分组（shape_type == 6）：递归遍历内部子 shape，子 shape 规则同上
    - 表格（shape_type == 19）：cell 间 \\t，行间 \\n，与 _table_to_text() 格式一致
    - 图片（shape_type == 13）等无文本 shape：静默跳过

    shape 提取顺序按 slide 内 XML 自然顺序（slide.shapes）。
    """
    parts: List[str] = []

    def _collect(shapes_iter) -> None:
        for shape in shapes_iter:
            if shape.has_text_frame:
                paras = [p.text for p in shape.text_frame.paragraphs if p.text.strip()]
                if paras:
                    parts.append("\n".join(paras))
            elif shape.shape_type == 6:    # GROUP — 递归展开
                try:
                    _collect(shape.shapes)
                except Exception:
                    pass                   # 无法迭代的 GROUP 静默跳过
            elif shape.shape_type == 19:   # MSO_SHAPE_TYPE.TABLE == 19
                row_texts: List[str] = []
                for row in shape.table.rows:
                    cells = [cell.text.strip() for cell in row.cells if cell.text.strip()]
                    if cells:
                        row_texts.append("\t".join(cells))
                if row_texts:
                    parts.append("\n".join(row_texts))
            # shape_type == 13（PICTURE）及其他无文本 shape：静默跳过

    _collect(slide.shapes)

    return "\n\n".join(parts)


def parse_pptx(prs) -> List[dict]:
    """
    对 python-pptx Presentation 对象，按 slide 切 section，返回 section 列表。

    每张非空 slide = 1 个 section：
        section_id    = f"s{i}"（slide 索引，从 0 计数）
        page_or_sheet = str(i + 1)（物理页码，从 1 计数）
        section_title = ""（PPT 无层级标题概念）

    空 slide（有效字符为 0）提前跳过。
    """
    sections: List[dict] = []

    for i, slide in enumerate(prs.slides):
        text = _slide_to_text(slide)
        if not count_meaningful_chars(text):
            continue  # 空 slide（纯图片页等），跳过
        sections.append({
            "section_id":    f"s{i}",
            "page_or_sheet": str(i + 1),
            "text":          text,
            "section_title": "",
        })

    return sections


def _extract_pptx_images(prs, file_record: dict) -> List[dict]:
    """
    从 PPTX 中提取图片 shape（shape_type==13 即 PICTURE）。

    逐 slide 遍历，对每个 PICTURE shape 读取 shape.image.blob。
    使用 SHA256(blob) 去重（同一张图多 slide 复用时只处理一次）。
    递归处理 GROUP（shape_type==6）内嵌套的图片。

    返回 image section 列表，section_id 格式："img_s{slide}_{idx}"
    """
    import hashlib

    sections: List[dict] = []
    filename    = file_record.get("file_name", "")
    folder_code = file_record.get("folder_code")
    source_path = file_record.get("relative_path", filename)
    seen_hashes: set = set()
    global_counter = [0]  # 用列表便于闭包修改

    def _collect_pictures(shapes_iter, slide_idx: int):
        for shape in shapes_iter:
            if shape.shape_type == 13:  # PICTURE
                try:
                    blob = shape.image.blob
                    blob_hash = hashlib.sha256(blob).hexdigest()
                    if blob_hash in seen_hashes:
                        continue
                    seen_hashes.add(blob_hash)

                    png_bytes, w, h = _to_png_bytes(blob)
                    text = _process_single_image(
                        png_bytes, w, h,
                        filename=filename,
                        page=str(slide_idx + 1),
                        idx=global_counter[0],
                        folder_code=folder_code,
                        source_path=source_path,
                    )
                    global_counter[0] += 1

                    if text is None:
                        continue

                    sections.append({
                        "section_id":    f"img_s{slide_idx + 1}_{global_counter[0]}",
                        "page_or_sheet": str(slide_idx + 1),
                        "text":          text,
                        "section_title": "",
                    })
                except Exception:
                    continue
            elif shape.shape_type == 6:  # GROUP — 递归展开
                try:
                    _collect_pictures(shape.shapes, slide_idx)
                except Exception:
                    pass

    for i, slide in enumerate(prs.slides):
        _collect_pictures(slide.shapes, i)

    return sections


def _extract_pptx_sections(file_record: dict) -> List[dict]:
    """PPTX 文本提取：返回 section 列表（不分块）。含图片提取。"""
    try:
        from pptx import Presentation
        prs = Presentation(file_record["file_path"])
        text_sections = parse_pptx(prs)
        img_sections  = _extract_pptx_images(prs, file_record)
        return text_sections + img_sections
    except Exception as e:
        print(f"  [警告] PPTX 提取失败：{file_record['file_name']} — {e}")
        return []


def _extract_ppt_sections(file_record: dict) -> List[dict]:
    """PPT 文本提取：LibreOffice 转 .pptx 后提取 sections（不分块）。"""
    pptx_path = convert_ppt_to_pptx(file_record["file_path"])
    if pptx_path is None:
        return []
    tmp_record = dict(file_record)
    tmp_record["file_path"] = pptx_path
    return _extract_pptx_sections(tmp_record)


def extract_pptx(file_record: dict) -> List[dict]:
    """
    .pptx 提取对外入口。
    使用 python-pptx 逐 slide 读取，每 slide 作一个 section。
    异常时打印警告并返回空列表，不向外抛出。
    """
    sections = _extract_pptx_sections(file_record)
    if not sections:
        return []
    _max, _min = chunk_params("pptx")
    return make_chunks_from_sections(sections, file_record,
                                     max_size=_max, min_size=_min)


def convert_ppt_to_pptx(ppt_path: str) -> str | None:
    """
    用 LibreOffice 将 .ppt 转换为 .pptx，返回转换后的文件路径。
    转换失败返回 None。
    输出文件放在 _PPT_TMP_DIR 临时目录，调用方负责清理（或保留缓存）。
    """
    global _soffice_ppt_warned
    if not _soffice_available():
        if not _soffice_ppt_warned:
            print("  [警告] 未找到 soffice（LibreOffice），.ppt 文件将跳过文本提取。")
            print("         安装方式：sudo apt install libreoffice-core libreoffice-impress")
            _soffice_ppt_warned = True
        return None

    import subprocess
    os.makedirs(_PPT_TMP_DIR, exist_ok=True)

    try:
        result = subprocess.run(
            ["soffice", "--headless", "--convert-to", "pptx",
             "--outdir", _PPT_TMP_DIR, ppt_path],
            capture_output=True, text=True, timeout=SOFFICE_PPT_TIMEOUT,
        )
        if result.returncode != 0:
            print(f"  [警告] soffice 转换失败（returncode={result.returncode}）："
                  f"{os.path.basename(ppt_path)}")
            return None

        stem     = os.path.splitext(os.path.basename(ppt_path))[0]
        out_path = os.path.join(_PPT_TMP_DIR, stem + ".pptx")
        if os.path.exists(out_path):
            return out_path

        print(f"  [警告] soffice 转换后未找到输出文件：{out_path}")
        return None
    except subprocess.TimeoutExpired:
        print(f"  [警告] soffice 转换超时：{os.path.basename(ppt_path)}")
        return None
    except Exception as e:
        print(f"  [警告] soffice 转换异常：{os.path.basename(ppt_path)} — {e}")
        return None


def extract_ppt(file_record: dict) -> List[dict]:
    """
    .ppt 提取对外入口。
    先用 LibreOffice 转换为 .pptx，再复用 extract_pptx()。
    LibreOffice 不可用或转换失败时返回空列表（路径编码标签仍保留）。
    """
    sections = _extract_ppt_sections(file_record)
    if not sections:
        return []
    _max, _min = chunk_params("pptx")
    return make_chunks_from_sections(sections, file_record,
                                     max_size=_max, min_size=_min)


# ==============================================================================
# 2-6  JPG / PNG 提取（GLM-OCR）
# ==============================================================================

def _extract_image_sections(file_record: dict) -> List[dict]:
    """
    独立图片提取（JPG/PNG）— VLM 分类+描述优先，文档/表格追加 OCR。

    改进点（相比原版统一走 GLM-OCR）：
    - 原版：所有图片统一送 GLM-OCR → 照片/LOGO 返回乱码
    - 新版：VLM 分类+描述 → 文档/表格类追加 OCR → 组装 section
    - VLM 不可用时回退到原始 GLM-OCR 逻辑（向后兼容）
    """
    try:
        from PIL import Image
        import io

        img_path    = file_record["file_path"]
        filename    = file_record.get("file_name", "")
        folder_code = file_record.get("folder_code")
        source_path = file_record.get("relative_path", filename)

        with Image.open(img_path) as img:
            w, h = img.size
            buf = io.BytesIO()
            img.convert("RGB").save(buf, format="PNG")
            png_bytes = buf.getvalue()

        # 公共管线：过滤 → VLM 分类+描述 → 组装
        text = _process_single_image(
            png_bytes, w, h,
            filename=filename,
            page="1",
            idx=0,
            folder_code=folder_code,
            source_path=source_path,
        )

        if text is None:
            # VLM 不可用或被过滤 → 回退到 GLM-OCR（保持向后兼容）
            if _filter_image(png_bytes, w, h):
                text = call_glmocr(png_bytes)
            else:
                return []

        return [{
            "section_id":    "s0",
            "page_or_sheet": "1",
            "text":          text,
            "section_title": "",
        }]
    except Exception as e:
        print(f"  [警告] 图片提取失败：{file_record['file_name']} — {e}")
        return []


def extract_image(file_record: dict) -> List[dict]:
    """
    JPG / JPEG / PNG 提取对外入口。
    整张图片作一个 section，调用 GLM-OCR 识别文字。

    GLM-OCR 服务不可用（连接失败、超时等）时打印警告并返回空列表，不向外抛出。
    call_glmocr() 要求 PNG 格式，使用 Pillow 将 JPG 转换后传入。
    """
    sections = _extract_image_sections(file_record)
    if not sections:
        return []
    _max, _min = chunk_params("image")
    return make_chunks_from_sections(sections, file_record,
                                     max_size=_max, min_size=_min)


# 方便按扩展名路由的别名
extract_jpg  = extract_image
extract_jpeg = extract_image
extract_png  = extract_image


# ==============================================================================
# 统一 section 提取入口（供 align_evidence.py 阶段 2a 使用）
# ==============================================================================

_SECTION_EXTRACTOR_MAP = {
    ".pdf":  _extract_pdf_sections,
    ".docx": _extract_docx_sections,
    ".doc":  _extract_doc_sections,
    ".xlsx": _extract_xlsx_sections,
    ".xls":  _extract_xls_sections,
    ".pptx": _extract_pptx_sections,
    ".ppt":  _extract_ppt_sections,
    ".jpg":  _extract_image_sections,
    ".jpeg": _extract_image_sections,
    ".png":  _extract_image_sections,
}


def extract_sections(file_record: dict) -> list[dict] | None:
    """
    纯文本提取：返回 section 列表（不分块）。
    按文件扩展名分发到对应的 _extract_xxx_sections 函数。

    返回值：
        list[dict] — section 列表（可能为空列表 [] 表示提取失败或无内容）
        None       — 不支持的文件格式
    """
    ext = file_record.get("extension", "")
    extractor = _SECTION_EXTRACTOR_MAP.get(ext)
    if extractor is None:
        return None
    return extractor(file_record)
