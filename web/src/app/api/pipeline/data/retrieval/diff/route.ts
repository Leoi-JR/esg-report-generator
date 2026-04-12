import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { resolveProjectPaths } from '@/lib/project-paths';

interface TopChunk {
  chunk_id: string;
  [key: string]: unknown;
}

interface RetrievalEntry {
  id: string;
  top_chunks: TopChunk[];
  [key: string]: unknown;
}

interface DiffResult {
  changed: string[];     // Top-10 chunk_id 集合发生变化的章节
  unchanged: string[];   // 集合完全相同的章节
  added: string[];       // 当前有但快照中没有的章节（新增）
  hasPrev: boolean;      // 是否存在快照文件
}

function loadRetrievalResults(filePath: string): RetrievalEntry[] {
  if (!fs.existsSync(filePath)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return (data.results ?? data) as RetrievalEntry[];
  } catch {
    return [];
  }
}

function computeDiff(current: RetrievalEntry[], prev: RetrievalEntry[]): DiffResult {
  const prevMap = new Map<string, Set<string>>(
    prev.map(r => [r.id, new Set(r.top_chunks.map(c => c.chunk_id))])
  );

  const changed: string[] = [];
  const unchanged: string[] = [];
  const added: string[] = [];

  for (const entry of current) {
    const prevChunkIds = prevMap.get(entry.id);
    if (!prevChunkIds) {
      added.push(entry.id);
      continue;
    }
    const currentChunkIds = new Set(entry.top_chunks.map(c => c.chunk_id));
    const same =
      currentChunkIds.size === prevChunkIds.size &&
      Array.from(currentChunkIds).every(id => prevChunkIds.has(id));
    if (same) unchanged.push(entry.id);
    else changed.push(entry.id);
  }

  return { changed, unchanged, added, hasPrev: prev.length > 0 };
}

/**
 * GET /api/pipeline/data/retrieval/diff?project=xxx
 *
 * 对比当前 retrieval_results.json 与快照 retrieval_results_prev.json，
 * 返回哪些章节的 Top-10 chunk_id 集合发生了变化。
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const project = searchParams.get('project');

  let paths: ReturnType<typeof resolveProjectPaths>;
  try {
    paths = resolveProjectPaths(project);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const reportDraftDir = path.join(paths.projectDir, 'processed', 'report_draft');
  const currentPath = path.join(reportDraftDir, 'retrieval_results.json');
  const prevPath = path.join(reportDraftDir, 'retrieval_results_prev.json');

  if (!fs.existsSync(currentPath)) {
    return NextResponse.json(
      { error: '检索结果文件不存在，请先运行 Step 3' },
      { status: 404 }
    );
  }

  const current = loadRetrievalResults(currentPath);
  const prev = loadRetrievalResults(prevPath);

  const diff = computeDiff(current, prev);
  return NextResponse.json(diff);
}
