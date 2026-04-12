import { NextRequest, NextResponse } from 'next/server';
import { pipelineDb } from '@/lib/db';
import { readProgressFile, cancelPipelineRun, skipFailedAndContinue } from '@/lib/pipeline-runner';
import type { PipelineRunResponse } from '@/lib/pipeline-types';

/**
 * GET /api/pipeline/:runId — 获取运行详情（包含 steps + 实时进度）
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { runId: string } }
) {
  const { runId } = params;

  const run = pipelineDb.getRun(runId);
  if (!run) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  }

  const steps = pipelineDb.getStepRuns(runId);
  const progressResult = readProgressFile(runId);

  const response: PipelineRunResponse = {
    run,
    steps,
    progress: progressResult?.data ?? null,
  };

  return NextResponse.json(response);
}

/**
 * DELETE /api/pipeline/:runId — 取消运行中的 pipeline
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { runId: string } }
) {
  const { runId } = params;

  const success = cancelPipelineRun(runId);
  if (!success) {
    return NextResponse.json(
      { error: '无法取消：运行不存在或已结束' },
      { status: 400 }
    );
  }

  return NextResponse.json({ success: true, runId });
}

/**
 * POST /api/pipeline/:runId — 对运行执行操作
 * body: { action: 'skip_failed' }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { runId: string } }
) {
  const { runId } = params;
  const body = await req.json().catch(() => ({})) as { action?: string };

  if (body.action === 'skip_failed') {
    const ok = skipFailedAndContinue(runId);
    if (!ok) {
      return NextResponse.json(
        { error: '当前运行不在等待用户操作的状态' },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: '未知操作' }, { status: 400 });
}
