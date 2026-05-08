"""
simulate_client_sorting.py
==========================
辅助工具：将零散原始资料按文件名/文件夹名中识别出的 ESG 编码，
复制到标准三级文件夹结构中。

适用场景：
  企业提供的原始资料未按标准文件夹整理，需要自动分类到
  generate_folder_structure.py 生成的标准目录结构中。

  真实项目中，企业通常可以直接按标准文件夹放置资料；
  本脚本适用于已有零散资料需要批量归类的情况。

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
  5. 路径中任意层包含 ESG 编码
  6. 均无法识别 → 兜底文件夹

过滤规则：
  - 跳过 macOS 隐藏文件（文件名以 . 或 ._ 开头）
  - 跳过 Thumbs.db / .DS_Store / .db 文件
  - 跳过清单文件本身（含"定性ESG报告资料清单"/"定量ESG报告资料清单"）
  - 跳过已存在于目标位置的文件（不覆盖）

多编码处理：
  一个文件识别到多个编码时，复制到每个对应编码文件夹（非移动）

运行方式：
    python3 tools/simulate_client_sorting.py \\
        --source-dir  "path/to/原始资料目录" \\
        --target-dir  "projects/示例企业_2025/raw/整理后资料" \\
        --company-name "示例企业"
"""

import os
import re
import sys
import shutil
import argparse
from datetime import datetime
from collections import defaultdict

# 将 src/ 目录加入路径，以便导入 esg_utils
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
sys.path.insert(0, os.path.join(_ROOT, "src"))

from esg_utils import (
    CODE_REGEX,
    DIMENSION_META,
    SUB_PREFIX_FALLBACK,
    should_skip_file,
    should_skip_content,
)

# ==============================================================================
# 常量
# ==============================================================================

DIMENSION_FOLDER = {k: v["folder"] for k, v in DIMENSION_META.items()}
FALLBACK_FOLDER = "【补充资料-不确定分类】"


# ==============================================================================
# 工具函数
# ==============================================================================

def should_skip(filename: str) -> bool:
    return should_skip_file(filename) or should_skip_content(filename)


def extract_all_codes(text: str) -> list:
    if not isinstance(text, str):
        return []
    found = [m.group(1).upper() for m in CODE_REGEX.finditer(text.upper())]
    seen = set()
    result = []
    for c in found:
        if c not in seen:
            seen.add(c)
            result.append(c)
    return result


def is_pure_code(name: str) -> bool:
    name = name.strip()
    return bool(re.fullmatch(r"[AGEDS][A-Z]{0,3}\d{1,3}", name, re.IGNORECASE))


def extract_codes_from_path_parts(path_parts: list) -> list:
    """
    从路径各分段（文件夹名列表，不含文件名）中提取编码。
    返回：[(code, confidence), ...]，confidence: 'high' / 'mid'
    """
    results = []
    seen = set()

    for part in reversed(path_parts):
        if is_pure_code(part):
            code = part.strip().upper()
            if code not in seen:
                seen.add(code)
                results.append((code, "high"))
        else:
            codes = extract_all_codes(part)
            for c in codes:
                if c not in seen:
                    seen.add(c)
                    results.append((c, "mid"))

    return results


def extract_codes_from_filename(filename: str) -> list:
    multi_pattern = re.compile(
        r"([AGEDS][A-Z]{0,3})(\d{1,2})"
        r"((?:[、,，]\d{1,2}(?!\d))+)",
        re.IGNORECASE
    )
    found = []
    seen = set()
    upper_fn = filename.upper()

    for m in multi_pattern.finditer(upper_fn):
        prefix = m.group(1).upper()
        first_num = m.group(2)
        rest = m.group(3)
        c = f"{prefix}{first_num}"
        if c not in seen:
            seen.add(c)
            found.append(c)
        for extra_num in re.findall(r"\d{1,2}", rest):
            ec = f"{prefix}{extra_num}"
            if ec not in seen:
                seen.add(ec)
                found.append(ec)

    for c in extract_all_codes(filename):
        if c not in seen:
            seen.add(c)
            found.append(c)

    return found


def get_target_subfolder(code: str, target_root: str) -> str:
    code = code.upper()
    m = re.match(r"^([A-Z]+)", code)
    sub_prefix = m.group(1) if m else code[0]
    dim_prefix = sub_prefix[0]

    dim_folder = DIMENSION_FOLDER.get(dim_prefix, f"{dim_prefix}-其他")

    if dim_prefix == "A":
        base = os.path.join(target_root, dim_folder)
    else:
        sub_folder = SUB_PREFIX_FALLBACK.get(sub_prefix, f"{sub_prefix}-议题")
        base = os.path.join(target_root, dim_folder, sub_folder)

    return _find_or_create_code_folder(base, code)


