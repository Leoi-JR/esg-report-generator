import { NextRequest, NextResponse } from 'next/server';
import {
  getPlaygroundVersions,
  createPlaygroundVersion,
} from '@/lib/db';

/**
 * GET /api/playground?project=xxx&chapter=yyy
 * 获取章节的所有 prompt 版本（按创建时间升序）
 */
export async function GET(req: NextRequest) {
  try {
    const project = req.nextUrl.searchParams.get('project') || 'default';
    const chapter = req.nextUrl.searchParams.get('chapter');

    if (!chapter) {
      return NextResponse.json({ error: 'chapter 参数必填' }, { status: 400 });
    }

    const versions = getPlaygroundVersions(project, chapter);
    return NextResponse.json(versions);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/playground
 * 新建 prompt 版本
 * body: { project: string, chapter_id: string, version_name?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { project?: string; chapter_id?: string; version_name?: string };
    const project = body.project || 'default';
    const { chapter_id, version_name } = body;

    if (!chapter_id) {
      return NextResponse.json({ error: 'chapter_id 必填' }, { status: 400 });
    }

    const version = createPlaygroundVersion(project, chapter_id, version_name || '新版本');
    return NextResponse.json({ version }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
