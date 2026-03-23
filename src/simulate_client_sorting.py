"""
simulate_client_sorting.py
==========================
一次性模拟工具：将"第一轮资料收集"中的现有文件，
按文件名/文件夹名中识别出的ESG编码，复制到标准文件夹结构中。

仅用于本次验证任务，走通完整流程。真实项目中甲方会直接按标准文件夹放文件。

编码识别优先级（从高到低）：
  1. 文件所在文件夹名本身即为纯编码：SD1/ → SD1
  2. 上级路径中存在纯编码文件夹：DC/DC1/ → DC1
  3. 文件名前缀为编码+分隔符：
       "EB2、文件名"    → EB2
       "EB11：文件名"   → EB11
       "DA8-描述文字"   → DA8
       "GB9、11、16-文件名" → GB9（主）,GB11,GB16（副）
  4. 路径各部分（含文件夹名）含编码前缀+描述：
       "DA10-公司知识产权..." → DA10
       "DA8-报告期内..." → DA8
  5. 路径中任意层包含ESG编码
  6. 文件名本身含编码：
       "GB9、11、16-文件名" → 多编码
       "劳工权益SC-SC1-文件名" → SC1
  7. 均无法识别 → 兜底文件夹

过滤规则：
  - 跳过 macOS 隐藏文件（文件名以 . 或 ._ 开头）
  - 跳过 Thumbs.db / .DS_Store / .db 文件
  - 跳过清单文件本身（含"定性ESG报告资料清单"/"定量ESG报告资料清单"）
  - 跳过已存在于目标位置的文件（不覆盖）

多编码处理：
  一个文件识别到多个编码时，复制到每个对应编码文件夹（非移动）

运行方式：
    python3 simulate_client_sorting.py

修改文件顶部配置变量后直接运行。
"""

import os
import re
import shutil
from datetime import datetime
from collections import defaultdict

# 公共工具函数统一从 esg_utils 导入
from esg_utils import (
    CODE_REGEX,
    DIMENSION_META,
    SUB_PREFIX_FALLBACK,
    SKIP_FILENAME_PATTERNS,
    SKIP_CONTENT_PATTERNS,
    should_skip_file,
    should_skip_content,
)

# ==============================================================================
# 用户配置：只改这里
# ==============================================================================
_HERE = os.path.dirname(os.path.abspath(__file__))  # src/ 目录
_ROOT = os.path.dirname(_HERE)                       # 项目根目录

SOURCE_DIR = os.path.join(_ROOT, "data/raw/第一轮资料收集")
TARGET_DIR = os.path.join(_ROOT, "data/processed/模拟甲方整理后资料")

# 目标目录的层级说明（对应脚本1生成的文件夹结构）
# 脚本会自动按编码前缀映射到对应的一/二级目录
COMPANY_NAME = "艾森股份"
# ==============================================================================


# ==============================================================================
# 常量与映射表
# ==============================================================================

# 从 DIMENSION_META 构建简单的 前缀→文件夹名 映射（兼容原有引用方式）
DIMENSION_FOLDER = {k: v["folder"] for k, v in DIMENSION_META.items()}

FALLBACK_FOLDER = "【补充资料-不确定分类】"


# ==============================================================================
# 工具函数
# ==============================================================================

def should_skip(filename: str) -> bool:
    """判断是否应跳过此文件（系统文件 + 清单文件）"""
    return should_skip_file(filename) or should_skip_content(filename)


def extract_all_codes(text: str) -> list:
    """从字符串中提取所有ESG编码（去重，保持顺序）"""
    if not isinstance(text, str):
        return []
    found = [m.group(1).upper() for m in CODE_REGEX.finditer(text.upper())]
    # 去重，保持首次出现顺序
    seen = set()
    result = []
    for c in found:
        if c not in seen:
            seen.add(c)
            result.append(c)
    return result


def is_pure_code(name: str) -> bool:
    """
    判断字符串是否是纯编码（如 SD1、GB11、EB10 等）
    允许有少量后缀空格，不允许其他内容
    """
    name = name.strip()
    return bool(re.fullmatch(r"[AGEDS][A-Z]{0,3}\d{1,3}", name, re.IGNORECASE))


