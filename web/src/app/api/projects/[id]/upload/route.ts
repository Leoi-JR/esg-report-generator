import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import { resolveProjectDir } from '@/lib/project-paths';
import { extractZipToDir } from '@/lib/zip-utils';

const MAX_FILE_SIZE = 3 * 1024 * 1024 * 1024; // 3GB

/**
 * POST /api/projects/[id]/upload
 *
 * 上传资料 ZIP 文件并自动解压到项目 raw/整理后资料/ 目录。
 * 支持最大 1GB 文件。
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  let tempFilePath: string | null = null;

  try {
    const projectId = decodeURIComponent(params.id);
    const dirs = resolveProjectDir(projectId);

    // 验证项目存在
    if (!fs.existsSync(dirs.root)) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    }

    // 解析 multipart form data
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: '请上传文件' }, { status: 400 });
    }

    // 验证文件类型
    if (!file.name.toLowerCase().endsWith('.zip')) {
      return NextResponse.json({ error: '请上传 .zip 文件' }, { status: 400 });
    }

    // 验证文件大小
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: '文件大小超过 1GB 限制' },
        { status: 413 }
      );
    }

    // 写入临时文件
    tempFilePath = path.join(os.tmpdir(), `esg-upload-${Date.now()}.zip`);
    const arrayBuffer = await file.arrayBuffer();
    await fsp.writeFile(tempFilePath, Buffer.from(arrayBuffer));

    // 解压到 raw/整理后资料/（清空旧数据）
    const result = await extractZipToDir(tempFilePath, dirs.uploadedMaterials, {
      clearTarget: true,
      stripRootFolder: true,
    });

    return NextResponse.json({
      success: true,
      fileCount: result.fileCount,
      totalSize: result.totalSize,
      message: `成功上传 ${result.fileCount} 个文件`,
    });
  } catch (err) {
    console.error('Upload failed:', err);
    return NextResponse.json(
      { error: `上传处理失败: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  } finally {
    // 清理临时文件
    if (tempFilePath) {
      await fsp.rm(tempFilePath, { force: true }).catch(() => {});
    }
  }
}
