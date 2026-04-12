import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { resolveProjectPaths } from '@/lib/project-paths';

/**
 * 加载 chunks_cache.json 并返回 chunks 数组
 *
 * 数据结构（Phase 1-3 优化后）：
 * {
 *   "parents": { parent_id: parent_text, ... },
 *   "chunks": [ ChunkRecord, ... ]
 * }
 *
 * 返回：chunks 数组（兼容前端 setChunksCache）
 */
export async function GET(req: NextRequest) {
  try {
    const project = req.nextUrl.searchParams.get('project');
    const paths = resolveProjectPaths(project);

    const fileContent = await readFile(paths.chunksCache, 'utf-8');
    const data = JSON.parse(fileContent);

    // 新结构：{ parents, chunks }，提取 chunks 数组
    // 兼容旧结构：直接是数组
    const chunks = Array.isArray(data) ? data : (data.chunks || []);

    return NextResponse.json(chunks);
  } catch (error) {
    console.error('Failed to load chunks cache:', error);
    return NextResponse.json(
      { error: 'Failed to load chunks cache' },
      { status: 500 }
    );
  }
}
