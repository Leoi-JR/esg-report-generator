import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { resolveProjectPaths } from '@/lib/project-paths';

export async function GET(req: NextRequest) {
  try {
    const project = req.nextUrl.searchParams.get('project');
    const paths = resolveProjectPaths(project);

    const fileContent = await readFile(paths.draftResults, 'utf-8');
    const data = JSON.parse(fileContent);

    return NextResponse.json(data);
  } catch (error) {
    console.error('Failed to load draft results:', error);
    return NextResponse.json(
      { error: 'Failed to load draft results' },
      { status: 500 }
    );
  }
}
