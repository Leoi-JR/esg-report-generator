"""
generate_folder_structure.py
============================
永久工具：读取【定性】ESG报告资料清单.xlsx，生成标准化空文件夹结构，
并打包为 ZIP，供企业按编码存放资料。

文件夹层级（三级）：
    【公司名称】ESG资料收集/
    ├── A-总体概况/
    │   ├── A1 企业LOGO与VI规范/
    │   │   └── 📋说明.txt
    │   └── ...
    ├── G-公司治理/
    │   ├── GA-可持续发展治理/
    │   │   ├── GA1 可持续发展目标与愿景/
    │   │   │   └── 📋说明.txt
    │   │   └── ...
    │   └── ...
    ├── E-环境保护/
    ├── D-产业价值/
    ├── S-人权与社会/
    ├── 【定量数据】/
    │   └── 📋说明.txt
    └── 【补充资料-不确定分类】/
        └── 📋说明.txt

运行方式（推荐，明确传参）：
    python3 generate_folder_structure.py \
        --company-name "公司名称" \
        --reference-excel "path/to/资料收集清单.xlsx" \
        --output-dir "path/to/output"

运行方式（使用项目模板，需先将清单放到 templates/ 目录）：
    python3 generate_folder_structure.py --company-name "公司名称"
"""

import os
import re
import sys
import tempfile
import warnings
import zipfile
from datetime import datetime

import pandas as pd

warnings.filterwarnings("ignore", category=UserWarning)

# 公共工具函数统一从 esg_utils 导入
from esg_utils import (
    CODE_REGEX,
    DIMENSION_META,
    SUB_PREFIX_FALLBACK,
    clean_text,
    is_blank,
    extract_code_from_string,
    find_col_idx_by_keywords,
    forward_fill_in_raw,
    unmerge_and_flatten_styles,
    find_header_row_for_reference,
)

# ==============================================================================
# 路径常量（不含企业特定信息）
# ==============================================================================
_HERE = os.path.dirname(os.path.abspath(__file__))  # src/ 目录
_ROOT = os.path.dirname(_HERE)                       # 项目根目录

# 默认指向 templates/ 目录的通用模板清单
_DEFAULT_REFERENCE_EXCEL = os.path.join(_ROOT, "templates", "资料收集清单.xlsx")
_DEFAULT_OUTPUT_DIR      = os.path.join(_ROOT, "output")
# ==============================================================================


# ==============================================================================
# 核心：从清单解析编码→(议题, 指标, 资料需求, 对接部门, 备注)
# ==============================================================================

