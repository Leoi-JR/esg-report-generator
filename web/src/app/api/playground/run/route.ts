import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import { resolveProjectPaths } from '@/lib/project-paths';
import { savePlaygroundOutput } from '@/lib/db';
import { getLLMConfig } from '@/lib/llm-config';

interface TopChunk {
  rank: number;
  score: number;
  file_name: string;
  page_or_sheet: string | number;
  text?: string;
  parent_text?: string;
}

interface RetrievalEntry {
  id: string;
  full_path?: string;
  leaf_title?: string;
  gloss?: string;
  retrieval_query?: string;
  top_chunks: TopChunk[];
}

/**
 * 将 top_chunks 格式化为 context_text + available_sources
 * 对应 draft_report.py 的 prepare_context() 函数
 */
function buildContext(entry: RetrievalEntry): {
  contextText: string;
  availableSources: string;
} {
  const lines: string[] = [];
  const sourceKeys: string[] = [];

  for (const chunk of entry.top_chunks) {
    const rank = chunk.rank;
    const fileName = chunk.file_name || '未知文件';
    const page = chunk.page_or_sheet ?? '?';
    const score = typeof chunk.score === 'number' ? chunk.score.toFixed(2) : '?';
    const rawText = chunk.parent_text || chunk.text || '';
    const text = rawText.slice(0, 2000);

    lines.push(`[来源${rank} 开始] ${fileName} | 第${page}页 | 相关度: ${score}`);
    lines.push(text);
    lines.push(`[来源${rank} 结束]`);
    lines.push('');
    sourceKeys.push(String(rank));
  }

  return {
    contextText: lines.join('\n'),
    availableSources: sourceKeys.map(k => `[来源${k}]`).join(', '),
  };
}

/**
 * 将 user_prompt_template 中的占位符填充（Python str.format 风格，用 {key}）
 */
function fillTemplate(template: string, vars: Record<string, string>): string {
  try {
    return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
  } catch {
    return template;
  }
}

/**
 * POST /api/playground/run
 * body: {
 *   version_id: number,
 *   system_prompt: string,
 *   user_prompt_template: string,
 *   chapter_id: string,
 *   project: string,
 * }
 * Response: text/event-stream（SSE）
 * 每条消息格式：data: {"delta":"..."}\n\n
 * 结束消息格式：data: {"done":true}\n\n
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    version_id?: number;
    system_prompt?: string;
    user_prompt_template?: string;
    chapter_id?: string;
    project?: string;
  };

  const { version_id, system_prompt, user_prompt_template, chapter_id, project } = body;

  if (!chapter_id || !project) {
    return NextResponse.json({ error: 'chapter_id 和 project 必填' }, { status: 400 });
  }
  if (!system_prompt && !user_prompt_template) {
    return NextResponse.json({ error: 'system_prompt 或 user_prompt_template 必填' }, { status: 400 });
  }

  // 读取检索结果
  let paths: ReturnType<typeof resolveProjectPaths>;
  try {
    paths = resolveProjectPaths(project);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }

  if (!fs.existsSync(paths.retrievalResults)) {
    return NextResponse.json(
      { error: '检索结果不存在，请先运行 Step 3（检索）' },
      { status: 400 }
    );
  }

  let retrievalData: RetrievalEntry[];
  try {
    retrievalData = JSON.parse(fs.readFileSync(paths.retrievalResults, 'utf-8')) as RetrievalEntry[];
  } catch {
    return NextResponse.json({ error: '检索结果文件损坏' }, { status: 500 });
  }

  const entry = retrievalData.find(r => r.id === chapter_id);
  if (!entry) {
    return NextResponse.json(
      { error: `章节 ${chapter_id} 在检索结果中不存在` },
      { status: 400 }
    );
  }

  if (!entry.top_chunks || entry.top_chunks.length === 0) {
    return NextResponse.json(
      { error: '该章节无检索结果，无法运行（可能已被跳过）' },
      { status: 400 }
    );
  }

  // 构建上下文
  const { contextText, availableSources } = buildContext(entry);

  // 填充 user prompt 模板
  const filledUserPrompt = fillTemplate(user_prompt_template || '', {
    full_path:       entry.full_path       || '',
    leaf_title:      entry.leaf_title      || '',
    gloss:           entry.gloss           || '',
    retrieval_query: entry.retrieval_query || '',
    context_text:    contextText,
    available_sources: availableSources,
  });

  // 调用 LLM（stream: true）
  const llmConfig = getLLMConfig();
  console.log('[playground/run] LLM config:', { chatUrl: llmConfig.chatUrl, model: llmConfig.model, keyPrefix: llmConfig.apiKey.slice(0, 8) });
  let llmResponse: Response;
  try {
    llmResponse = await fetch(llmConfig.chatUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${llmConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: llmConfig.model,
        messages: [
          { role: 'system', content: system_prompt || '' },
          { role: 'user',   content: filledUserPrompt },
        ],
        stream: true,
        stream_options: { include_usage: true },
        temperature: 0.7,
        enable_thinking: llmConfig.enableThinking,
      }),
      signal: AbortSignal.timeout(llmConfig.timeoutMs),
    });
  } catch (err: unknown) {
    console.error('[playground/run] fetch threw:', err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `LLM 调用失败: ${msg}` }, { status: 502 });
  }

  if (!llmResponse.ok) {
    const errText = await llmResponse.text().catch(() => '');
    console.error('[playground/run] LLM error:', llmResponse.status, errText);
    return NextResponse.json({ error: `LLM API 错误 ${llmResponse.status}: ${errText}` }, { status: 502 });
  }

  if (!llmResponse.body) {
    return NextResponse.json({ error: 'LLM 响应无 body' }, { status: 502 });
  }

  // 代理 SSE 流：提取 delta.content，转发给前端；flush 时保存完整输出
  const versionId = version_id;
  let accumulated = '';

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const transformStream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      const text = decoder.decode(chunk, { stream: true });
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const dataStr = trimmed.slice(5).trim();
        if (dataStr === '[DONE]') continue;
        try {
          const parsed = JSON.parse(dataStr);
          const delta: string = parsed?.choices?.[0]?.delta?.content || '';
          if (delta) {
            accumulated += delta;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`));
          }
        } catch {
          // malformed SSE line — skip
        }
      }
    },
    flush(controller) {
      // 流结束：发送 done 事件，然后持久化输出
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));

      // 异步写 DB（flush 不能 await，用 void 后台执行）
      if (versionId !== undefined && accumulated) {
        void Promise.resolve().then(() => {
          try {
            savePlaygroundOutput(versionId, accumulated);
          } catch {
            // 保存失败不影响前端
          }
        });
      }
    },
  });

  return new Response(llmResponse.body.pipeThrough(transformStream), {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
