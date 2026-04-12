import { NextRequest } from 'next/server';
import { pipelineDb } from '@/lib/db';
import { readProgressFile } from '@/lib/pipeline-runner';

const POLL_INTERVAL = 500; // ms — 每 500ms 轮询一次进度文件

/**
 * SSE 端点：实时推送 pipeline 运行进度。
 *
 * 数据流：Python 写 JSON 文件 → 本端点轮询读取 → SSE 推送到浏览器。
 * 事件类型：
 *   - progress: 进度更新（Python 每 300ms 写一次，这里 500ms 读一次）
 *   - run_complete: 运行结束（completed/failed/cancelled）
 *   - heartbeat: 每 15s 一次，保持连接
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { runId: string } }
) {
  const { runId } = params;

  const run = pipelineDb.getRun(runId);
  if (!run) {
    return new Response('Run not found', { status: 404 });
  }

  // 如果运行已结束，返回最终状态而非 SSE 流
  if (['completed', 'failed', 'cancelled'].includes(run.status)) {
    const progress = readProgressFile(runId);
    return new Response(
      JSON.stringify({ run, progress: progress?.data ?? null }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let lastRaw = '';
      let tickCount = 0;

      const interval = setInterval(() => {
        try {
          // 1. 读取进度文件
          const result = readProgressFile(runId);
          if (result && result.raw !== lastRaw) {
            lastRaw = result.raw;
            controller.enqueue(
              encoder.encode(`event: progress\ndata: ${result.raw}\n\n`)
            );
          }

          // 2. 检查运行是否已结束（从 SQLite 读取权威状态）
          const currentRun = pipelineDb.getRun(runId);
          if (
            currentRun &&
            ['completed', 'failed', 'cancelled'].includes(currentRun.status)
          ) {
            const payload = JSON.stringify({
              run_id: runId,
              status: currentRun.status,
              error: currentRun.error,
            });
            controller.enqueue(
              encoder.encode(`event: run_complete\ndata: ${payload}\n\n`)
            );
            clearInterval(interval);
            controller.close();
            return;
          }

          // 3. 心跳（每 15 秒 = 30 ticks × 500ms）
          tickCount++;
          if (tickCount % 30 === 0) {
            controller.enqueue(
              encoder.encode(`event: heartbeat\ndata: {"ts":${Date.now()}}\n\n`)
            );
          }
        } catch {
          // 文件读取竞态——跳过这一轮
        }
      }, POLL_INTERVAL);

      // 客户端断开连接时清理
      req.signal.addEventListener('abort', () => {
        clearInterval(interval);
        try {
          controller.close();
        } catch {
          // 已关闭
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