def load_full_esg_info(reference_excel_path: str):
    """
    返回：list of dict，每条含：
        code        - 编码，如 GA1
        dim_prefix  - 维度首字母，如 G / A / E
        sub_prefix  - 子前缀，如 GA / A（A类无子议题）
        topic       - 议题
        indicator   - 指标
        requirement - 资料需求描述（资料列表列）
        department  - 对接部门
        remark      - 备注（乙方针对该指标的补充说明，有则写入说明.txt末尾，无则忽略）
    按 code 自然顺序排列（不保证去重——以最后一次为准）
    """
    if not os.path.exists(reference_excel_path):
        raise FileNotFoundError(f"找不到参考Excel: {reference_excel_path}")

    cleaned_path = os.path.join(tempfile.gettempdir(), "__gen_folder_ref_cleaned__.xlsx")
    unmerge_and_flatten_styles(reference_excel_path, cleaned_path)

    xls = pd.ExcelFile(cleaned_path)
    sheet_names = xls.sheet_names

    results = []

    for sh in sheet_names:
        df_raw = pd.read_excel(xls, sheet_name=sh, header=None, dtype=object)

        # ---- 定位表头 ----
        header_idx = find_header_row_for_reference(df_raw, search_rows=200)
        if header_idx is None:
            print(f"  [跳过] Sheet「{sh}」未找到表头行")
            continue

        col_topic     = find_col_idx_by_keywords(df_raw, header_idx, ["议题"])
        col_indicator = find_col_idx_by_keywords(df_raw, header_idx, ["指标"])
        col_serial    = find_col_idx_by_keywords(df_raw, header_idx, ["序号", "编号"])
        col_code      = find_col_idx_by_keywords(df_raw, header_idx, ["识别编码", "编码"])
        col_req       = find_col_idx_by_keywords(df_raw, header_idx, ["资料列表", "资料"])
        col_dept      = find_col_idx_by_keywords(df_raw, header_idx, ["对接部门", "部门"])
        col_remark    = find_col_idx_by_keywords(df_raw, header_idx, ["备注"])  # 乙方针对性补充说明

        # 向下填充议题/指标
        fill_cols = []
        for kw in ["议题", "指标"]:
            idx = find_col_idx_by_keywords(df_raw, header_idx, [kw])
            if idx is not None and idx not in fill_cols:
                fill_cols.append(idx)

        df_filled = forward_fill_in_raw(df_raw, start_row=header_idx + 1, col_indices=fill_cols)

        if header_idx + 1 >= df_filled.shape[0]:
            continue

        data_part = df_filled.iloc[header_idx + 1:].copy()

        for _, row in data_part.iterrows():
            # ---- 解析编码 ----
            code = None
            # 优先：识别编码/编码列
            if col_code is not None and col_code < len(row):
                v = row.iloc[col_code]
                if not is_blank(v):
                    code = extract_code_from_string(str(v))
            # 次选：序号列本身是编码
            if not code and col_serial is not None and col_serial < len(row):
                v = row.iloc[col_serial]
                if not is_blank(v):
                    code = extract_code_from_string(str(v))
            if not code:
                continue

            code = code.upper()

            # ---- 解析其他字段 ----
            topic = ""
            if col_topic is not None and col_topic < len(row):
                v = row.iloc[col_topic]
                topic = "" if is_blank(v) else str(v).strip()

            indicator = ""
            if col_indicator is not None and col_indicator < len(row):
                v = row.iloc[col_indicator]
                indicator = "" if is_blank(v) else str(v).strip()

            requirement = ""
            if col_req is not None and col_req < len(row):
                v = row.iloc[col_req]
                requirement = "" if is_blank(v) else str(v).strip()

            department = ""
            if col_dept is not None and col_dept < len(row):
                v = row.iloc[col_dept]
                department = "" if is_blank(v) else str(v).strip()

            # 备注：乙方针对该指标的补充说明，有内容时追加到说明.txt末尾
            remark = ""
            if col_remark is not None and col_remark < len(row):
                v = row.iloc[col_remark]
                remark = "" if is_blank(v) else str(v).strip()

            # 议题中常带括号注释如"可持续发展治理机制\n（GA）"，清理换行
            topic     = topic.replace("\n", " ").strip()
            indicator = indicator.replace("\n", " ").strip()

            dim_prefix = code[0].upper()
            # 子前缀：取编码中所有字母部分
            m = re.match(r"^([A-Z]+)", code)
            sub_prefix = m.group(1) if m else dim_prefix

            results.append({
                "code":        code,
                "dim_prefix":  dim_prefix,
                "sub_prefix":  sub_prefix,
                "topic":       topic,
                "indicator":   indicator,
                "requirement": requirement,
                "department":  department,
                "remark":      remark,
                "sheet":       sh,
            })

    # 按编码排序：先按维度字母顺序，再按数字
    def sort_key(r):
        c = r["code"]
        letters = re.match(r"^([A-Z]+)", c).group(1) if re.match(r"^([A-Z]+)", c) else c
        digits  = int(re.search(r"(\d+)$", c).group(1)) if re.search(r"(\d+)$", c) else 0
        return (letters, digits)

    results.sort(key=sort_key)
    return results


# ==============================================================================
# 清理文件夹名中的非法字符（macOS/Windows兼容）
# ==============================================================================

def sanitize_folder_name(name: str) -> str:
    """去除文件夹名中的非法字符"""
    # 去除换行、制表符
    name = name.replace("\n", " ").replace("\r", " ").replace("\t", " ")
    # 去除首位空白
    name = name.strip()
    # 替换常见非法字符（Windows兼容）
    for ch in r'\/:*?"<>|':
        name = name.replace(ch, " ")
    # 合并连续空格
    name = re.sub(r"\s{2,}", " ", name).strip()
    return name


# ==============================================================================
# 生成说明.txt 内容
# ==============================================================================

