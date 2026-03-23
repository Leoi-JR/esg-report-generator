import { NextRequest, NextResponse } from 'next/server';
import { saveAIHistory, getUploadedFile } from '@/lib/db';

const LLM_BASE_URL = process.env.LLM_BASE_URL || 'http://127.0.0.1:8000';
const LLM_API_KEY = process.env.LLM_API_KEY || 'sk-leoi-888';
const LLM_MODEL = process.env.LLM_MODEL || 'deepseek-thinking';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { chapter_id, selected_text, source_texts, uploaded_file_ids } = body;

    if (!chapter_id || !selected_text) {
      return NextResponse.json({ error: 'chapter_id and selected_text are required' }, { status: 400 });
    }

    // Build source context
    const sourceContext = (source_texts || [])
      .map((s: { id: string; text: string }) => `【来源${s.id}】\n${s.text}`)
      .join('\n\n');

    // Build uploaded context
    let uploadedContext = '';
    if (uploaded_file_ids?.length) {
      const texts = uploaded_file_ids
        .map((id: number) => getUploadedFile(id))
        .filter(Boolean)
        .map((f: { file_name: string; extracted_text: string | null }) =>
          `【${f.file_name}】\n${(f.extracted_text || '').slice(0, 4000)}`
        );
      uploadedContext = texts.join('\n\n');
    }

    const prompt = `你是一位专业的 ESG 报告编辑助手。请基于以下段落进行续写扩展。

要求：
1. 保持与原文一致的专业语气和风格
2. 基于提供的来源资料和补充资料进行有据可依的扩展
3. 如引用来源资料中的信息，请添加 [来源X] 标注
4. 续写内容应自然衔接原文

【待续写文本】
${selected_text}

${sourceContext ? `【参考来源资料】\n${sourceContext}` : ''}

${uploadedContext ? `【补充资料】\n${uploadedContext}` : ''}

请直接输出续写的文本（不包含原文），不要添加解释。`;

    // Call LLM
    const llmResponse = await fetch(`${LLM_BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
      }),
    });

    if (!llmResponse.ok) {
      const errText = await llmResponse.text();
      console.error('LLM API error:', errText);
      return NextResponse.json({ error: 'LLM API call failed' }, { status: 502 });
    }

    const llmData = await llmResponse.json();
    const responseText = llmData.choices?.[0]?.message?.content || '';

    // Save to AI history
    const historyId = saveAIHistory({
      chapter_id,
      action: 'extend',
      input_text: selected_text,
      source_context: sourceContext || undefined,
      uploaded_context: uploadedContext || undefined,
      prompt,
      response: responseText,
    });

    return NextResponse.json({
      text: responseText,
      ai_history_id: historyId,
      action: 'extend',
    });
  } catch (error) {
    console.error('AI extend failed:', error);
    return NextResponse.json({ error: 'AI extend failed' }, { status: 500 });
  }
}
