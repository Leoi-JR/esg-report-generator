import json

# 读取 cache
with open('data/processed/_rq_raw_cache_hypothetical_doc.json', 'r', encoding='utf-8') as f:
    cache = json.load(f)
    raw_llm = cache['走进企业']

print('=== 测试修复后的解析逻辑 ===')
print()

# 步骤1：替换中文引号
left_quote = '"'
right_quote = '"'
print(f'步骤1：替换中文引号')
print(f'  替换前中文引号数量: {raw_llm.count(left_quote) + raw_llm.count(right_quote)}')

text = raw_llm.replace(left_quote, '"').replace(right_quote, '"')

print(f'  替换后中文引号数量: {text.count(left_quote) + text.count(right_quote)}')  # 应该是 0
print(f'  是否完全替换: {left_quote not in text and right_quote not in text}')
print()

# 步骤2：去除代码块
text = text.strip()
if text.startswith("```"):
    lines = text.split('\n')
    if lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip() == "```":
        lines = lines[:-1]
    text = '\n'.join(lines)
print(f'步骤2：去除代码块')
print(f'  文本长度: {len(text)} 字符')
print()

# 步骤3：尝试解析
print(f'步骤3：解析 JSON')
try:
    data = json.loads(text)
    print(f'✓ 解析成功！')
    print(f'  记录数: {len(data)}')
    print()

    # 显示第一条记录信息
    first = data[0]
    print(f'第一条记录:')
    print(f'  ID: {first["id"]}')
    print(f'  hypothetical_doc 长度: {len(first["hypothetical_doc"])} 字符')
    print(f'  前100字符: {first["hypothetical_doc"][:100]}...')
    print()

    # 验证所有记录
    print('验证所有记录:')
    for i, record in enumerate(data):
        assert 'id' in record, f'记录 {i} 缺少 id 字段'
        assert 'hypothetical_doc' in record, f'记录 {i} 缺少 hypothetical_doc 字段'
        assert len(record['hypothetical_doc']) >= 100, f'记录 {i} 内容过短 ({len(record["hypothetical_doc"])} 字符)'
    print(f'✓ 所有 {len(data)} 条记录验证通过')

except json.JSONDecodeError as e:
    print(f'✗ 解析失败: {e}')
    print(f'错误位置: line {e.lineno}, col {e.colno}, pos {e.pos}')
    error_char = text[e.pos] if e.pos < len(text) else 'EOF'
    print(f'错误位置字符: {repr(error_char)}')
    print(f'错误位置附近: {repr(text[max(0, e.pos-50):e.pos+50])}')
