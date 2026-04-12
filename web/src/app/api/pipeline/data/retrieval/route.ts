import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import { resolveProjectPaths } from '@/lib/project-paths';

interface TopChunk {
  rank: number | string;
  score: number | string;
  score_rq: number | string;
  score_hyde: number | string;
  score_bm25?: number | string;
  source: string;
  chunk_id: string;
  file_name: string;
  folder_code: string;
  page_or_sheet: string;
  text: string;
  biencoder_rank?: number | string;
  score_biencoder?: number | string;
}

interface RetrievalItem {
  id: string;
  full_path: string;
  leaf_title: string;
  gloss: string;
  retrieval_query: string;
  hypothetical_doc: string;
  top_chunks: TopChunk[];
  stats: {
    avg_score: number;
    max_score: number;
    chunk_count: number;
    source_files: string[];
  };
}

// 内存缓存（按 project 键隔离，1 分钟 TTL）
const cacheMap = new Map<string, { data: RetrievalItem[]; ts: number }>();
const CACHE_TTL = 60_000;

function loadRetrieval(project: string | null): RetrievalItem[] {
  const key = project ?? '__default__';
  const cached = cacheMap.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;
  try {
    const paths = resolveProjectPaths(project);
    const raw = fs.readFileSync(paths.retrievalResults, 'utf-8');
    const items: RetrievalItem[] = JSON.parse(raw);
    cacheMap.set(key, { data: items, ts: Date.now() });
    return items;
  } catch {
    return [];
  }
}

/**
 * GET /api/pipeline/data/retrieval
 */
export async function GET(req: NextRequest) {
  const project = req.nextUrl.searchParams.get('project');
  const items = loadRetrieval(project);

  // 返回列表概要（不含完整 chunk text，减小 payload）
  const summary = items.map((item) => ({
    id: item.id,
    full_path: item.full_path,
    leaf_title: item.leaf_title,
    gloss: item.gloss,
    retrieval_query: item.retrieval_query,
    chunk_count: item.top_chunks.length,
    max_score: item.stats.max_score,
    avg_score: item.stats.avg_score,
    source_files: item.stats.source_files,
    top_chunks: item.top_chunks.map((c) => ({
      rank: Number(c.rank),
      score: Number(c.score),
      score_rq: Number(c.score_rq),
      score_hyde: Number(c.score_hyde),
      score_bm25: Number(c.score_bm25 ?? 0),
      source: c.source,
      chunk_id: c.chunk_id,
      file_name: c.file_name,
      folder_code: c.folder_code,
      page_or_sheet: c.page_or_sheet,
      text: c.text.length > 300 ? c.text.slice(0, 300) + '...' : c.text,
      biencoder_rank: c.biencoder_rank ? Number(c.biencoder_rank) : null,
      score_biencoder: c.score_biencoder ? Number(c.score_biencoder) : null,
    })),
  }));

  return NextResponse.json({
    items: summary,
    total: summary.length,
  });
}