def make_readme_content(code, topic, indicator, requirement, department, remark) -> str:
    lines = [
        f"═══════════════════════════════════════",
        f"  ESG资料收集说明",
        f"═══════════════════════════════════════",
        f"",
        f"【编码】      {code}",
        f"【议题】      {topic or '—'}",
        f"【指标名称】  {indicator or '—'}",
        f"",
        f"【资料需求】",
    ]
    # 长需求文字折行（每80字换行）
    if requirement:
        for i in range(0, len(requirement), 80):
            lines.append(f"  {requirement[i:i+80]}")
    else:
        lines.append("  （请参考清单填写）")
    lines += [
        f"",
        f"【对接部门】  {department or '—'}",
        f"",
    ]
    # 备注：仅在有内容时输出，作为乙方针对该指标的补充说明
    if remark:
        lines += [
            f"【补充说明】",
        ]
        for i in range(0, len(remark), 80):
            lines.append(f"  {remark[i:i+80]}")
        lines.append(f"")
    lines += [
        f"═══════════════════════════════════════",
        f"填写提示：",
        f"  · 请将本编码对应的所有资料文件存放在此文件夹内",
        f"  · 文件名可自由命名，无需修改编码",
        f"  · 如有多个子项目资料，可在此文件夹内再建子文件夹",
        f"═══════════════════════════════════════",
    ]
    return "\n".join(lines)


# ==============================================================================
# 主函数：构建目录树 + 打包 ZIP
# ==============================================================================

def build_topic_display(info: dict) -> str:
    """从议题字段提取干净的显示名（去除换行）"""
    topic = info.get("topic", "")
    topic = topic.replace("\n", " ").strip()
    return topic if topic else ""


def generate_folder_structure(company_name, reference_excel, output_dir, pack_zip=True):
    stamp = datetime.now().strftime("%Y%m%d")
    root_name = f"【{company_name}】ESG资料收集"

    print("=" * 55)
    print(f"  ESG标准文件夹生成工具")
    print(f"  公司: {company_name}")
    print(f"  清单: {os.path.basename(reference_excel)}")
    print("=" * 55)

    # ── Step 1: 解析清单 ──────────────────────────────────────
    print("\n[1/4] 正在解析定性清单...")
    all_info = load_full_esg_info(reference_excel)
    print(f"      共解析到 {len(all_info)} 条编码记录")

    # ── Step 2: 构建目录树结构（内存） ────────────────────────
    # 结构：{(dim_folder, sub_folder, code_folder): readme_content}
    # dim_folder  = "G-公司治理"
    # sub_folder  = "GA-可持续发展治理"（A类无sub_folder）
    # code_folder = "GA1 可持续发展目标与愿景"
    print("[2/4] 正在构建目录结构...")

    tree = []  # list of (parts_list, readme_content)

    # 用于记录 sub_prefix → 子议题名（从清单中提取最早出现的干净议题名）
    sub_topic_seen = {}

    for info in all_info:
        code       = info["code"]
        dim_prefix = info["dim_prefix"]
        sub_prefix = info["sub_prefix"]
        indicator  = info["indicator"] or ""

        # 一级目录
        if dim_prefix not in DIMENSION_META:
            dim_folder = f"{dim_prefix}-其他"
        else:
            dim_folder = DIMENSION_META[dim_prefix]["folder"]

        # 编码文件夹名
        short_indicator = sanitize_folder_name(indicator[:30]) if indicator else ""
        code_folder = f"{code} {short_indicator}".strip()

        # 二级目录（A类无二级）
        if dim_prefix == "A":
            parts = [dim_folder, code_folder]
        else:
            # 尝试从已见topic中找干净的子议题名
            if sub_prefix not in sub_topic_seen:
                clean_topic = build_topic_display(info)
                if clean_topic:
                    # 去掉议题中可能重复的编码部分
                    sub_topic_seen[sub_prefix] = clean_topic
            clean_sub_topic = sub_topic_seen.get(sub_prefix, "")

            if clean_sub_topic:
                sub_folder = sanitize_folder_name(f"{sub_prefix}-{clean_sub_topic}")[:40]
            else:
                sub_folder = SUB_PREFIX_FALLBACK.get(sub_prefix, f"{sub_prefix}-议题")
            sub_folder = sanitize_folder_name(sub_folder)
            parts = [dim_folder, sub_folder, code_folder]

        readme = make_readme_content(
            code        = code,
            topic       = info["topic"],
            indicator   = indicator,
            requirement = info["requirement"],
            department  = info["department"],
            remark      = info["remark"],      # 备注列：有内容时作为补充说明写入说明.txt
        )
        tree.append((parts, readme))

    # ── Step 3: 写出目录 ──────────────────────────────────────
    base_tmp = os.path.join(tempfile.gettempdir(), root_name)
    # 清理可能残留的旧目录
    if os.path.exists(base_tmp):
        import shutil
        shutil.rmtree(base_tmp)
    os.makedirs(base_tmp, exist_ok=True)

    print(f"[3/4] 正在写出目录到: {base_tmp}")
    created_code_dirs = 0

    for parts, readme in tree:
        dir_path = base_tmp
        for part in parts:
            dir_path = os.path.join(dir_path, part)
        os.makedirs(dir_path, exist_ok=True)
        readme_path = os.path.join(dir_path, "📋说明.txt")
        with open(readme_path, "w", encoding="utf-8") as f:
            f.write(readme)
        created_code_dirs += 1

    # 追加固定兜底文件夹
    extra_folders = [
        ("【定量数据】", (
            "═══════════════════════════════════════\n"
            "  定量数据文件夹\n"
            "═══════════════════════════════════════\n\n"
            "请将定量填报数据（如能耗、排放、用水量等数据表）\n"
            "存放在此文件夹内，并对应填写【定量】ESG报告资料清单.xlsx。\n\n"
            "常见文件类型：\n"
            "  · 【定量】ESG报告资料清单.xlsx（填写完成后）\n"
            "  · 各类能耗/排放/废水/废气统计表\n"
            "  · 财务数据支撑表\n"
            "═══════════════════════════════════════"
        )),
        ("【补充资料-不确定分类】", (
            "═══════════════════════════════════════\n"
            "  补充资料兜底文件夹\n"
            "═══════════════════════════════════════\n\n"
            "如有以下情况，请将文件放入此文件夹：\n"
            "  · 无法确认对应哪个编码的文件\n"
            "  · 认为与ESG相关但不在清单中的文件\n"
            "  · 整体性资料（如年报、可持续发展报告等）\n\n"
            "请在文件名前备注说明，便于ESG编写团队识别归类。\n"
            "═══════════════════════════════════════"
        )),
    ]
    for folder_name, readme_text in extra_folders:
        folder_path = os.path.join(base_tmp, folder_name)
        os.makedirs(folder_path, exist_ok=True)
        with open(os.path.join(folder_path, "📋说明.txt"), "w", encoding="utf-8") as f:
            f.write(readme_text)

    print(f"      已创建编码文件夹: {created_code_dirs} 个，兜底文件夹: {len(extra_folders)} 个")

    # ── Step 4: 打包 ZIP ──────────────────────────────────────
    if pack_zip:
        zip_name = f"【{company_name}】ESG资料收集_文件夹模板_{stamp}.zip"
        zip_path = os.path.join(output_dir, zip_name)
        print(f"[4/4] 正在打包为ZIP: {zip_path}")
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for current_root, dirs, files in os.walk(base_tmp):
                for fname in files:
                    abs_path = os.path.join(current_root, fname)
                    arcname  = os.path.join(root_name, os.path.relpath(abs_path, base_tmp))
                    zf.write(abs_path, arcname)
        import shutil
        shutil.rmtree(base_tmp)
        print(f"\n✅ 完成！ZIP已生成：{zip_path}")
        size_kb = os.path.getsize(zip_path) / 1024
        print(f"   文件大小：{size_kb:.1f} KB")
    else:
        final_dir = os.path.join(output_dir, root_name)
        import shutil
        if os.path.exists(final_dir):
            shutil.rmtree(final_dir)
        shutil.move(base_tmp, final_dir)
        print(f"\n✅ 完成！目录已生成：{final_dir}")

    return zip_path if pack_zip else final_dir


