import { NextRequest, NextResponse } from 'next/server';
import { saveAIHistory, getUploadedFile } from '@/lib/db';
import { buildPrompt } from '@/lib/prompt-loader';

const LLM_API_KEY = process.env.LLM_API_KEY || '';
const LLM_MODEL = process.env.LLM_MODEL || '';
function getLLMBaseUrl() {
  const u = (process.env.LLM_BASE_URL || '').replace(/\/$/, '');
  return u.endsWith('/v1') ? u.slice(0, -3) : u;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { chapter_id, selected_text, source_texts, uploaded_file_ids, project_id } = body;
    const projectId = project_id || 'default';

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

    // Build prompt from template
    const prompt = buildPrompt('ai_extend', {
      selected_text,
      source_context: sourceContext,
      uploaded_context: uploadedContext,
    });

    // Call LLM
    const llmResponse = await fetch(`${getLLMBaseUrl()}/v1/chat/completions`, {
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
      project_id: projectId,
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
