# ESG Report Generator

一个通用的 **ESG 报告自动生成系统**，将企业原始资料文件通过 AI 流水线转化为结构化报告初稿，并提供 Web 编辑平台进行人工审校与导出。

> **在线演示** → [ESG Report Generator Demo](docs/showcase/index.html)

---

## 系统概览

```
原始资料（PDF/DOCX/XLSX/图片等）
    ↓
文本提取 + 智能分块
    ↓
三路混合检索（Embedding × 2 + BM25 + Reranker）
    ↓
LLM 并发撰稿（多章节）
    ↓
Web 平台编辑 + 导出 Word/Markdown
```

**核心特性：**

- 支持 PDF（扫描件 OCR）、DOCX、XLSX、PPTX、图片等多种格式
- 双路 HyDE 检索 + BM25 三路 RRF 融合 + Reranker 精排
- 企业资料路径编码与语义检索交叉验证（对齐表）
- Web 平台实时进度监控 + 富文本编辑 + 版本历史
- 多企业隔离，各项目数据完全独立

---

## 目录结构

```
esg-report-generator/
├── src/                          # Python 核心流水线
│   ├── align_evidence.py         # 文本提取 + Embedding + 对齐验证
│   ├── generate_retrieval_queries.py  # LLM 生成检索查询
│   ├── retrieve_evidence.py      # 三路混合检索（Embedding + BM25 + Reranker）
│   ├── draft_report.py           # LLM 并发撰稿
│   ├── generate_folder_structure.py   # 生成文件夹模板 ZIP
│   ├── scan_material_index.py    # 扫描资料目录，生成索引
│   ├── extractors.py             # 文件文本提取（多格式）
│   ├── bm25_retriever.py         # BM25 稀疏检索
│   ├── embedding_utils.py        # Embedding 工具函数
│   ├── config.py                 # 全局配置（从环境变量读取）
│   ├── esg_utils.py              # 共享工具函数
│   ├── progress_tracker.py       # Web 进度同步
│   ├── stage_timer.py            # 阶段计时工具
│   ├── table_summarizer.py       # 表格 LLM 摘要
│   └── prompts/                  # LLM Prompt 模板
├── web/                          # Next.js 编辑平台
├── templates/                    # ESG 框架模板（Excel）
│   ├── ESG报告框架.xlsx           # 报告目录结构
│   └── 资料收集清单.xlsx          # 指标定义
├── docs/                         # 技术文档
├── .env.example                  # 环境变量示例
├── environment.yml               # Conda 环境配置
└── requirements.txt              # Python 依赖
```

---

## 快速开始

### 1. 环境准备

```bash
# 克隆仓库
git clone https://github.com/your-org/esg-report-generator.git
cd esg-report-generator

# 创建 Conda 环境（推荐）
conda env create -f environment.yml

# 或手动创建
conda create -n esg python=3.11 -y
conda run -n esg pip install -r requirements.txt

# 安装 LibreOffice（DOC/PPT 格式转换）
apt-get install -y libreoffice   # Ubuntu/Debian
brew install libreoffice          # macOS
```

### 2. 配置 API Key

```bash
cp .env.example .env
# 编辑 .env，填入以下 Key：
```

