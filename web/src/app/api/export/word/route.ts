import { NextRequest, NextResponse } from 'next/server';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  PageBreak,
} from 'docx';
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
    const { results, project_id } = await request.json() as { results: ChapterResult[]; project_id?: string };
    const projectId = project_id || 'default';

    // 从 projectId 推导企业名和年份
    const lastUnderscore = projectId.lastIndexOf('_');
    const companyName = lastUnderscore > 0 ? projectId.substring(0, lastUnderscore) : projectId;
    const reportYear = lastUnderscore > 0 ? projectId.substring(lastUnderscore + 1) : '';

    // Merge with SQLite edits
    let editsMap: Map<string, { content: string; word_count: number }>;
    try {
      const edits = getAllEdits(projectId);
      editsMap = new Map(edits.filter(e => e.content).map(e => [e.id, { content: e.content, word_count: e.word_count }]));
    } catch {
      editsMap = new Map();
    }

    // Group chapters by first-level path
    const chapters = results.filter(r => (r.status === 'generated' || r.status === 'reviewed' || r.status === 'approved') && r.draft);

    // Create document sections
    const docChildren: Paragraph[] = [];

    // Title page
    docChildren.push(
      new Paragraph({
        children: [
          new TextRun({
            text: companyName,
            bold: true,
            size: 48,
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `${reportYear ? reportYear + '年度' : ''}`,
            size: 36,
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: '环境、社会及公司治理（ESG）报告',
            bold: true,
            size: 44,
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 800 },
      }),
      new Paragraph({
        children: [new PageBreak()],
      })
    );

    // Content
    let currentSection = '';

    for (const chapter of chapters) {
      const pathParts = chapter.full_path.split(' > ');
      const sectionTitle = pathParts[0];

      // Add section header if new section
      if (sectionTitle !== currentSection) {
        currentSection = sectionTitle;
        docChildren.push(
          new Paragraph({
            text: sectionTitle,
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 400, after: 200 },
          })
        );
      }

      // Add chapter title
      docChildren.push(
        new Paragraph({
          text: chapter.leaf_title,
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 300, after: 150 },
        })
      );

      // Add content
      if (chapter.draft?.content) {
        // Use edited content if available
        const edit = editsMap.get(chapter.id);
        const content = edit?.content || chapter.draft.content;

        // Remove source tags and clean up content
        const cleanContent = content
          .replace(/\[来源[\d,]+\]/g, '')
          .replace(/\[待补充[：:][^\]]+\]/g, '[待补充]');

        const paragraphs = cleanContent.split('\n\n');
        for (const para of paragraphs) {
          if (para.trim()) {
            docChildren.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: para.trim(),
                    size: 24,
                  }),
                ],
                spacing: { after: 150 },
              })
            );
          }
        }
      }
    }

    // Create document
    const doc = new Document({
      sections: [
        {
          properties: {},
          children: docChildren,
        },
      ],
    });

    // Generate buffer
    const buffer = await Packer.toBuffer(doc);

    // Convert Buffer to Uint8Array for NextResponse
    const uint8Array = new Uint8Array(buffer);

    // Return as downloadable file
    // filename 用 ASCII 兜底，filename* 用 UTF-8 编码支持中文
    const exportFileName = `${companyName}${reportYear}ESG报告.docx`;
    const encodedName = encodeURIComponent(exportFileName);
    return new NextResponse(uint8Array, {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition':
          `attachment; filename="esg-report.docx"; filename*=UTF-8''${encodedName}`,
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
