import { NextRequest, NextResponse } from 'next/server';
import { getVersions, revertToVersion } from '@/lib/db';

// GET /api/chapters/:id/versions — Get version history
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const projectId = request.nextUrl.searchParams.get('project') || 'default';
    const versions = getVersions(projectId, params.id);
    return NextResponse.json({ versions });
  } catch (error) {
    console.error('Failed to get versions:', error);
    return NextResponse.json(
      { error: 'Failed to get versions' },
      { status: 500 }
    );
  }
}

// POST /api/chapters/:id/versions — Revert to a specific version
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { version_id, project_id } = body;
    const projectId = project_id || 'default';

    if (!version_id) {
      return NextResponse.json(
        { error: 'version_id is required' },
        { status: 400 }
      );
    }

    const edit = revertToVersion(projectId, params.id, version_id);
    if (!edit) {
      return NextResponse.json(
        { error: 'Version not found or does not belong to this chapter' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      edit,
    });
  } catch (error) {
    console.error('Failed to revert version:', error);
    return NextResponse.json(
      { error: 'Failed to revert version' },
      { status: 500 }
    );
  }
}
