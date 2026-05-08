# PDF 分类实验

本目录是 PDF 预分类实验的独立沙盒，目标是在正式接入生产流水线前，先用实验脚本摸清不同类型 PDF 的特征和最佳提取策略。

所有脚本**只读取或复制原始资料，不修改任何源文件**。

---

## 目录结构

```
pdf_classification/
├── README.md                        # 本文件
│
├── classify_pdfs.py                 # Step 1：指标提取 + 分类打标
├── copy_by_label.py                 # Step 2：按标签复制 PDF 到分类文件夹
├── extract_text_normal.py           # 核心库：text_normal 类 PDF 提取
├── test_text_normal.py              # 测试脚本：运行提取并打印 / 保存结果
│
├── labeled/                         # copy_by_label.py 的输出
│   ├── 艾森股份_2025/
│   │   ├── text_normal/             # 普通文字 PDF（67 个）
│   │   ├── scanned/                 # 扫描件（81 个）
│   │   ├── mixed_scan/              # 混合扫描件（14 个）
│   │   ├── ppt_pdf/                 # PPT 转 PDF（8 个）
│   │   └── empty/                  # 空文件（1 个）
│   └── 泓淋电力_2025/
│       ├── text_normal/             # 普通文字 PDF（104 个）
│       ├── scanned/                 # 扫描件（39 个）
│       ├── mixed_scan/              # 混合扫描件（10 个）
│       ├── ppt_pdf/                 # PPT 转 PDF（5 个）
│       └── image_heavy/             # 图片主体/证书（14 个）
│
└── results/                         # 所有脚本的输出文件
    ├── 艾森股份_2025_pdf_classification.csv
    ├── 泓淋电力_2025_pdf_classification.csv
    └── text_normal_extraction_test.json
```

---

## 脚本说明

### `classify_pdfs.py` — Step 1：指标提取 + 分类打标

对两个企业目录下的所有 PDF 做静态扫描，用 PyMuPDF 直接提取（不调用任何 API），输出每个 PDF 的多维指标和分类标签。

**计算的指标**

| 指标 | 说明 |
|------|------|
| `total_pages` | 总页数 |
| `total_chars` | 全文字符总数 |
| `avg/min/max_chars_per_page` | 页均 / 最少 / 最多字符数 |
| `low_char_pages` / `low_char_ratio` | 字符数 < 30 的页面数量和占比 |
| `total_images` / `avg_images_per_page` | 图片总数 / 页均图片数（xref 去重） |
| `avg_image_area_ratio` / `max_image_area_ratio` | 页均 / 最大图片面积占页面面积比（via `get_image_rects`） |
| `garbled_ratio` | 乱码字符占比（非中英数字及常用标点） |
| `mean_aspect_ratio` | 前 5 页平均宽高比（> 1.2 怀疑是 PPT 转 PDF） |

**分类标签（6 类，按优先级）**

| 标签 | 判断条件 | 后续处理策略 |
|------|----------|-------------|
| `empty` | 0 页或无文字无图片 | 直接跳过 |
| `scanned` | `low_char_ratio ≥ 0.5` | 走 OCR（GLM-OCR / Tesseract） |
| `mixed_scan` | `0 < low_char_ratio < 0.5` | 逐页判断：有文字页用 PyMuPDF，空白页走 OCR |
| `ppt_pdf` | 宽高比 > 1.2 且文字稀疏或图片多 | 按页提取，不按标题切分 |
| `image_heavy` | `avg_image_area_ratio > 0.5` | VLM 描述或 OCR |
| `text_normal` | 其他 | PyMuPDF 直接提取，按标题切 section |

**输出**：`results/{企业名}_pdf_classification.csv`

**运行**

```bash
# 全量（两个企业）
conda run -n esg python3 experiments/pdf_classification/classify_pdfs.py

# 只处理前 20 个（调试）
conda run -n esg python3 experiments/pdf_classification/classify_pdfs.py --limit 20

# 只处理一个企业
conda run -n esg python3 experiments/pdf_classification/classify_pdfs.py --company 泓淋电力_2025
```

---

### `copy_by_label.py` — Step 2：按标签复制 PDF

读取 `results/*.csv` 中的 `label` 字段，将 PDF **复制**（不移动）到 `labeled/{企业}/{标签}/` 目录下。
- 同名文件自动追加序号后缀（`_1`、`_2` ...），不覆盖
- 必须先运行 `classify_pdfs.py` 生成 CSV

**输出**：`labeled/` 目录

**运行**

```bash
# 全量复制（两个企业）
conda run -n esg python3 experiments/pdf_classification/copy_by_label.py

# 预览操作，不实际复制
conda run -n esg python3 experiments/pdf_classification/copy_by_label.py --dry-run

# 只处理一个企业
conda run -n esg python3 experiments/pdf_classification/copy_by_label.py --company 艾森股份_2025
```

---

### `extract_text_normal.py` — 核心库：text_normal 提取

从 `src/extractors.py` 提取 pymupdf 路径的最小函数集，**不依赖 `src/` 目录**，可独立运行。专门处理 `text_normal` 类 PDF（纯文字、无需 OCR）。

**调用链**

