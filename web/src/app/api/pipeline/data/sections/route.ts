import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import { resolveProjectPaths } from '@/lib/project-paths';

interface Section {
  section_id: string;
  page_or_sheet: string;
  text: string;
  section_title: string;
}

interface FileGroup {
  file_path: string;
  section_count: number;
  sections: Section[];
}

// 内存缓存（按 project 键隔离，1 分钟 TTL）
const cacheMap = new Map<string, { data: FileGroup[]; ts: number }>();
const CACHE_TTL = 60_000;

function loadSections(project: string | null): FileGroup[] {
  const key = project ?? '__default__';
  const cached = cacheMap.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;
  try {
    const paths = resolveProjectPaths(project);
    const raw = fs.readFileSync(paths.sectionsCache, 'utf-8');
    const parsed: Record<string, Section[]> = JSON.parse(raw);

    const groups: FileGroup[] = Object.entries(parsed).map(([filePath, sections]) => ({
      file_path: filePath,
      section_count: sections.length,
      sections: sections.map((s) => ({
        ...s,
        text: s.text.length > 500 ? s.text.slice(0, 500) + '...' : s.text,
      })),
    }));

    groups.sort((a, b) => a.file_path.localeCompare(b.file_path));
    cacheMap.set(key, { data: groups, ts: Date.now() });
    return groups;
  } catch {
    return [];
  }
}

/**
 * GET /api/pipeline/data/sections
 */
export async function GET(req: NextRequest) {
  const project = req.nextUrl.searchParams.get('project');
  const groups = loadSections(project);

  return NextResponse.json({
    groups,
    totalFiles: groups.length,
    totalSections: groups.reduce((sum, g) => sum + g.section_count, 0),
  });
}