# ==============================================================================
# 程序入口
# ==============================================================================

def main():
    """
    CLI 入口：支持两种运行方式。

    1. 带参数（推荐）：所有参数通过 CLI 传入，stdout 输出 JSON
       python3 generate_folder_structure.py \
         --company-name "公司名称" \
         --reference-excel "path/to/清单.xlsx" \
         --output-dir "/path/to/output"

    2. 仅传公司名（使用 templates/资料收集清单.xlsx）：
       python3 generate_folder_structure.py --company-name "公司名称"
    """
    import argparse
    import json

    parser = argparse.ArgumentParser(
        description="生成 ESG 标准文件夹结构 ZIP"
    )
    parser.add_argument(
        "--company-name", required=True,
        help="公司名称，如 示例企业"
    )
    parser.add_argument(
        "--reference-excel",
        default=_DEFAULT_REFERENCE_EXCEL,
        help="定性清单 Excel 路径（默认：templates/资料收集清单.xlsx）"
    )
    parser.add_argument(
        "--output-dir",
        default=_DEFAULT_OUTPUT_DIR,
        help="输出目录（ZIP 将写入此目录，默认：output/）"
    )
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)

    try:
        zip_path = generate_folder_structure(
            company_name=args.company_name,
            reference_excel=args.reference_excel,
            output_dir=args.output_dir,
            pack_zip=True,
        )
        print(json.dumps({"success": True, "zip_path": str(zip_path)}))
        sys.exit(0)
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