def extract_codes_from_path_parts(path_parts: list) -> list:
    """
    从路径各分段（文件夹名列表，不含文件名）中提取编码。
    策略：
      1. 找到最深层的纯编码文件夹 → 高置信度
      2. 找到路径中含编码前缀+描述的文件夹 → 中置信度
      3. 路径中任意层含编码 → 低置信度
    返回：[(code, confidence), ...]，confidence: 'high' / 'mid' / 'low'
    """
    results = []
    seen = set()

    # 从最深层往上扫描文件夹名（不含文件名本身）
    for part in reversed(path_parts):
        if is_pure_code(part):
            code = part.strip().upper()
            if code not in seen:
                seen.add(code)
                results.append((code, "high"))
        else:
            # 检测 "CODEXXX-描述" 或 "CODEXXX、描述" 等格式
            codes = extract_all_codes(part)
            for c in codes:
                if c not in seen:
                    seen.add(c)
                    results.append((c, "mid"))

    return results


def extract_codes_from_filename(filename: str) -> list:
    """
    从文件名中提取编码。
    常见模式：
      "EB2、ASNT-PM-2-101..."  → [EB2]
      "EB9、EC5、..."           → [EB9, EC5]
      "GB9、11、16-文件名"      → [GB9, GB11, GB16]（重构多编码）
      "劳工权益SC-SC1-..."      → [SC1]
      "SD6、2025年公司..."      → [SD6]
    返回：[code, ...]
    """
    # 首先尝试识别 "前缀数字,数字,数字" 格式，如 "GB9、11、16"
    # 匹配：一个完整编码后跟"、数字"序列
    # 关键约束：后续数字必须是合理的ESG编码序号（1-99）且后面不能紧跟更多数字
    # 这防止"SD6、2025"被误解为 SD6 + SD202（2025中的前三位）
    multi_pattern = re.compile(
        r"([AGEDS][A-Z]{0,3})(\d{1,2})"         # 首个完整编码（序号1-99），如 GB9
        r"((?:[、,，]\d{1,2}(?!\d))+)",           # 后续的数字序列（限制1-99且不再跟数字），如 、11、16
        re.IGNORECASE
    )
    found = []
    seen = set()
    upper_fn = filename.upper()

    for m in multi_pattern.finditer(upper_fn):
        prefix = m.group(1).upper()
        first_num = m.group(2)
        rest = m.group(3)
        # 首个编码
        c = f"{prefix}{first_num}"
        if c not in seen:
            seen.add(c)
            found.append(c)
        # 后续数字（额外编码，同前缀）
        for extra_num in re.findall(r"\d{1,2}", rest):
            ec = f"{prefix}{extra_num}"
            if ec not in seen:
                seen.add(ec)
                found.append(ec)

    # 通用提取
    for c in extract_all_codes(filename):
        if c not in seen:
            seen.add(c)
            found.append(c)

    return found


def get_target_subfolder(code: str, target_root: str) -> str:
    """
    给定编码，返回目标文件夹路径（绝对路径）。
    路径格式：
      A类：TARGET_ROOT/A-总体概况/A1 .../
      其他：TARGET_ROOT/G-公司治理/GA-可持续发展治理/GA1 .../
    但此函数只负责到二级目录（含编码的那级由调用者保证已存在）。
    实际上：我们直接把文件放入 TARGET_ROOT/DIM/SUB/CODE/ 或 TARGET_ROOT/DIM/CODE/
    如果目标目录不存在（脚本1没有生成对应编码），则动态创建。
    """
    code = code.upper()
    m = re.match(r"^([A-Z]+)", code)
    sub_prefix = m.group(1) if m else code[0]
    dim_prefix = sub_prefix[0]

    dim_folder = DIMENSION_FOLDER.get(dim_prefix, f"{dim_prefix}-其他")

    if dim_prefix == "A":
        # A类直接在 A-总体概况/ 下找 A1 xxx/
        base = os.path.join(target_root, dim_folder)
    else:
        sub_folder = SUB_PREFIX_FALLBACK.get(sub_prefix, f"{sub_prefix}-议题")
        base = os.path.join(target_root, dim_folder, sub_folder)

    # 在 base 下找以 code 开头的文件夹（如 "GA1 可持续发展目标与愿景"）
    code_folder = _find_or_create_code_folder(base, code)
    return code_folder


