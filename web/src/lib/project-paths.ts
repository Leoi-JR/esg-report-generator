import path from 'path';

/**
 * 项目数据路径解析。
 *
 * 映射规则：
 *   - project="艾森股份_2025" → projects/艾森股份_2025/processed/
 *
 * 旧的 data/processed/ 兼容模式已删除，必须传入有效的项目名。
 */

// 项目根目录（web/ 的上一级）
const PROJECT_ROOT = path.resolve(process.cwd(), '..');

export interface ProjectPaths {
  /** processed/ 目录绝对路径 */
  processed: string;
  /** draft_results.json 绝对路径 */
  draftResults: string;
  /** chunks_cache.json 绝对路径 */
  chunksCache: string;
  /** sections_cache.json 绝对路径 */
  sectionsCache: string;
  /** retrieval_results.json 绝对路径 */
  retrievalResults: string;
  /** CLI --project-dir 参数值 */
  projectDir: string;
}

/**
 * 根据 project 查询参数解析数据目录。
 *
 * @param project - URL 查询参数 ?project=xxx（必传，不能为空或 "default"）
 * @throws 当 project 为空时抛出错误
 */
export function resolveProjectPaths(project?: string | null): ProjectPaths {
  if (!project || project === 'default') {
    throw new Error('project is required. Legacy data/ mode has been removed.');
  }

  // projects/{project}/
  const projectBase = path.join(PROJECT_ROOT, 'projects', project);
  const processed = path.join(projectBase, 'processed');
  return {
    processed,
    draftResults: path.join(processed, 'report_draft', 'draft_results.json'),
    chunksCache: path.join(processed, 'chunks_cache.json'),
    sectionsCache: path.join(processed, 'sections_cache.json'),
    retrievalResults: path.join(processed, 'report_draft', 'retrieval_results.json'),
    projectDir: projectBase,
  };
}

/**
 * 已知项目接口（保留供未来使用）。
 * 首页项目列表现已改为动态扫描 projects/ 目录（GET /api/projects）。
 */
export interface KnownProject {
  id: string;
  name: string;
  description: string;
}

// ─── 项目创建 / 管理辅助函数 ────────────────────────────────────

/**
 * 默认模板文件路径（新项目创建时复制到项目 raw/ 目录）。
 * 模板文件存放在仓库根目录的 templates/，已由 git 追踪，新环境 clone 后即可用。
 */
export function getDefaultTemplatePaths() {
  return {
    frameworkExcel: path.join(PROJECT_ROOT, 'templates', 'ESG报告框架.xlsx'),
    checklistExcel: path.join(PROJECT_ROOT, 'templates', '资料收集清单.xlsx'),
  };
}

/**
 * 解析项目 ID 对应的所有目录/文件路径。
 */
export function resolveProjectDir(projectId: string) {
  const projectDir = path.join(PROJECT_ROOT, 'projects', projectId);
  return {
    root: projectDir,
    raw: path.join(projectDir, 'raw'),
    processed: path.join(projectDir, 'processed'),
    frameworkExcel: path.join(projectDir, 'raw', 'ESG报告框架.xlsx'),
    checklistExcel: path.join(projectDir, 'raw', '资料收集清单.xlsx'),
    uploadedMaterials: path.join(projectDir, 'raw', '整理后资料'),
  };
}

export type ProjectStatus = 'no_data' | 'data_uploaded' | 'draft_generated';

/**
 * 从文件系统推断项目状态。
 */
export function getProjectStatus(projectId: string): ProjectStatus {
  const fs = require('fs') as typeof import('fs');
  const dirs = resolveProjectDir(projectId);

  // draft_generated: draft_results.json 存在
  const draftPath = path.join(dirs.processed, 'report_draft', 'draft_results.json');
  if (fs.existsSync(draftPath)) return 'draft_generated';

  // data_uploaded: 整理后资料/ 存在且非空
  try {
    const entries = fs.readdirSync(dirs.uploadedMaterials);
    if (entries.length > 0) return 'data_uploaded';
  } catch {
    // 目录不存在
  }

  return 'no_data';
}

/**
 * 解析项目文件夹名为公司名 + 年份。
 * "艾森股份_2025" → { companyName: "艾森股份", year: "2025" }
 */
export function parseProjectId(projectId: string): { companyName: string; year: string } {
  const lastUnderscore = projectId.lastIndexOf('_');
  if (lastUnderscore === -1) {
    return { companyName: projectId, year: '' };
  }
  return {
    companyName: projectId.substring(0, lastUnderscore),
    year: projectId.substring(lastUnderscore + 1),
  };
}