```
extract_text_normal_pdf(file_record)
    └── parse_normal_pdf(doc)            # 按标题字号切 sections
    └── make_chunks_from_sections(...)   # sections → chunks
            ├── merge_short_sections()   # 合并过短 section
            ├── preprocess_section()     # HTML 表格转 Markdown + 正文/表格分离
            └── make_chunks_from_preprocessed_section()
                    ├── recursive_split()      # 正文按字符数分块
                    └── split_table_by_rows()  # 表格按行数分块
```

**可调参数**（文件顶部常量，修改后直接生效）

| 常量 | 默认值 | 说明 |
|------|--------|------|
| `CHUNK_MAX_SIZE` | `1200` | 单个正文 chunk 字符数上限 |
| `CHUNK_MIN_SIZE` | `100` | 触发短片段合并的阈值 |
| `TABLE_MAX_ROWS` | `30` | 表格分块最大行数（超过则拆分并补表头） |
| `PDF_TITLE_SIZE_PERCENTILE` | `0.75` | 字号超过全文该百分位 → 视为标题（P75） |
| `PDF_TITLE_MAX_CHARS` | `200` | 文本超过此字符数 → 不视为标题 |
| `PDF_TITLE_RATIO_MAX` | `0.50` | 标题 block 占总 block 比例上限，超过则逐级上探字号 |
| `PDF_TITLE_MIN_COUNT` | `2` | 标题 block 最少数量，少于此值放弃按标题切割 |

**公开 API**

```python
from extract_text_normal import extract_text_normal_pdf

file_record = {
    "file_path":     "/path/to/file.pdf",   # 必填
    "file_name":     "file.pdf",             # 必填
    "relative_path": "projects/.../file.pdf",# 可选，用于 chunk_id 前缀
    "folder_code":   "GA1",                  # 可选，ESG 编码
}

result = extract_text_normal_pdf(file_record)
# result = {
#     "parents": {parent_id: parent_text, ...},   # section 全文（用于上下文）
#     "chunks":  [chunk_dict, ...]                 # 分块结果
# }
```

**chunk_dict 字段**

| 字段 | 说明 |
|------|------|
| `chunk_id` | 唯一 ID，格式 `{rel_path}#{section_id}#c{n}` |
| `parent_id` | 所属 section 的 ID |
| `file_path` / `file_name` / `folder_code` | 来源文件信息 |
| `page_or_sheet` | 所在页码 |
| `section_title` | 所属标题文本 |
| `text` | chunk 正文 |
| `char_count` | 有效字符数（中英数字） |
| `is_table` | 表格 chunk 为 `True`（正文 chunk 无此字段） |
| `table_markdown` / `table_html` / `table_rows` | 仅表格 chunk 有 |

---

### `test_text_normal.py` — 测试脚本

调用 `extract_text_normal.py` 对 `labeled/*/text_normal/` 中的 PDF 批量运行提取，在控制台打印 section 预览和 chunk 统计，并将结果保存为 JSON。

**输出**：`results/text_normal_extraction_test.json`

**运行**

```bash
# 每个企业各取 5 个 PDF 测试（默认）
conda run -n esg python3 experiments/pdf_classification/test_text_normal.py

# 调整每企业测试数量
conda run -n esg python3 experiments/pdf_classification/test_text_normal.py --limit 10

# 只测一个企业
conda run -n esg python3 experiments/pdf_classification/test_text_normal.py --company 泓淋电力_2025 --limit 10

# 直接指定单个 PDF（绝对路径或相对于项目根目录的路径）
conda run -n esg python3 experiments/pdf_classification/test_text_normal.py \
    --file experiments/pdf_classification/labeled/艾森股份_2025/text_normal/仓库管理规定.pdf
```

---

## 完整使用流程

```bash
# 1. 对所有 PDF 做指标扫描和分类打标（约 3-5 分钟）
conda run -n esg python3 experiments/pdf_classification/classify_pdfs.py

# 2. 按标签将 PDF 复制到 labeled/ 下的分类文件夹
conda run -n esg python3 experiments/pdf_classification/copy_by_label.py

# 3. 测试 text_normal 类 PDF 的提取效果（每企业取 5 个）
conda run -n esg python3 experiments/pdf_classification/test_text_normal.py --limit 5

# 4. 后续针对其他标签类型（scanned / ppt_pdf / ...）
#    继续在本目录新建对应的 extract_*.py 和 test_*.py
```

---

## 分类结果汇总

| 标签 | 艾森股份_2025 | 泓淋电力_2025 | 后续处理策略 |
|------|:---:|:---:|------|
| `text_normal` | 67 | 104 | PyMuPDF 按标题切分 ✅ 已实现 |
| `scanned` | 81 | 39 | GLM-OCR / Tesseract 🔲 待实验 |
| `mixed_scan` | 14 | 10 | 逐页判断，混合处理 🔲 待实验 |
| `ppt_pdf` | 8 | 5 | 按页提取 🔲 待实验 |
| `image_heavy` | 0 | 14 | VLM 描述 🔲 待实验 |
| `empty` | 1 | 0 | 跳过 |
| **合计** | **171** | **172** | |