def _find_or_create_code_folder(base_dir: str, code: str) -> str:
    os.makedirs(base_dir, exist_ok=True)
    try:
        entries = os.listdir(base_dir)
    except PermissionError:
        entries = []

    for entry in entries:
        entry_path = os.path.join(base_dir, entry)
        if not os.path.isdir(entry_path):
            continue
        if re.match(rf"^{re.escape(code)}(\s|$)", entry, re.IGNORECASE):
            return entry_path

    new_folder = os.path.join(base_dir, code)
    os.makedirs(new_folder, exist_ok=True)
    return new_folder


def copy_file_safe(src: str, dst_dir: str, filename: str) -> str:
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
        self.skipped_sys  = 0
        self.copied       = 0
        self.dedup_skip   = 0
        self.unidentified = 0
        self.errors       = 0
        self.code_counts  = defaultdict(int)
        self.unidentified_list = []


def simulate_sorting(source_dir: str, target_dir: str, company_name: str):
    stats = SortingStats()
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    fallback_dir = os.path.join(target_dir, FALLBACK_FOLDER)

    print("=" * 60)
    print(f"  ESG 资料整理工具")
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

    for current_root, dirs, files in os.walk(source_dir):
        dirs[:] = [d for d in dirs if not d.startswith(".")]

        for filename in files:
            stats.total_files += 1

            if should_skip(filename):
                stats.skipped_sys += 1
                continue

            abs_path = os.path.join(current_root, filename)
            rel_path = os.path.relpath(abs_path, source_dir)
            path_parts = rel_path.split(os.sep)
            folder_parts = path_parts[:-1]

            codes = []
            folder_codes = extract_codes_from_path_parts(folder_parts)
            high_conf = [c for c, conf in folder_codes if conf == "high"]
            mid_conf  = [c for c, conf in folder_codes if conf == "mid"]

            if high_conf:
                codes = [high_conf[-1]]
            elif mid_conf:
                codes = mid_conf[:3]
            else:
                fn_codes = extract_codes_from_filename(filename)
                if fn_codes:
                    codes = fn_codes[:3]

            if not codes:
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
                for code in codes:
                    code_dir = get_target_subfolder(code, target_dir)
                    result = copy_file_safe(abs_path, code_dir, filename)
                    if result == "copied":
                        stats.copied += 1
                        stats.code_counts[code] += 1
                        rel_target = os.path.relpath(code_dir, target_dir)
                        print(f"  [{code}] {filename}  →  {rel_target}/")
                    elif result == "skipped":
                        stats.dedup_skip += 1
                    else:
                        stats.errors += 1
                        print(f"  [错误] {rel_path} → 编码={code} → {result}")

    print("\n" + "=" * 60)
    print("  整理完成 - 统计报告")
    print("=" * 60)
    print(f"  扫描文件总数:       {stats.total_files}")
    print(f"  跳过(系统/隐藏):   {stats.skipped_sys}")
    print(f"  成功复制:           {stats.copied}")
    print(f"  已存在跳过:         {stats.dedup_skip}")
    print(f"  复制失败:           {stats.errors}")
    print(f"  无法识别编码(兜底): {stats.unidentified}")

    if stats.code_counts:
        print("\n  各编码文件数量（Top 20）：")
        for code, cnt in sorted(stats.code_counts.items())[:20]:
            print(f"    {code:8s}  {cnt} 个文件")

    if stats.unidentified_list:
        print(f"\n  ⚠️  无法识别的文件 ({len(stats.unidentified_list)} 个)，已放入兜底文件夹：")
        for rel_path, _ in stats.unidentified_list[:30]:
            print(f"    · {rel_path}")

    print(f"\n  ✅ 整理后资料目录：{target_dir}")
    print("=" * 60)

    log_path = os.path.join(target_dir, f"整理日志_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt")
    with open(log_path, "w", encoding="utf-8") as f:
        f.write(f"ESG 资料整理日志\n")
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
    parser = argparse.ArgumentParser(
        description="将零散原始资料按 ESG 编码分类复制到标准文件夹结构"
    )
    parser.add_argument(
        "--source-dir", required=True,
        help="原始资料目录（零散的未分类文件）"
    )
    parser.add_argument(
        "--target-dir", required=True,
        help="目标目录（对应 projects/<企业>_<年份>/raw/整理后资料/）"
    )
    parser.add_argument(
        "--company-name", default="未命名企业",
        help="公司名称（仅用于日志显示）"
    )
    args = parser.parse_args()

    simulate_sorting(
        source_dir=args.source_dir,
        target_dir=args.target_dir,
        company_name=args.company_name,
    )


if __name__ == "__main__":
    main()