def _find_or_create_code_folder(base_dir: str, code: str) -> str:
    """
    在 base_dir 下找到以 code 开头的文件夹；若不存在则直接创建 base_dir/code/。
    """
    os.makedirs(base_dir, exist_ok=True)
    try:
        entries = os.listdir(base_dir)
    except PermissionError:
        entries = []

    for entry in entries:
        entry_path = os.path.join(base_dir, entry)
        if not os.path.isdir(entry_path):
            continue
        # 匹配：文件夹名以 code 开头（后跟空格或结尾）
        if re.match(rf"^{re.escape(code)}(\s|$)", entry, re.IGNORECASE):
            return entry_path

    # 未找到，创建新文件夹
    new_folder = os.path.join(base_dir, code)
    os.makedirs(new_folder, exist_ok=True)
    return new_folder


def copy_file_safe(src: str, dst_dir: str, filename: str) -> str:
    """
    将 src 文件复制到 dst_dir/filename，若已存在则跳过。
    返回：'copied' / 'skipped' / 'error:...'
    """
    os.makedirs(dst_dir, exist_ok=True)
    dst_path = os.path.join(dst_dir, filename)
    if os.path.exists(dst_path):
        return "skipped"
    try:
        shutil.copy2(src, dst_path)
        return "copied"
    except Exception as e:
        return f"error:{e}"


# ==============================================================================
# 主扫描逻辑
# ==============================================================================

class SortingStats:
    def __init__(self):
        self.total_files  = 0
        self.skipped_sys  = 0   # 系统/临时文件
        self.copied       = 0
        self.dedup_skip   = 0   # 目标已存在
        self.unidentified = 0
        self.errors       = 0
        self.code_counts  = defaultdict(int)    # 每个编码复制了多少文件
        self.unidentified_list = []             # (原始路径, 相对路径)


