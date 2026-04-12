import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import { resolveProjectPaths } from '@/lib/project-paths';

// 内存缓存（按 project 键隔离，1 分钟 TTL）
const cacheMap = new Map<string, { data: ChunkRecord[]; ts: number }>();
const CACHE_TTL = 60_000;

interface ChunkRecord {
  chunk_id: string;
  parent_id: string;
  file_path: string;
  file_name: string;
  folder_code: string;
  page_or_sheet: string;
  section_title: string;
  text: string;
  char_count: string | number;
}

function loadChunks(project: string | null): ChunkRecord[] {
  const key = project ?? '__default__';
  const cached = cacheMap.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;
  try {
    const paths = resolveProjectPaths(project);
    const raw = fs.readFileSync(paths.chunksCache, 'utf-8');
    const parsed = JSON.parse(raw);
    const chunks: ChunkRecord[] = parsed.chunks ?? [];
    cacheMap.set(key, { data: chunks, ts: Date.now() });
    return chunks;
  } catch {
    return [];
  }
}

/**
 * GET /api/pipeline/data/chunks
 * Query params: page, pageSize, folder_code, is_table, search, project
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const project = searchParams.get('project');
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const pageSize = Math.min(100, Math.max(10, parseInt(searchParams.get('pageSize') ?? '50', 10)));
  const folderCode = searchParams.get('folder_code') ?? '';
  const isTable = searchParams.get('is_table');
  const search = (searchParams.get('search') ?? '').toLowerCase();

  let chunks = loadChunks(project);

  // 筛选
  if (folderCode) {
    chunks = chunks.filter((c) => c.folder_code === folderCode);
  }
  if (isTable === 'true') {
    chunks = chunks.filter((c) => c.section_title?.includes('表格'));
  } else if (isTable === 'false') {
    chunks = chunks.filter((c) => !c.section_title?.includes('表格'));
  }
  if (search) {
    chunks = chunks.filter(
      (c) =>
        c.text.toLowerCase().includes(search) ||
        c.file_name.toLowerCase().includes(search) ||
        c.chunk_id.toLowerCase().includes(search)
    );
  }

  const total = chunks.length;
  const totalPages = Math.ceil(total / pageSize);
  const start = (page - 1) * pageSize;
  const items = chunks.slice(start, start + pageSize);

  // 去除 file_path（安全，不暴露服务器路径）
  const safeItems = items.map(({ file_path: _fp, ...rest }) => rest);

  // 收集所有 folder_codes 供筛选
  const allCodes = Array.from(new Set(loadChunks(project).map((c) => c.folder_code))).sort();

  return NextResponse.json({
    items: safeItems,
    total,
    page,
    pageSize,
    totalPages,
    folderCodes: allCodes,
  });
}
