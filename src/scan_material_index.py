import os
import re
import sys
import argparse
import tempfile
import warnings
import pandas as pd
from datetime import datetime

warnings.filterwarnings("ignore", category=UserWarning)

# 公共工具函数统一从 esg_utils 导入
from esg_utils import (
    CODE_REGEX,
    clean_text,
    is_blank,
    extract_code_from_string,
    extract_all_codes_from_string,
    parse_prefix_from_text,
    parse_serial_number,
    find_col_idx_by_keywords,
    forward_fill_in_raw,
    unmerge_and_flatten_styles,
    find_header_row_for_reference,
)

_HERE = os.path.dirname(os.path.abspath(__file__))  # src/ 目录
_ROOT = os.path.dirname(_HERE)                       # 项目根目录

NULL = "null"


# ==============================================================================
# 模块1：从参考 Excel 构建 code -> {议题, 指标}（只做确定性匹配）
# ==============================================================================

def load_esg_mapping_from_reference_excel(reference_excel_path: str,
                                         search_rows: int = 200,
                                         clear_formats: bool = True):
    """
    映射优先级（确定性）：
    1) 编码/识别编码列存在且能解析出 code，直接用
    2) 否则：序号/编号列如果本身就是 EA1/GB11 等编码，直接用
    3) 否则：prefix(优先从 类别/维度 提取 GA/GB/EA...) + 数字序号（仅在 prefix 和数字都明确时）
    4) 否则：该行不入映射（等价于 code = null）
    """
    if not os.path.exists(reference_excel_path):
        raise FileNotFoundError(f"找不到参考Excel: {reference_excel_path}")

    cleaned_path = os.path.join(tempfile.gettempdir(), "__ref_esg_mapping_cleaned__.xlsx")
    unmerge_and_flatten_styles(reference_excel_path, cleaned_path, clear_formats=clear_formats)

    xls = pd.ExcelFile(cleaned_path)
    sheet_names = xls.sheet_names

    mapping = {}
    dup = set()
    rows_scanned = 0
    rows_used = 0

    for sh in sheet_names:
        df_raw = pd.read_excel(xls, sheet_name=sh, header=None, dtype=object)
        header_idx = find_header_row_for_reference(df_raw, search_rows=search_rows)
        if header_idx is None:
            continue

        col_topic = find_col_idx_by_keywords(df_raw, header_idx, ["议题"])
        col_indicator = find_col_idx_by_keywords(df_raw, header_idx, ["指标"])
        col_serial = find_col_idx_by_keywords(df_raw, header_idx, ["序号", "编号"])
        col_category = find_col_idx_by_keywords(df_raw, header_idx, ["类别", "维度"])
        col_code = find_col_idx_by_keywords(df_raw, header_idx, ["识别编码", "编码"])

        # 只填充"议题/指标/类别/维度"，不填充"序号/编码"
        fill_cols_idx = []
        for kw in ["议题", "指标", "类别", "维度"]:
            idx = find_col_idx_by_keywords(df_raw, header_idx, [kw])
            if idx is not None and idx not in fill_cols_idx:
                fill_cols_idx.append(idx)

        df_filled = forward_fill_in_raw(df_raw, start_row=header_idx + 1, col_indices=fill_cols_idx)

        if header_idx + 1 >= df_filled.shape[0]:
            continue

        data_part = df_filled.iloc[header_idx + 1:].copy()
        rows_scanned += len(data_part)

        for _, row in data_part.iterrows():
            topic = row.iloc[col_topic] if col_topic is not None and col_topic < len(row) else None
            indicator = row.iloc[col_indicator] if col_indicator is not None and col_indicator < len(row) else None
            topic = NULL if is_blank(topic) else str(topic).strip()
            indicator = NULL if is_blank(indicator) else str(indicator).strip()

            code_key = None

            # 1) 编码/识别编码列
            if col_code is not None and col_code < len(row):
                v = row.iloc[col_code]
                if not is_blank(v):
                    code_key = extract_code_from_string(str(v))

            # 2) 序号/编号列本身是 EA1/GB11
            if not code_key and col_serial is not None and col_serial < len(row):
                v = row.iloc[col_serial]
                if not is_blank(v):
                    code_key = extract_code_from_string(str(v))

            # 3) prefix + 数字序号（优先类别/维度）
            if not code_key:
                prefix = None

                if col_category is not None and col_category < len(row):
                    v = row.iloc[col_category]
                    if not is_blank(v):
                        prefix = parse_prefix_from_text(str(v))

                serial_num = None
                if col_serial is not None and col_serial < len(row):
                    v = row.iloc[col_serial]
                    serial_num = parse_serial_number(v)

                if prefix and serial_num is not None:
                    code_key = f"{prefix}{serial_num}"

            if not code_key:
                continue

            if code_key in mapping:
                dup.add(code_key)
                old = mapping[code_key]
                if old.get("议题") == NULL and topic != NULL:
                    old["议题"] = topic
                if old.get("指标") == NULL and indicator != NULL:
                    old["指标"] = indicator
                mapping[code_key] = old
            else:
                mapping[code_key] = {"议题": topic, "指标": indicator}

            rows_used += 1

    stats = {
        "sheets_total": len(sheet_names),
        "mapping_size": len(mapping),
        "rows_scanned": rows_scanned,
        "rows_used": rows_used,
        "duplicate_codes_count": len(dup),
        "duplicates_sample": sorted(list(dup))[:20],
    }
    return mapping, stats


