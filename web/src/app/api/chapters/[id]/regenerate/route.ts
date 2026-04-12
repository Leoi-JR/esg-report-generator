import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { resolveProjectPaths } from '@/lib/project-paths';

const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const SRC_DIR = path.join(PROJECT_ROOT, 'src');

/**
 * POST /api/chapters/[id]/regenerate
 * body: { project: string }
 *
 * 对单个章节调用 generate_draft.py --chapter-ids <id>，
 * 完成后返回该章节的最新内容。
 *
 * 前提：retrieval_results.json 必须已存在（Step 3 已完成）。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;

  if (!id || !id.trim()) {
    return NextResponse.json({ error: '章节 ID 不能为空' }, { status: 400 });
  }

  const body = await req.json().catch(() => ({})) as { project?: string };

  let paths: ReturnType<typeof resolveProjectPaths>;
  try {
    paths = resolveProjectPaths(body.project);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // 验证检索结果已存在（Step 3 必须已完成）
  if (!fs.existsSync(paths.retrievalResults)) {
    return NextResponse.json(
      { error: '检索结果不存在，请先运行 Step 3（检索）' },
      { status: 400 }
    );
  }

  // 验证章节 ID 在检索结果中存在
  try {
    const retrieval = JSON.parse(fs.readFileSync(paths.retrievalResults, 'utf-8'));
    const exists = (retrieval.results ?? retrieval).some((r: { id: string }) => r.id === id);
    if (!exists) {
      return NextResponse.json(
        { error: `章节 ID "${id}" 在检索结果中不存在` },
        { status: 404 }
      );
    }
  } catch {
    return NextResponse.json({ error: '无法读取检索结果文件' }, { status: 500 });
  }

  // 同步运行 generate_draft.py --chapter-ids <id>（单章节通常 10-30s）
  const scriptPath = path.join(SRC_DIR, 'generate_draft.py');
  const exitCode = await runDraftForChapter(id, paths.projectDir, scriptPath);

  if (exitCode !== 0) {
    return NextResponse.json(
      { error: `初稿生成失败（exit code ${exitCode}），请检查日志` },
      { status: 500 }
    );
  }

  // 读取更新后的 draft_results.json，返回该章节的最新内容
  try {
    const draftData = JSON.parse(fs.readFileSync(paths.draftResults, 'utf-8'));
    const results = draftData.results ?? draftData;
    const chapter = results.find((r: { id: string }) => r.id === id);

    if (!chapter) {
      return NextResponse.json(
        { error: '生成完成但未在结果文件中找到对应章节' },
        { status: 500 }
      );
    }

    return NextResponse.json({ chapter });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `读取生成结果失败: ${msg}` }, { status: 500 });
  }
}

/**
 * 使用 conda run 调用 generate_draft.py --chapter-ids <id>。
 * 超时 120 秒（单章节足够）。
 */
function runDraftForChapter(
  chapterId: string,
  projectDir: string,
  scriptPath: string
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'conda',
      [
        'run', '-n', 'esg',
        'python3', scriptPath,
        '--chapter-ids', chapterId,
        '--project-dir', projectDir,
      ],
      {
        cwd: PROJECT_ROOT,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 16384) stderr = stderr.slice(-16384);
    });

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('单章节重生成超时（120s）'));
    }, 120_000);

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === null) {
        reject(new Error('进程被终止'));
      } else {
        if (code !== 0) {
          const lastLines = stderr.trim().split('\n').slice(-10).join('\n');
          console.error(`[regenerate] chapter ${chapterId} exit ${code}\n${lastLines}`);
        }
        resolve(code);
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}
