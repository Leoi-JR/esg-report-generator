import { NextRequest, NextResponse } from 'next/server';
import { updateChapterStatus } from '@/lib/db';

// PATCH /api/chapters/:id/status — Update chapter status
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { status } = body;

    const validStatuses = ['generated', 'reviewed', 'approved'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      );
    }

    updateChapterStatus(params.id, status);

    return NextResponse.json({
      success: true,
      chapter_id: params.id,
      status,
    });
  } catch (error) {
    console.error('Failed to update chapter status:', error);
    return NextResponse.json(
      { error: 'Failed to update chapter status' },
      { status: 500 }
    );
  }
}
