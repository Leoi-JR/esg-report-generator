import { NextRequest, NextResponse } from 'next/server';
import { pipelineDb } from '@/lib/db';
import { startPipelineRun, cleanupProgressFiles } from '@/lib/pipeline-runner';
import { StartPipelineRequest, PIPELINE_STEPS, StepName } from '@/lib/pipeline-types';

const VALID_STEP_NAMES = new Set(PIPELINE_STEPS.map((s) => s.name));

/**
 * GET /api/pipeline?project=xxx — 获取指定项目的最近运行列表
 */
export async function GET(req: NextRequest) {
  try {
    const project = req.nextUrl.searchParams.get('project');
    const runs = project
      ? pipelineDb.getRecentRunsByProject(project)
      : pipelineDb.getRecentRuns(20);
    return NextResponse.json({ runs });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/pipeline — 启动新的 pipeline 运行
 *
 * Body: { steps: StepName[], config: { resume?, limit?, debug? } }
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as StartPipelineRequest;

    // 校验 steps
    if (!body.steps || !Array.isArray(body.steps) || body.steps.length === 0) {
      return NextResponse.json(
        { error: '至少选择一个步骤' },
        { status: 400 }
      );
    }

    for (const step of body.steps) {
      if (!VALID_STEP_NAMES.has(step as StepName)) {
        return NextResponse.json(
          { error: `未知步骤: ${step}` },
          { status: 400 }
        );
      }
    }

    // 检查是否有正在运行的 pipeline
    const recent = pipelineDb.getRecentRuns(5);
    const activeRun = recent.find((r) => r.status === 'running' || r.status === 'pending');
    if (activeRun) {
      return NextResponse.json(
        { error: '已有运行中的 Pipeline，请等待完成或取消后再试', activeRunId: activeRun.id },
        { status: 409 }
      );
    }

    // 清理旧进度文件
    cleanupProgressFiles();

    // 启动
    const { runId } = startPipelineRun(body);

    return NextResponse.json({ runId }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
