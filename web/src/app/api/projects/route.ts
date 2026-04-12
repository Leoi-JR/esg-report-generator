import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import {
  resolveProjectDir,
  getDefaultTemplatePaths,
  getProjectStatus,
  parseProjectId,
  type ProjectStatus,
} from '@/lib/project-paths';
import { deleteProjectData } from '@/lib/db';

const PROJECT_ROOT = path.resolve(process.cwd(), '..');

interface ProjectInfo {
  id: string;
  name: string;
  companyName: string;
  year: string;
  description: string;
  status: ProjectStatus;
  uploadedFileCount: number;
  stats: {
    total: number;
    generated: number;
    skipped: number;
    error: number;
  } | null;
  generatedAt: string | null;
  hasData: boolean;
}

/**
 * 尝试读取 draft_results.json 的 summary 信息。
 */
function readDraftSummary(draftPath: string): {
  stats: ProjectInfo['stats'];
  generatedAt: string | null;
} {
  try {
    if (!fs.existsSync(draftPath)) return { stats: null, generatedAt: null };
    const raw = fs.readFileSync(draftPath, 'utf-8');
    const data = JSON.parse(raw);
    return {
      stats: data.summary ?? null,
      generatedAt: data.generated_at ?? null,
    };
  } catch {
    return { stats: null, generatedAt: null };
  }
}

/**
 * 统计目录中的文件数量（递归）。
 */
function countFiles(dirPath: string): number {
  try {
    if (!fs.existsSync(dirPath)) return 0;
    let count = 0;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isFile()) {
        count++;
      } else if (entry.isDirectory()) {
        count += countFiles(path.join(dirPath, entry.name));
      }
    }
    return count;
  } catch {
    return 0;
  }
}

/**
 * GET /api/projects
 *
 * 动态扫描 projects/ 目录，返回项目列表及统计。
 */
export async function GET() {
  const projects: ProjectInfo[] = [];

  // 扫描 projects/ 目录
  const projectsDir = path.join(PROJECT_ROOT, 'projects');
  if (fs.existsSync(projectsDir)) {
    const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;

      const projProcessed = path.join(projectsDir, entry.name, 'processed');
      const projDraftPath = path.join(projProcessed, 'report_draft', 'draft_results.json');
      const hasData = fs.existsSync(projProcessed);
      const summary = readDraftSummary(projDraftPath);
      const status = getProjectStatus(entry.name);
      const { companyName, year } = parseProjectId(entry.name);

      // 统计已上传文件数
      const materialsDir = path.join(projectsDir, entry.name, 'raw', '整理后资料');
      const uploadedFileCount = countFiles(materialsDir);

      projects.push({
        id: entry.name,
        name: `${companyName} ${year} ESG 报告`,
        companyName,
        year,
        description: `projects/${entry.name}/`,
        status,
        uploadedFileCount,
        stats: summary.stats,
        generatedAt: summary.generatedAt,
        hasData,
      });
    }
  }

  return NextResponse.json({ projects });
}

/**
 * POST /api/projects
 *
 * 创建新项目：建立目录结构并复制默认模板文件。
 *
 * Body: { companyName: string, year: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { companyName, year } = body as { companyName?: string; year?: string };

    // ── 校验 ──
    if (!companyName?.trim() || !year?.trim()) {
      return NextResponse.json(
        { error: '公司名称和年份不能为空' },
        { status: 400 }
      );
    }

    // 禁止路径分隔符
    if (/[\/\\]/.test(companyName) || /[\/\\]/.test(year)) {
      return NextResponse.json(
        { error: '名称中不能包含路径分隔符' },
        { status: 400 }
      );
    }

    // 年份格式校验
    if (!/^\d{4}$/.test(year.trim())) {
      return NextResponse.json(
        { error: '年份格式不正确（应为 4 位数字）' },
        { status: 400 }
      );
    }

    const projectId = `${companyName.trim()}_${year.trim()}`;
    const dirs = resolveProjectDir(projectId);

    // ── 检查是否已存在 ──
    if (fs.existsSync(dirs.root)) {
      return NextResponse.json(
        { error: `项目 ${projectId} 已存在` },
        { status: 409 }
      );
    }

    // ── 创建目录结构 ──
    await fsp.mkdir(dirs.raw, { recursive: true });
    await fsp.mkdir(dirs.processed, { recursive: true });

    // ── 复制默认模板文件 ──
    const templates = getDefaultTemplatePaths();

    // ESG报告框架.xlsx — 文件名一致，直接复制
    if (fs.existsSync(templates.frameworkExcel)) {
      await fsp.copyFile(templates.frameworkExcel, dirs.frameworkExcel);
    }

    // 定性清单 — 旧名（含企业名前缀）→ 新标准名 资料收集清单.xlsx
    if (fs.existsSync(templates.checklistExcel)) {
      await fsp.copyFile(templates.checklistExcel, dirs.checklistExcel);
    }

    return NextResponse.json(
      {
        id: projectId,
        companyName: companyName.trim(),
        year: year.trim(),
        status: 'no_data' as ProjectStatus,
        createdAt: new Date().toISOString(),
      },
      { status: 201 }
    );
  } catch (err) {
    console.error('Failed to create project:', err);
    return NextResponse.json(
      { error: `创建项目失败: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/projects
 *
 * 删除项目：清理数据库记录 + 删除文件系统目录。
 *
 * Body: { projectId: string }
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { projectId } = body as { projectId?: string };

    // ── 校验 ──
    if (!projectId?.trim()) {
      return NextResponse.json(
        { error: '项目 ID 不能为空' },
        { status: 400 }
      );
    }

    // 禁止路径穿越
    if (/[\/\\]/.test(projectId) || projectId.includes('..')) {
      return NextResponse.json(
        { error: '非法的项目 ID' },
        { status: 400 }
      );
    }

    const dirs = resolveProjectDir(projectId.trim());

    // ── 清理数据库 ──
    const dbResult = deleteProjectData(projectId.trim());

    // ── 删除文件系统 ──
    let filesDeleted = false;
    if (fs.existsSync(dirs.root)) {
      await fsp.rm(dirs.root, { recursive: true, force: true });
      filesDeleted = true;
    }

    return NextResponse.json({
      success: true,
      projectId: projectId.trim(),
      deleted: {
        ...dbResult,
        filesDeleted,
      },
    });
  } catch (err) {
    console.error('Failed to delete project:', err);
    return NextResponse.json(
      { error: `删除项目失败: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}