# ==============================================================================
# 模块2：扫描文件夹时，从整条路径中提取最深层编码
# ==============================================================================

def find_best_code_in_path(path_parts, esg_mapping: dict):
    """
    返回：best_code, best_part, best_index, in_mapping(bool)
    """
    candidates = []
    for idx, part in enumerate(path_parts):
        if not isinstance(part, str):
            continue
        codes = extract_all_codes_from_string(part)
        for code in codes:
            candidates.append((idx, code, part, code in esg_mapping))

    if not candidates:
        return None, None, None, False

    # 优先：存在于映射内的编码，取最深层
    in_map = [x for x in candidates if x[3] is True]
    if in_map:
        in_map.sort(key=lambda x: x[0])
        idx, code, part, flag = in_map[-1]
        return code, part, idx, True

    # 回退：映射内没有，但路径里确实出现编码，取最深层
    candidates.sort(key=lambda x: x[0])
    idx, code, part, flag = candidates[-1]
    return code, part, idx, False


def choose_dimension_folder(path_parts, code_part, code_idx, code):
    """
    文件位置(维度)展示策略：
    - 优先展示路径中与编码前缀一致的纯字母目录（如 SC、EA、GB）
    - 否则展示编码所在目录片段（如 SC13/DD1）
    - 若编码来自文件名，则用其父目录
    - 最后 fallback 到一级目录
    """
    if not code:
        return path_parts[0] if len(path_parts) > 1 else "根目录文件"

    m = re.match(r"^([A-Z]+)", code)
    prefix = m.group(1) if m else None

    if prefix:
        for i in range(len(path_parts) - 1, -1, -1):
            if isinstance(path_parts[i], str) and path_parts[i].upper() == prefix:
                return path_parts[i]

    if code_idx is not None and code_idx == len(path_parts) - 1:
        return path_parts[code_idx - 1] if code_idx >= 1 else "根目录文件"

    if code_part:
        return code_part

    return path_parts[0] if len(path_parts) > 1 else "根目录文件"


# ==============================================================================
# 主功能：生成资料索引 Excel
# ==============================================================================

def resolve_output_path_with_date(output_path_or_dir: str) -> str:
    stamp = datetime.now().strftime("%Y%m%d")

    if os.path.isdir(output_path_or_dir):
        return os.path.join(output_path_or_dir, f"资料索引_{stamp}.xlsx")

    p = output_path_or_dir
    if not p.lower().endswith(".xlsx"):
        p += ".xlsx"

    base, ext = os.path.splitext(p)
    return f"{base}_{stamp}{ext}"


