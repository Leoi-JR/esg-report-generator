# GLM-OCR 两种调用方式对比

对比同一 PDF 文件在两种 GLM-OCR 调用方式下的处理结果差异。

**目标 PDF**: `data/processed/模拟甲方整理后资料/D-产业价值/DA-科技创新/DA10/AS-IP-01知识产权管理手册.pdf`

## 前提条件

vLLM GLM-OCR 服务必须运行在 `localhost:8080`：

```bash
CUDA_VISIBLE_DEVICES=0 LD_LIBRARY_PATH=/opt/conda/envs/ocr/lib:$LD_LIBRARY_PATH \
conda run -n ocr vllm serve /workspace/data/llm_models/models/GLM-OCR \
    --port 8080 --served-model-name glm-ocr --trust-remote-code \
    --speculative-config '{"method": "mtp", "num_speculative_tokens": 1}'
```

验证服务可用：
```bash
curl -s http://localhost:8080/v1/models
```

## 方法一：直接 vLLM OpenAI 接口

**脚本**: `ocr_method1_direct.py`

与项目 `src/extractors.py` 中的 `call_glmocr()` 完全一致：
- PyMuPDF 逐页转 PNG（dpi=150）
- base64 编码 → data URI
- OpenAI 兼容接口 `/v1/chat/completions`
- prompt: `"Text Recognition:"`

**运行**：
```bash
conda run -n ocr python temp/ocr_method1_direct.py
```

**关键参数**：
| 参数 | 值 | 说明 |
|------|-----|------|
| DPI | 150 | 与项目 PDF_OCR_DPI 一致 |
| max_tokens | 8192 | 与 extractors.py 一致 |
| temperature | 0.01 | 与 extractors.py 一致 |
| prompt | "Text Recognition:" | 简单文本识别指令 |

**输出**: `temp/result_method1.md`

## 方法二：glmocr SDK 完整流水线

**脚本**: `ocr_method2_sdk.py`
**配置**: `config.yaml`（完整 SDK 配置，脚本通过 `load_config()` 加载）

使用官方 `glmocr[selfhosted]` SDK 的完整流水线：
1. PP-DocLayout-V3 版面检测（识别文本/表格/图片/标题等 25 类区域）
2. 按区域裁切图片
3. 并行调用 GLM-OCR 识别各区域（text/table/formula 使用不同 prompt）
4. 结果格式化（Markdown + JSON，含 bbox 坐标）

**运行**：
```bash
conda run -n ocr python temp/ocr_method2_sdk.py
```

**配置说明**（`config.yaml` 关键项）：
| 配置项 | 值 | 说明 |
|--------|-----|------|
| `pipeline.maas.enabled` | false | 禁用云端 MaaS，使用本地 vLLM |
| `pipeline.ocr_api.api_port` | 8080 | 本地 vLLM 服务端口 |
| `pipeline.enable_layout` | true | 启用 PP-DocLayout-V3 版面检测 |
| `pipeline.layout.model_dir` | 本地路径 | PP-DocLayoutV3 模型目录 |
| `pipeline.layout.threshold` | 0.3 | 版面检测置信度阈值 |
| `pipeline.page_loader.pdf_dpi` | 200 | PDF 渲染 DPI（高于方法一的 150） |
| `pipeline.page_loader.max_tokens` | 4096 | 单次 OCR 最大 token 数 |
| `pipeline.page_loader.temperature` | 0.8 | 采样温度 |
| `pipeline.max_workers` | 32 | 并行 OCR 工作线程数 |
| `pipeline.result_formatter.output_format` | both | 同时输出 JSON + Markdown |

**版面检测区域类型处理**（`layout.label_task_mapping`）：
- **text**: 文本区域 → `"Text Recognition:"` prompt
- **table**: 表格区域 → `"Table Recognition:"` prompt
- **formula**: 公式区域 → `"Formula Recognition:"` prompt
- **skip**: 图片/图表 → 保留但不 OCR
- **abandon**: 页眉/页脚/脚注等 → 丢弃

**输出**:
- `temp/result_method2.md` — Markdown 格式结果
- `temp/result_method2.json` — 结构化 JSON 结果（含 bbox 等版面信息）
- `temp/result_method2_full/` — SDK 完整输出目录（含裁切图片）

## 对比维度

| 维度 | 方法一（直接接口） | 方法二（SDK 流水线） |
|------|-------------------|---------------------|
| 调用方式 | 逐页整页送入 OCR | 版面检测 → 按区域裁切 → 并行 OCR |
| 配置方式 | Python 脚本内硬编码 | `config.yaml` 外置配置文件 |
| DPI | 150 | 200 |
| Prompt | "Text Recognition:" | 按区域类型分配（text/table/formula） |
| 输出格式 | 纯 Markdown | Markdown + 结构化 JSON（含 bbox） |
| 表格处理 | 整页识别 | 表格区域单独识别，格式更准确 |
| 页眉页脚 | 保留 | 自动丢弃（abandon） |
| 处理速度 | 较快（无版面检测开销） | 较慢（额外版面检测步骤） |
| 适用场景 | 简单文档、快速提取 | 复杂版面、需要结构化信息 |

## 输出文件

```
temp/
├── config.yaml              ← 方法二 SDK 配置文件（完整配置项）
├── ocr_method1_direct.py    ← 方法一脚本
├── ocr_method2_sdk.py       ← 方法二脚本（加载 config.yaml）
├── result_method1.md        ← 方法一输出（运行后生成）
├── result_method2.md        ← 方法二输出（运行后生成）
├── result_method2.json      ← 方法二 JSON 输出（运行后生成）
├── result_method2_full/     ← 方法二完整输出目录（运行后生成）
└── README.md                ← 本文件
```
