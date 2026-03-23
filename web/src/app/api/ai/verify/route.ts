import { NextRequest, NextResponse } from 'next/server';
import { saveAIHistory } from '@/lib/db';

const LLM_BASE_URL = process.env.LLM_BASE_URL || 'http://127.0.0.1:8000';
const LLM_API_KEY = process.env.LLM_API_KEY || 'sk-leoi-888';
const LLM_MODEL = process.env.LLM_MODEL || 'deepseek-thinking';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { chapter_id, selected_text, source_texts } = body;

    if (!chapter_id || !selected_text) {
      return NextResponse.json({ error: 'chapter_id and selected_text are required' }, { status: 400 });
    }

    // Build source context
    const sourceContext = (source_texts || [])
      .map((s: { id: string; text: string }) => `【来源${s.id}】\n${s.text}`)
      .join('\n\n');

    const prompt = `你是一位专业的 ESG 报告事实核查助手。请核查以下文本与来源资料的一致性。

【待核查文本】
${selected_text}

${sourceContext ? `【参考来源资料】\n${sourceContext}` : '（无来源资料）'}

请按以下格式回复：

结论：✅ 一致 / ⚠️ 有差异 / ❌ 无法核实

差异说明：
（如有差异，详细说明待核查文本与来源资料之间的不一致之处）

建议修改：
（如有差异，给出修改建议）`;

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
      action: 'verify',
      input_text: selected_text,
      source_context: sourceContext || undefined,
      prompt,
      response: responseText,
    });

    return NextResponse.json({
      text: responseText,
      ai_history_id: historyId,
      action: 'verify',
    });
  } catch (error) {
    console.error('AI verify failed:', error);
    return NextResponse.json({ error: 'AI verify failed' }, { status: 500 });
  }
}
