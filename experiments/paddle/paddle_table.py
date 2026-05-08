from paddleocr import TableCellsDetection
import cv2
import json

# 加载模型
model = TableCellsDetection()

# 输入表格图像路径
img_path = "/workspace/data/艾森股份_Claude/111.jpg"

# 推理
output = model.predict(input=img_path, batch_size=1)

# 查看输出
for res in output:
    res.print(json_format=False)
    # 保存结果到json，方便查看完整结构
    res.save_to_json("cells.json")
    # 可视化，画出检测到的单元格bbox
    res.save_to_img("cells_vis.png")