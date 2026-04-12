import { NextRequest, NextResponse } from 'next/server';
import {
  getPlaygroundVersions,
  updatePlaygroundVersion,
  activatePlaygroundVersion,
  deletePlaygroundVersion,
} from '@/lib/db';

type Params = { params: { versionId: string } };

/**
 * GET /api/playground/:versionId
 * 获取单条版本详情（通过 project + chapter 查列表后筛选，避免额外查询函数）
 */
export async function GET(
  _req: NextRequest,
  { params }: Params
) {
  try {
    const id = parseInt(params.versionId, 10);
    if (isNaN(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

    // 直接用 getDb 查单条
    const { getDb } = await import('@/lib/db');
    const db = getDb();
    const row = db.prepare('SELECT * FROM playground_prompts WHERE id = ?').get(id);
    if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json(row);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/playground/:versionId
 * 双用途：
 *   body.action === 'activate' → 采用版本
 *   否则 → 更新 version_name / system_prompt / user_prompt
 */
export async function PATCH(
  req: NextRequest,
  { params }: Params
) {
  try {
    const id = parseInt(params.versionId, 10);
    if (isNaN(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

    const body = await req.json() as {
      action?: string;
      project?: string;
      chapter_id?: string;
      version_name?: string;
      system_prompt?: string;
      user_prompt?: string;
    };

    if (body.action === 'activate') {
      const project = body.project || 'default';
      if (!body.chapter_id) {
        return NextResponse.json({ error: 'chapter_id 必填' }, { status: 400 });
      }
      activatePlaygroundVersion(project, body.chapter_id, id);
      const versions = getPlaygroundVersions(project, body.chapter_id);
      return NextResponse.json({ versions });
    }

    // 更新字段
    const updated = updatePlaygroundVersion(id, {
      version_name: body.version_name,
      system_prompt: body.system_prompt,
      user_prompt: body.user_prompt,
    });
    return NextResponse.json({ version: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/playground/:versionId
 * 删除版本（is_active=1 时返回 400）
 */
export async function DELETE(
  _req: NextRequest,
  { params }: Params
) {
  try {
    const id = parseInt(params.versionId, 10);
    if (isNaN(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

    deletePlaygroundVersion(id);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // 已采用版本删除失败 → 400
    if (message.includes('已采用')) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
