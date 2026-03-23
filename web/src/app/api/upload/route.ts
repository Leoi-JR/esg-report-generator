import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { saveUploadedFile, getUploadedFiles } from '@/lib/db';

const UPLOAD_DIR = path.join(process.cwd(), 'data', 'uploads');
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

// GET /api/upload — List uploaded files
export async function GET() {
  try {
    const files = getUploadedFiles();
    return NextResponse.json({ files });
  } catch (error) {
    console.error('Failed to list uploads:', error);
    return NextResponse.json({ error: 'Failed to list uploads' }, { status: 500 });
  }
}

// POST /api/upload — Upload a file
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File too large (max 20MB)' }, { status: 400 });
    }

    // Validate file type
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];
    const allowedExtensions = ['.pdf', '.docx', '.txt', '.xlsx'];
    const ext = path.extname(file.name).toLowerCase();

    if (!allowedExtensions.includes(ext)) {
      return NextResponse.json(
        { error: `Unsupported file type. Allowed: ${allowedExtensions.join(', ')}` },
        { status: 400 }
      );
    }

    // Ensure upload directory exists
    await mkdir(UPLOAD_DIR, { recursive: true });

    // Save file to disk
    const timestamp = Date.now();
    const safeFileName = `${timestamp}_${file.name.replace(/[^a-zA-Z0-9._\u4e00-\u9fff-]/g, '_')}`;
    const filePath = path.join(UPLOAD_DIR, safeFileName);

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await writeFile(filePath, buffer);

    // Extract text
    let extractedText = '';
    try {
      if (ext === '.txt') {
        extractedText = buffer.toString('utf-8');
      } else if (ext === '.pdf') {
        try {
          const { PDFParse } = await import('pdf-parse');
          const parser = new PDFParse({ data: new Uint8Array(buffer) });
          const textResult = await parser.getText();
          extractedText = textResult.text || '';
          await parser.destroy();
        } catch (pdfErr) {
          console.error('PDF parse error:', pdfErr);
          extractedText = `[PDF 文本提取失败: ${file.name}]`;
        }
      } else if (ext === '.docx') {
        const mammoth = await import('mammoth');
        const result = await mammoth.extractRawText({ buffer });
        extractedText = result.value;
      } else if (ext === '.xlsx') {
        // For xlsx, just note the file was uploaded - text extraction is limited
        extractedText = `[Excel 文件: ${file.name}]`;
      }
    } catch (extractError) {
      console.error('Text extraction failed:', extractError);
      extractedText = `[文本提取失败: ${file.name}]`;
    }

    // Truncate to 4000 chars for AI context
    if (extractedText.length > 4000) {
      extractedText = extractedText.slice(0, 4000) + '\n... (已截断)';
    }

    // Save to database
    const fileId = saveUploadedFile({
      file_name: file.name,
      file_path: filePath,
      file_size: file.size,
      mime_type: file.type || allowedTypes[allowedExtensions.indexOf(ext)] || 'application/octet-stream',
      extracted_text: extractedText,
    });

    return NextResponse.json({
      success: true,
      file: {
        id: fileId,
        file_name: file.name,
        file_size: file.size,
        extracted_text: extractedText ? extractedText.slice(0, 200) + '...' : '',
      },
    });
  } catch (error) {
    console.error('Upload failed:', error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
