import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { resolveProjectDir, parseProjectId } from '@/lib/project-paths';
import { generateFolderStructureZip } from '@/lib/python-bridge';

/**
 * GET /api/projects/[id]/template
 *
 * 生成并下载项目的目录结构 ZIP 模板。
 *
 * 缓存策略：首次生成后将 ZIP 缓存到项目 raw/ 目录下（~140KB），
 * 后续请求直接返回缓存文件（<10ms），避免每次耗时 30 秒的 Excel 解析。
 * 删除缓存文件可强制重新生成。
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  let tempDir: string | null = null;

  try {
    const projectId = decodeURIComponent(params.id);
    const dirs = resolveProjectDir(projectId);

    // 验证项目存在
    if (!fs.existsSync(dirs.root)) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    }

    const { companyName } = parseProjectId(projectId);

    // ── 缓存路径：projects/{id}/raw/.folder_template.zip ──
    const cachedZipPath = path.join(dirs.raw, '.folder_template.zip');
    const cachedZipName = `【${companyName}】ESG资料收集_文件夹模板.zip`;

    // 检查缓存
    if (fs.existsSync(cachedZipPath)) {
      const zipBuffer = await fsp.readFile(cachedZipPath);
      const encodedFileName = encodeURIComponent(cachedZipName);
      return new NextResponse(zipBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Length': String(zipBuffer.length),
          'Content-Disposition': `attachment; filename*=UTF-8''${encodedFileName}`,
        },
      });
    }

    // ── 首次生成：调用 Python 脚本 ──
    const referenceExcel = dirs.checklistExcel;
    if (!fs.existsSync(referenceExcel)) {
      return NextResponse.json(
        { error: '项目缺少资料收集清单文件（raw/资料收集清单.xlsx）' },
        { status: 400 }
      );
    }

    tempDir = path.join(dirs.root, '.tmp');
    await fsp.mkdir(tempDir, { recursive: true });

    const zipPath = await generateFolderStructureZip(
      companyName,
      referenceExcel,
      tempDir
    );

    // 读取生成的 ZIP
    const zipBuffer = await fsp.readFile(zipPath);

    // 缓存到项目目录（后续秒返回）
    await fsp.writeFile(cachedZipPath, zipBuffer);

    // 清理临时目录
    fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    tempDir = null;

    const encodedFileName = encodeURIComponent(cachedZipName);
    return new NextResponse(zipBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Length': String(zipBuffer.length),
        'Content-Disposition': `attachment; filename*=UTF-8''${encodedFileName}`,
      },
    });
  } catch (err) {
    console.error('Failed to generate template:', err);

    if (tempDir) {
      fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }

    return NextResponse.json(
      { error: `生成模板失败: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}
