import { NextRequest, NextResponse } from 'next/server';
import { getAllEdits } from '@/lib/db';

interface ChapterResult {
  id: string;
  full_path: string;
  leaf_title: string;
  status: string;
  skip_reason: string | null;
  draft?: {
    content: string;
    word_count: number;
  };
}

export async function POST(request: NextRequest) {
  try {
    const { results } = await request.json() as { results: ChapterResult[] };

    // Merge with SQLite edits
    let editsMap: Map<string, { content: string }>;
    try {
      const edits = getAllEdits();
      editsMap = new Map(edits.filter(e => e.content).map(e => [e.id, { content: e.content }]));
    } catch {
      editsMap = new Map();
    }

    // Filter to generated/reviewed/approved chapters
    const chapters = results.filter(r => (r.status === 'generated' || r.status === 'reviewed' || r.status === 'approved') && r.draft);

    // Build markdown content
    let markdown = `# 江苏艾森半导体材料股份有限公司\n\n`;
    markdown += `## 2025年度环境、社会及公司治理（ESG）报告\n\n`;
    markdown += `---\n\n`;

    // Table of contents
    markdown += `## 目录\n\n`;
    let currentSection = '';
    for (const chapter of chapters) {
      const pathParts = chapter.full_path.split(' > ');
      const sectionTitle = pathParts[0];

      if (sectionTitle !== currentSection) {
        currentSection = sectionTitle;
        markdown += `\n### ${sectionTitle}\n\n`;
      }

      markdown += `- ${chapter.leaf_title}\n`;
    }
    markdown += `\n---\n\n`;

    // Content
    currentSection = '';
    for (const chapter of chapters) {
      const pathParts = chapter.full_path.split(' > ');
      const sectionTitle = pathParts[0];

      // Add section header if new section
      if (sectionTitle !== currentSection) {
        currentSection = sectionTitle;
        markdown += `# ${sectionTitle}\n\n`;
      }

      // Add chapter title
      markdown += `## ${chapter.leaf_title}\n\n`;

      // Add content
      if (chapter.draft?.content) {
        // Use edited content if available
        const edit = editsMap.get(chapter.id);
        const content = edit?.content || chapter.draft.content;

        // Clean up content - remove source tags
        const cleanContent = content
          .replace(/\[来源[\d,]+\]/g, '')
          .replace(/\[待补充[：:]([^\]]+)\]/g, '**[待补充：$1]**');

        markdown += cleanContent + '\n\n';
      }

      markdown += `---\n\n`;
    }

    // Add footer
    markdown += `\n\n---\n\n`;
    markdown += `*本报告由 ESG 报告编辑平台生成*\n`;
    markdown += `*生成时间：${new Date().toLocaleString('zh-CN')}*\n`;

    // Return as downloadable file
    const encoder = new TextEncoder();
    const buffer = encoder.encode(markdown);

    // Return as downloadable file
    // filename 用 ASCII 兜底，filename* 用 UTF-8 编码支持中文
    const encodedName = encodeURIComponent('艾森股份2025ESG报告.md');
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="esg-report.md"; filename*=UTF-8''${encodedName}`,
      },
    });
  } catch (error) {
    console.error('Export failed:', error);
    return NextResponse.json(
      { error: 'Export failed' },
      { status: 500 }
    );
  }
}
