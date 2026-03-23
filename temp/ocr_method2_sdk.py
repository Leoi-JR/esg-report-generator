#!/usr/bin/env python3
"""
方法二：使用官方 glmocr[selfhosted] SDK（完整版面检测流水线）

逻辑：
  1. 从 temp/config.yaml 加载配置（指向本地 vLLM + 启用版面检测）
  2. PP-DocLayout-V3 版面检测 → 区域裁切 → 并行 OCR → 结果格式化
  3. 直接传入 PDF 路径给 parse()
  4. 输出 result_method2.md 和 result_method2.json

配置文件 config.yaml 要点：
  - maas.enabled: false（禁用云端，使用本地 vLLM）
  - ocr_api: localhost:8080（与项目 GLM-OCR 服务一致）
  - enable_layout: true（启用 PP-DocLayout-V3 版面检测）
  - layout.model_dir: 本地 PP-DocLayoutV3 模型路径
"""

import json
import time
from pathlib import Path

from glmocr import GlmOcr, load_config, GlmOcrConfig

# ── 路径 ──────────────────────────────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).resolve().parent
CONFIG_PATH = SCRIPT_DIR / "config.yaml"

PDF_PATH = SCRIPT_DIR.parent / (
    "data/processed/模拟甲方整理后资料/D-产业价值/DA-科技创新/DA10/"
    "AS-IP-01知识产权管理手册.pdf"
)

OUTPUT_MD = SCRIPT_DIR / "result_method2.md"
OUTPUT_JSON = SCRIPT_DIR / "result_method2.json"


def main():
    print(f"[方法二] glmocr SDK 完整流水线（含版面检测）")
    print(f"  PDF: {PDF_PATH}")
    print(f"  配置: {CONFIG_PATH}")
    print()

    if not PDF_PATH.exists():
        print(f"❌ PDF 文件不存在: {PDF_PATH}")
        return

    if not CONFIG_PATH.exists():
        print(f"❌ 配置文件不存在: {CONFIG_PATH}")
        return

    # 加载 config.yaml 用于打印信息
    config = load_config(str(CONFIG_PATH))
    print(f"  版面检测模型: {config.pipeline.layout.model_dir}")
    print(f"  vLLM 服务: {config.pipeline.ocr_api.api_host}:{config.pipeline.ocr_api.api_port}")
    print(f"  enable_layout: {config.pipeline.enable_layout}")
    print()

    print("  初始化 GlmOcr ...", flush=True)
    t0 = time.time()

    with GlmOcr(config_path=str(CONFIG_PATH)) as parser:
        init_time = time.time() - t0
        print(f"  初始化完成 ({init_time:.1f}s)\n")

        print("  开始解析 PDF ...", flush=True)
        t1 = time.time()
        result = parser.parse(str(PDF_PATH))
        parse_time = time.time() - t1
        print(f"  解析完成 ({parse_time:.1f}s)\n")

        # 保存结果
        # 1. Markdown（属性名为 markdown_result）
        md_content = result.markdown_result if hasattr(result, 'markdown_result') and result.markdown_result else str(result)
        header = (
            f"# 方法二：glmocr SDK 完整流水线 OCR 结果\n\n"
            f"- PDF: `{PDF_PATH.name}`\n"
            f"- 配置: `config.yaml`\n"
            f"- 版面检测: PP-DocLayout-V3 (enable_layout=True)\n"
            f"- vLLM 服务: {config.pipeline.ocr_api.api_host}:{config.pipeline.ocr_api.api_port}\n"
            f"- SDK 初始化耗时: {init_time:.1f}s\n"
            f"- PDF 解析耗时: {parse_time:.1f}s\n"
            f"- 总耗时: {init_time + parse_time:.1f}s\n\n"
            f"---\n\n"
        )
        OUTPUT_MD.write_text(header + md_content, encoding="utf-8")
        print(f"  ✅ Markdown 结果: {OUTPUT_MD}")

        # 2. JSON
        json_result = result.json_result if hasattr(result, 'json_result') else None
        if json_result is not None:
            OUTPUT_JSON.write_text(
                json.dumps(json_result, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            print(f"  ✅ JSON 结果: {OUTPUT_JSON}")
        else:
            print("  ⚠️ 无 JSON 结果")

        # 也尝试用 result.save() 保存到子目录
        save_dir = SCRIPT_DIR / "result_method2_full"
        try:
            result.save(output_dir=str(save_dir))
            print(f"  ✅ 完整输出目录: {save_dir}")
        except Exception as e:
            print(f"  ⚠️ result.save() 失败: {e}")

    total_time = init_time + parse_time
    print(f"\n  总耗时: {total_time:.1f}s")


if __name__ == "__main__":
    main()
