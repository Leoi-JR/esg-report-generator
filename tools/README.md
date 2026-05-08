# tools/

本目录存放辅助脚本，不属于主流水线，按需使用。

## simulate_client_sorting.py

将零散原始资料按 ESG 编码分类复制到标准三级文件夹结构。

**适用场景**：企业提供的原始资料未按标准文件夹整理，需要自动归类。  
**正常场景**：企业直接按 `generate_folder_structure.py` 生成的标准目录放置资料，无需此脚本。

```bash
python3 tools/simulate_client_sorting.py \
    --source-dir  "path/to/原始零散资料/" \
    --target-dir  "projects/示例企业_2025/raw/整理后资料/" \
    --company-name "示例企业"
```

脚本会：
1. 遍历源目录下所有文件
2. 从文件路径/文件名中识别 ESG 编码（GA1、EB10 等）
3. 将文件复制到目标目录下对应编码的文件夹
4. 无法识别的文件放入 `【补充资料-不确定分类】/`
5. 生成整理日志文件
