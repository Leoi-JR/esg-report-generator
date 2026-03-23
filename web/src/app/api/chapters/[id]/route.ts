import { NextRequest, NextResponse } from 'next/server';
import { getEdit, saveEdit, getAllEdits } from '@/lib/db';

// GET /api/chapters/:id — Get chapter edit (or all edits if id is "_all")
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    if (params.id === '_all') {
      const edits = getAllEdits();
      return NextResponse.json(edits);
    }

    const edit = getEdit(params.id);
    if (!edit) {
      return NextResponse.json({ found: false });
    }
    return NextResponse.json({ found: true, edit });
  } catch (error) {
    console.error('Failed to get chapter edit:', error);
    return NextResponse.json(
      { error: 'Failed to get chapter edit' },
      { status: 500 }
    );
  }
}

// PUT /api/chapters/:id — Save chapter edit
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { content, word_count } = body;

    if (!content && content !== '') {
      return NextResponse.json(
        { error: 'content is required' },
        { status: 400 }
      );
    }

    // Data integrity check: detect corrupted source tags [来源] without IDs
    const emptySourceTags = (content.match(/\[来源\]/g) || []).length;
    if (emptySourceTags > 0) {
      console.warn(
        `Blocked save for chapter ${params.id}: ${emptySourceTags} empty [来源] tags detected.` +
        ' This indicates a source tag rendering/serialization bug.'
      );
      return NextResponse.json(
        { error: `保存被阻止：检测到 ${emptySourceTags} 个空的 [来源] 标签（无来源编号）。请刷新页面重试。` },
        { status: 422 }
      );
    }

    const edit = saveEdit(params.id, content, word_count || content.length);

    return NextResponse.json({
      success: true,
      updated_at: edit.updated_at,
      edit,
    });
  } catch (error) {
    console.error('Failed to save chapter:', error);
    return NextResponse.json(
      { error: 'Failed to save chapter' },
      { status: 500 }
    );
  }
}