def simulate_sorting(source_dir: str, target_dir: str, company_name: str):
    stats = SortingStats()
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    fallback_dir = os.path.join(target_dir, FALLBACK_FOLDER)

    print("=" * 60)
    print(f"  ESG资料整理模拟工具")
    print(f"  公司: {company_name}")
    print(f"  源目录: {source_dir}")
    print(f"  目标目录: {target_dir}")
    print(f"  时间: {stamp}")
    print("=" * 60)

    if not os.path.isdir(source_dir):
        print(f"❌ 源目录不存在: {source_dir}")
        return

    os.makedirs(target_dir, exist_ok=True)
    os.makedirs(fallback_dir, exist_ok=True)

    # 遍历源目录
    for current_root, dirs, files in os.walk(source_dir):
        # 过滤隐藏目录（以 . 开头）
        dirs[:] = [d for d in dirs if not d.startswith(".")]

        for filename in files:
            stats.total_files += 1

            # ── 过滤系统文件 ──────────────────────────────────
            if should_skip(filename):
                stats.skipped_sys += 1
                continue

            abs_path = os.path.join(current_root, filename)
            rel_path = os.path.relpath(abs_path, source_dir)
            path_parts = rel_path.split(os.sep)

            # path_parts[-1] = 文件名，path_parts[:-1] = 文件夹层级
            folder_parts = path_parts[:-1]  # 仅文件夹部分

            # ── 编码识别 ──────────────────────────────────────
            codes = []

            # 优先：从文件夹路径中提取（高置信度）
            folder_codes = extract_codes_from_path_parts(folder_parts)
            high_conf = [c for c, conf in folder_codes if conf == "high"]
            mid_conf  = [c for c, conf in folder_codes if conf == "mid"]

            if high_conf:
                # 纯编码文件夹名 → 直接采用，唯一来源
                codes = [high_conf[-1]]   # 取最深层
            elif mid_conf:
                # 文件夹名含编码描述
                codes = mid_conf[:3]      # 最多取3个
            else:
                # 从文件名提取
                fn_codes = extract_codes_from_filename(filename)
                if fn_codes:
                    codes = fn_codes[:3]

            # ── 分配到目标文件夹 ──────────────────────────────
            if not codes:
                # 无法识别 → 兜底
                result = copy_file_safe(abs_path, fallback_dir, filename)
                stats.unidentified += 1
                stats.unidentified_list.append((rel_path, "兜底"))
                if result == "copied":
                    stats.copied += 1
                    print(f"  [兜底] {rel_path}")
                elif result == "skipped":
                    stats.dedup_skip += 1
                else:
                    stats.errors += 1
                    print(f"  [错误] {rel_path} → {result}")
            else:
                any_copied = False
                for code in codes:
                    code_dir = get_target_subfolder(code, target_dir)
                    result = copy_file_safe(abs_path, code_dir, filename)
                    if result == "copied":
                        stats.copied += 1
                        stats.code_counts[code] += 1
                        any_copied = True
                        rel_target = os.path.relpath(code_dir, target_dir)
                        print(f"  [{code}] {filename}  →  {rel_target}/")
                    elif result == "skipped":
                        stats.dedup_skip += 1
                    else:
                        stats.errors += 1
                        print(f"  [错误] {rel_path} → 编码={code} → {result}")

    # ── 输出统计报告 ──────────────────────────────────────────
    print("\n" + "=" * 60)
    print("  整理完成 - 统计报告")
    print("=" * 60)
    print(f"  扫描文件总数:       {stats.total_files}")
    print(f"  跳过(系统/隐藏):   {stats.skipped_sys}")
    print(f"  成功复制:           {stats.copied}")
    print(f"  已存在跳过:         {stats.dedup_skip}")
    print(f"  复制失败:           {stats.errors}")
    print(f"  无法识别编码(兜底): {stats.unidentified}")
    print()

    if stats.code_counts:
        print("  各编码文件数量（Top 20）：")
        sorted_codes = sorted(stats.code_counts.items(), key=lambda x: x[0])
        for code, cnt in sorted_codes[:20]:
            print(f"    {code:8s}  {cnt} 个文件")
        if len(sorted_codes) > 20:
            print(f"    ... 共 {len(sorted_codes)} 个编码")

    if stats.unidentified_list:
        print(f"\n  ⚠️  无法识别的文件 ({len(stats.unidentified_list)} 个)，已放入兜底文件夹：")
        for rel_path, _ in stats.unidentified_list[:30]:
            print(f"    · {rel_path}")
        if len(stats.unidentified_list) > 30:
            print(f"    ... 共 {len(stats.unidentified_list)} 个")

    print()
    print(f"  ✅ 整理后资料目录：{target_dir}")
    print("=" * 60)

    # ── 写出日志文件 ──────────────────────────────────────────
    log_path = os.path.join(target_dir, f"整理日志_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt")
    with open(log_path, "w", encoding="utf-8") as f:
        f.write(f"ESG资料整理模拟日志\n")
        f.write(f"公司: {company_name}\n")
        f.write(f"时间: {stamp}\n")
        f.write(f"源目录: {source_dir}\n")
        f.write(f"目标目录: {target_dir}\n\n")
        f.write(f"扫描文件总数:       {stats.total_files}\n")
        f.write(f"跳过(系统/隐藏):   {stats.skipped_sys}\n")
        f.write(f"成功复制:           {stats.copied}\n")
        f.write(f"已存在跳过:         {stats.dedup_skip}\n")
        f.write(f"复制失败:           {stats.errors}\n")
        f.write(f"无法识别编码(兜底): {stats.unidentified}\n\n")
        if stats.code_counts:
            f.write("各编码文件数量：\n")
            for code, cnt in sorted(stats.code_counts.items()):
                f.write(f"  {code:8s}  {cnt}\n")
        if stats.unidentified_list:
            f.write(f"\n无法识别的文件：\n")
            for rel_path, _ in stats.unidentified_list:
                f.write(f"  {rel_path}\n")

    print(f"\n  日志已保存: {log_path}")


# ==============================================================================
# 程序入口
# ==============================================================================

def main():
    simulate_sorting(
        source_dir   = SOURCE_DIR,
        target_dir   = TARGET_DIR,
        company_name = COMPANY_NAME,
    )


if __name__ == "__main__":
    main()