def generate_geds_inventory_final(root_path, output_path_or_dir, esg_mapping: dict):
    file_data = []
    file_count = 1

    output_path = resolve_output_path_with_date(output_path_or_dir)
    print(f"提示：输出文件 -> {output_path}")
    print(f"开始执行索引，目标路径: {root_path}")

    for current_root, dirs, files in os.walk(root_path):
        for filename in files:
            if filename.startswith(".") or filename.startswith("~"):
                continue

            full_abs_path = os.path.join(current_root, filename)
            relative_path = os.path.relpath(full_abs_path, root_path)
            path_parts = relative_path.split(os.sep)  # folders + filename

            best_code, best_part, best_idx, in_mapping = find_best_code_in_path(path_parts, esg_mapping)

            # 识别编码：只要路径里出现编码就写出来（不再强制要求存在于映射）
            identified_code = best_code if best_code else NULL

            # 文件位置(维度)
            dimension_folder = choose_dimension_folder(path_parts, best_part, best_idx, best_code)

            # 匹配议题/指标：只有编码存在于映射时才填，否则 null
            if best_code and best_code in esg_mapping:
                matched_topic = esg_mapping[best_code].get("议题", NULL)
                matched_indicator = esg_mapping[best_code].get("指标", NULL)
            else:
                matched_topic = NULL
                matched_indicator = NULL

            tag = best_code if best_code else dimension_folder
            tagged_filename = f"[{tag}] {filename}"

            file_data.append({
                "序号": file_count,
                "文件位置(维度)": dimension_folder,
                "识别编码": identified_code,
                "匹配议题": matched_topic,
                "匹配指标": matched_indicator,
                "文件名称": tagged_filename,
                "完整路径": relative_path
            })
            file_count += 1

    if not file_data:
        print("未扫描到任何文件，请检查输入路径。")
        return

    df = pd.DataFrame(file_data)
    cols = ["序号", "匹配议题", "识别编码", "匹配指标", "文件名称", "文件位置(维度)", "完整路径"]
    df = df[cols]

    try:
        df.to_excel(output_path, index=False, engine="openpyxl")
        print("-" * 30)
        print(f"成功！共处理文件: {len(df)}")
        print(f"Excel 已生成至: {output_path}")

        hit = (df["匹配议题"] != NULL).sum()
        print(f"命中条数: {hit}，未命中条数: {len(df) - hit}")
    except Exception as e:
        print(f"无法保存。详细错误: {e}")


def run_data_list(project_dir: str):
    """
    可编程调用入口：生成指定项目的资料索引 Excel。

    Args:
        project_dir: 企业项目目录（绝对路径或相对项目根的相对路径）
    """
    # 延迟导入，避免循环依赖
    import sys
    sys.path.insert(0, _HERE)
    from config import get_paths

    paths = get_paths(project_dir)
    reference_excel = str(paths.checklist_xlsx)
    target_folder = str(paths.materials_dir)
    output_dir = str(paths.processed_dir)

    print("[信息] 文件夹模板生成: 从参考Excel构建'编码 -> 议题/指标'映射...")
    mapping, stats = load_esg_mapping_from_reference_excel(
        reference_excel_path=reference_excel,
        search_rows=200,
        clear_formats=True,
    )

    print("[信息] 映射构建完成：")
    print(f"  - mapping_size         : {stats['mapping_size']}")
    print(f"  - rows_scanned         : {stats['rows_scanned']}")
    if stats["duplicate_codes_count"] > 0:
        print(f"  - duplicate_codes_count: {stats['duplicate_codes_count']}")

    print("\n[信息] 资料清单扫描: 开始扫描资料文件夹并生成索引...")
    generate_geds_inventory_final(target_folder, output_dir, mapping)


# ==============================================================================
# 程序入口
# ==============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="扫描企业资料文件夹，生成资料索引 Excel"
    )
    parser.add_argument(
        "--project-dir", required=True,
        help="企业项目目录，如 projects/示例企业_2025"
    )
    args = parser.parse_args()
    run_data_list(args.project_dir)


if __name__ == "__main__":
    main()