| 环境变量 | 用途 | 获取地址 |
|---------|------|---------|
| `DASHSCOPE_API_KEY` | Embedding / Reranker / VLM | [DashScope 控制台](https://dashscope.aliyuncs.com) |
| `ZHIPU_API_KEY` | GLM-OCR 文档解析 | [智谱开放平台](https://open.bigmodel.cn) |
| `LLM_BASE_URL` | LLM API 地址（OpenAI 兼容） | 自部署或第三方 |
| `LLM_API_KEY` | LLM API Key | 同上 |
| `LLM_MODEL` | 模型名称（如 `deepseek-v3`） | 同上 |

### 3. 准备项目目录

每个企业项目需遵循以下目录约定：

```
projects/示例企业_2025/
├── raw/
│   ├── ESG报告框架.xlsx       ← 从 templates/ 复制并按需调整
│   ├── 资料收集清单.xlsx       ← 从 templates/ 复制并按需调整
│   └── 整理后资料/            ← 按三级文件夹组织的企业资料
│       ├── A-总体概况/
│       │   ├── A1/
│       │   └── ...
│       ├── G-公司治理/
│       └── ...
└── processed/                 ← 自动生成，无需手动创建
```

**生成标准文件夹模板**（发给企业，让其按目录放置资料）：

```bash
conda run -n esg python3 src/generate_folder_structure.py \
  --company-name "示例企业" \
  --reference-excel "templates/资料收集清单.xlsx" \
  --output-dir "output/"
```

---

## 完整流水线

```bash
PROJECT=projects/示例企业_2025

# 文本提取 + Embedding + 对齐验证
conda run -n esg python3 src/align_evidence.py --project-dir $PROJECT

# 为报告框架生成检索查询（LLM）
conda run -n esg python3 src/generate_retrieval_queries.py --project-dir $PROJECT

# 三路混合检索（Embedding + BM25 + Reranker）
conda run -n esg python3 src/retrieve_evidence.py --project-dir $PROJECT

# LLM 并发撰稿
conda run -n esg python3 src/draft_report.py --project-dir $PROJECT
```

所有脚本均支持断点续跑（`--resume`）和调试模式（`--debug` / `--dry-run`）。

### 缓存重建

修改分块参数或更换 Embedding 模型后，需重建对应缓存：

```bash
# 重算向量（换模型/改维度）
conda run -n esg python3 src/align_evidence.py --project-dir $PROJECT --rebuild embedding

# 重新分块（改分块参数）
conda run -n esg python3 src/align_evidence.py --project-dir $PROJECT --rebuild chunk

# 完全重建（资料文件有变化）
conda run -n esg python3 src/align_evidence.py --project-dir $PROJECT --rebuild all
```

---

## Web 编辑平台

```bash
cd web
npm install
npm run dev      # 开发模式，访问 http://localhost:3000
```

### 功能

- **首页**：多项目管理，查看各项目生成状态
- **Pipeline**：可视化监控流水线进度（SSE 实时推送）
- **编辑器**：三栏布局（目录 / 富文本编辑器 / 信源面板），支持 `[来源X]` 角标
- **数据浏览**：分块浏览、段落浏览、检索结果可视化

---

## 核心技术

### 三路混合检索

```
query ──► RQ Embedding  ──┐
      ──► HyDE Embedding ──┼──► RRF 融合 ──► Reranker ──► Top-K chunks
      ──► BM25            ──┘
```

- **RQ**：自然语言查询 + Instruct 前缀（query-document 语义匹配）
- **HyDE**：假设文档（document-document 相似度，增强语义覆盖）
- **BM25**：jieba 中文分词稀疏检索（弥补 Embedding 关键词盲区）
- **RRF**：Reciprocal Rank Fusion（基于排名融合，无需量纲对齐）

### 双证据对齐

`align_evidence.py` 同时用两种方式验证资料放置是否正确：

| 符号 | 含义 |
|------|------|
| ✅ | 路径编码与语义检索一致 |
| ⚠️ | 路径编码与语义结果不一致（疑似放错位置） |
| 🔍 | 无路径标签但语义命中（未分类资料） |
| ➕ | 额外关联（语义强相关，非主要归属） |
| ➖ | 低相关（不需审核） |

### 支持的文件格式

| 格式 | 处理方式 |
|------|---------|
| PDF（文字版） | pypdf / pdfplumber 直接解析 |
| PDF（扫描件） | 智谱 GLM-OCR layout_parsing API |
| DOCX | python-docx，支持标题层级识别 |
| DOC | LibreOffice 转 DOCX 后处理 |
| XLSX / XLS | pandas，表格分块 |
| PPTX / PPT | python-pptx，含嵌入图片 |
| JPG / PNG | DashScope qwen3-vl-plus 分类+描述 |

---

## ESG 框架编码规范

本系统使用 GEDS 四维度框架：

| 维度 | 子议题前缀 |
|------|-----------|
| G 公司治理 | GA / GB / GC |
| E 环境保护 | EA / EB / EC / ED |
| D 产业价值 | DA / DC / DD / DE |
| S 人权与社会 | SA / SB / SC / SD |

编码格式：`[AGEDS][A-Z]{0,3}\d{1,3}`（如 `GA1`、`EB10`、`SD3`）

**重要约定**：资料整理后的三级文件夹名称 = ESG 编码（如 `GA1`），是整个系统识别资料归属的核心机制。

---

## 配置参考

所有参数集中在 `src/config.py`，均可通过环境变量覆盖。主要参数包括：

| 参数 | 说明 |
|------|------|
| `CHUNK_MAX_SIZE` | 分块最大字符数 |
| `EMBEDDING_MODEL` | DashScope Embedding 模型 |
| `EMBEDDING_DIM` | 向量维度 |
| `DRAFT_BIENCODER_TOP_N` | Reranker 输入候选数 |
| `DRAFT_RERANKER_TOP_K` | Reranker 输出保留数 |
| `DRAFT_CONCURRENCY` | LLM 并发数 |
| `DRAFT_LLM_MODEL` | 撰稿 LLM 模型 |

---

## 文档

| 文档 | 说明 |
|------|------|
| [项目工作链路](docs/项目工作链路.md) | 完整流水线、数据结构 |
| [三路检索架构](docs/双路检索与Reranker架构设计.md) | 检索算法设计 |
| [文本分块逻辑](docs/文本分块逻辑详解.md) | 分块算法详解 |
| [表格处理优化](docs/表格处理优化方案.md) | 表格三阶段优化 |
| [图片与OCR处理](docs/图片与OCR处理改进方案.md) | VLM 分类 + OCR |
| [Web 平台设计](docs/产品设计_ESG报告编辑平台.md) | 编辑器功能与架构 |

---

## License

MIT
