import Database from 'better-sqlite3';
import path from 'path';

// Singleton database instance
let db: Database.Database | null = null;

/** Current schema version. Bump when adding migrations. */
const SCHEMA_VERSION = 2;

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = path.join(process.cwd(), 'data', 'esg_editor.db');
  db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');

  // ── V1: Initial schema ──
  db.exec(`
    -- 章节编辑内容（覆盖层，仅存储有修改的章节）
    CREATE TABLE IF NOT EXISTS chapter_edits (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      word_count INTEGER,
      status TEXT DEFAULT 'generated',
      updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    -- 版本历史（每次保存记录一条）
    CREATE TABLE IF NOT EXISTS chapter_versions (
      version_id INTEGER PRIMARY KEY AUTOINCREMENT,
      chapter_id TEXT NOT NULL,
      content TEXT NOT NULL,
      word_count INTEGER,
      change_summary TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (chapter_id) REFERENCES chapter_edits(id)
    );

    -- AI 交互记录
    CREATE TABLE IF NOT EXISTS ai_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chapter_id TEXT NOT NULL,
      action TEXT NOT NULL,
      input_text TEXT NOT NULL,
      source_context TEXT,
      uploaded_context TEXT,
      prompt TEXT NOT NULL,
      response TEXT NOT NULL,
      accepted INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    -- 上传文件记录
    CREATE TABLE IF NOT EXISTS uploaded_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER,
      mime_type TEXT,
      extracted_text TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_versions_chapter ON chapter_versions(chapter_id);
    CREATE INDEX IF NOT EXISTS idx_ai_chapter ON ai_history(chapter_id);

    -- Pipeline Dashboard: 운行记录
    CREATE TABLE IF NOT EXISTS pipeline_runs (
      id           TEXT PRIMARY KEY,
      status       TEXT NOT NULL DEFAULT 'pending',
      current_step TEXT,
      config       TEXT NOT NULL DEFAULT '{}',
      steps        TEXT NOT NULL DEFAULT '[]',
      started_at   TEXT,
      completed_at TEXT,
      error        TEXT,
      retry_count  INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL
    );

    -- Pipeline Dashboard: 步骤执行记录
    CREATE TABLE IF NOT EXISTS pipeline_step_runs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id       TEXT NOT NULL REFERENCES pipeline_runs(id),
      step_name    TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending',
      pid          INTEGER,
      started_at   TEXT,
      completed_at TEXT,
      error        TEXT,
      warning      TEXT,
      exit_code    INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_step_runs_run ON pipeline_step_runs(run_id);
  `);

  // ── V2: 多项目隔离 — 为 chapter_edits / chapter_versions / ai_history 添加 project_id ──
  const currentVersion = (db.pragma('user_version', { simple: true }) as number) ?? 0;
  if (currentVersion < SCHEMA_VERSION) {
    db.exec('BEGIN TRANSACTION');
    try {
      // chapter_edits: 需要重建表（改主键为复合主键）
      // 检查旧表是否存在且没有 project_id 列
      const editsColumns = db.prepare("PRAGMA table_info(chapter_edits)").all() as { name: string }[];
      const hasProjectId = editsColumns.some(c => c.name === 'project_id');

      if (!hasProjectId) {
        db.exec(`
          CREATE TABLE chapter_edits_v2 (
            project_id TEXT NOT NULL DEFAULT 'default',
            id TEXT NOT NULL,
            content TEXT NOT NULL,
            word_count INTEGER,
            status TEXT DEFAULT 'generated',
            updated_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY (project_id, id)
          );
          INSERT INTO chapter_edits_v2 (project_id, id, content, word_count, status, updated_at, created_at)
            SELECT 'default', id, content, word_count, status, updated_at, created_at FROM chapter_edits;
          DROP TABLE chapter_edits;
          ALTER TABLE chapter_edits_v2 RENAME TO chapter_edits;
        `);
      }

      // chapter_versions: 新增列即可
      const versionsColumns = db.prepare("PRAGMA table_info(chapter_versions)").all() as { name: string }[];
      if (!versionsColumns.some(c => c.name === 'project_id')) {
        db.exec(`ALTER TABLE chapter_versions ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default'`);
      }

      // ai_history: 新增列即可
      const aiColumns = db.prepare("PRAGMA table_info(ai_history)").all() as { name: string }[];
      if (!aiColumns.some(c => c.name === 'project_id')) {
        db.exec(`ALTER TABLE ai_history ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default'`);
      }

      // 创建索引加速按项目查询
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_edits_project ON chapter_edits(project_id);
        CREATE INDEX IF NOT EXISTS idx_versions_project ON chapter_versions(project_id, chapter_id);
        CREATE INDEX IF NOT EXISTS idx_ai_project ON ai_history(project_id, chapter_id);
      `);

      db.pragma(`user_version = ${SCHEMA_VERSION}`);
      db.exec('COMMIT');
      console.log(`[DB] Migrated schema to version ${SCHEMA_VERSION} (multi-project isolation)`);
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  // ── 列级迁移（幂等，用 try/catch 忽略"列已存在"错误）──
  try { db.exec(`ALTER TABLE pipeline_runs ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE pipeline_step_runs ADD COLUMN warning TEXT`); } catch {}

  return db;
}

// ─── Chapter Edits CRUD ───

export interface ChapterEdit {
  project_id: string;
  id: string;
  content: string;
  word_count: number;
  status: string;
  updated_at: string;
  created_at: string;
}

export function getEdit(projectId: string, chapterId: string): ChapterEdit | undefined {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM chapter_edits WHERE project_id = ? AND id = ?'
  ).get(projectId, chapterId) as ChapterEdit | undefined;
}

export function getAllEdits(projectId: string): ChapterEdit[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM chapter_edits WHERE project_id = ?'
  ).all(projectId) as ChapterEdit[];
}

export function saveEdit(projectId: string, chapterId: string, content: string, wordCount: number): ChapterEdit {
  const db = getDb();
  const now = new Date().toISOString();

  const existing = getEdit(projectId, chapterId);

  if (existing) {
    db.prepare(`
      UPDATE chapter_edits SET content = ?, word_count = ?, updated_at = ?
      WHERE project_id = ? AND id = ?
    `).run(content, wordCount, now, projectId, chapterId);
  } else {
    db.prepare(`
      INSERT INTO chapter_edits (project_id, id, content, word_count, status, updated_at, created_at)
      VALUES (?, ?, ?, ?, 'generated', ?, ?)
    `).run(projectId, chapterId, content, wordCount, now, now);
  }

  // Record version snapshot
  db.prepare(`
    INSERT INTO chapter_versions (project_id, chapter_id, content, word_count, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(projectId, chapterId, content, wordCount, now);

  return getEdit(projectId, chapterId)!;
}

export function updateChapterStatus(projectId: string, chapterId: string, status: string): void {
  const db = getDb();
  const now = new Date().toISOString();

  const existing = getEdit(projectId, chapterId);
  if (existing) {
    db.prepare('UPDATE chapter_edits SET status = ?, updated_at = ? WHERE project_id = ? AND id = ?')
      .run(status, now, projectId, chapterId);
  } else {
    // Create a placeholder edit entry with status only
    // Content will be merged from draft_results on read
    db.prepare(`
      INSERT INTO chapter_edits (project_id, id, content, word_count, status, updated_at, created_at)
      VALUES (?, ?, '', 0, ?, ?, ?)
    `).run(projectId, chapterId, status, now, now);
  }
}

/**
 * 清除指定项目的章节编辑记录（Pipeline 重新生成初稿后使用）。
 * 同时清除关联的版本历史，避免外键约束冲突。
 * 返回被删除的编辑行数。
 */
export function clearAllEdits(projectId: string): number {
  const db = getDb();
  // 先删版本历史
  db.prepare('DELETE FROM chapter_versions WHERE project_id = ?').run(projectId);
  const result = db.prepare('DELETE FROM chapter_edits WHERE project_id = ?').run(projectId);
  return result.changes;
}

// ─── Version History ───

export interface VersionRecord {
  version_id: number;
  project_id: string;
  chapter_id: string;
  content: string;
  word_count: number;
  change_summary: string | null;
  created_at: string;
}

export function getVersions(projectId: string, chapterId: string): VersionRecord[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM chapter_versions WHERE project_id = ? AND chapter_id = ? ORDER BY version_id DESC'
  ).all(projectId, chapterId) as VersionRecord[];
}

export function getVersion(versionId: number): VersionRecord | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM chapter_versions WHERE version_id = ?').get(versionId) as VersionRecord | undefined;
}

export function revertToVersion(projectId: string, chapterId: string, versionId: number): ChapterEdit | null {
  const version = getVersion(versionId);
  if (!version || version.chapter_id !== chapterId || version.project_id !== projectId) return null;

  return saveEdit(projectId, chapterId, version.content, version.word_count || 0);
}

// ─── AI History ───

export interface AIHistoryRecord {
  id: number;
  project_id: string;
  chapter_id: string;
  action: string;
  input_text: string;
  source_context: string | null;
  uploaded_context: string | null;
  prompt: string;
  response: string;
  accepted: number;
  created_at: string;
}

export function saveAIHistory(params: {
  project_id: string;
  chapter_id: string;
  action: string;
  input_text: string;
  source_context?: string;
  uploaded_context?: string;
  prompt: string;
  response: string;
}): number {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO ai_history (project_id, chapter_id, action, input_text, source_context, uploaded_context, prompt, response, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.project_id,
    params.chapter_id,
    params.action,
    params.input_text,
    params.source_context || null,
    params.uploaded_context || null,
    params.prompt,
    params.response,
    now
  );
  return Number(result.lastInsertRowid);
}

export function updateAIAccepted(id: number, accepted: number): void {
  const db = getDb();
  db.prepare('UPDATE ai_history SET accepted = ? WHERE id = ?').run(accepted, id);
}

export function getAIHistory(projectId: string, chapterId: string): AIHistoryRecord[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM ai_history WHERE project_id = ? AND chapter_id = ? ORDER BY id DESC'
  ).all(projectId, chapterId) as AIHistoryRecord[];
}

// ─── Uploaded Files ───

export interface UploadedFileRecord {
  id: number;
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string | null;
  extracted_text: string | null;
  created_at: string;
}

export function saveUploadedFile(params: {
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  extracted_text?: string;
}): number {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO uploaded_files (file_name, file_path, file_size, mime_type, extracted_text, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    params.file_name,
    params.file_path,
    params.file_size,
    params.mime_type,
    params.extracted_text || null,
    now
  );
  return Number(result.lastInsertRowid);
}

export function getUploadedFiles(): UploadedFileRecord[] {
  const db = getDb();
  return db.prepare('SELECT * FROM uploaded_files ORDER BY id DESC').all() as UploadedFileRecord[];
}

export function getUploadedFile(id: number): UploadedFileRecord | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM uploaded_files WHERE id = ?').get(id) as UploadedFileRecord | undefined;
}

// ─── Pipeline Runs CRUD ───

import type { PipelineRun, StepRun } from './pipeline-types';

export const pipelineDb = {
  insertRun(id: string, config: object, steps: string[]): void {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO pipeline_runs (id, status, config, steps, created_at)
      VALUES (?, 'pending', ?, ?, ?)
    `).run(id, JSON.stringify(config), JSON.stringify(steps), now);
  },

  updateRun(id: string, updates: {
    status?: string;
    currentStep?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
    error?: string | null;
    retryCount?: number;
  }): void {
    const db = getDb();
    const run = db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get(id) as PipelineRun | undefined;
    if (!run) return;

    db.prepare(`
      UPDATE pipeline_runs
      SET status = ?, current_step = ?, started_at = COALESCE(?, started_at),
          completed_at = ?, error = ?, retry_count = ?
      WHERE id = ?
    `).run(
      updates.status ?? run.status,
      updates.currentStep !== undefined ? updates.currentStep : run.current_step,
      updates.startedAt ?? null,
      updates.completedAt ?? run.completed_at,
      updates.error !== undefined ? updates.error : run.error,
      updates.retryCount !== undefined ? updates.retryCount : (run.retry_count ?? 0),
      id
    );
  },

  getRun(id: string): PipelineRun | undefined {
    const db = getDb();
    return db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get(id) as PipelineRun | undefined;
  },

  getRecentRuns(limit = 20): PipelineRun[] {
    const db = getDb();
    return db.prepare('SELECT * FROM pipeline_runs ORDER BY created_at DESC LIMIT ?').all(limit) as PipelineRun[];
  },

  getRecentRunsByProject(project: string, limit = 20): PipelineRun[] {
    const db = getDb();
    // config 字段是 JSON 字符串，用 json_extract 按项目过滤
    return db.prepare(
      `SELECT * FROM pipeline_runs
       WHERE json_extract(config, '$.project') = ?
          OR (? = 'default' AND json_extract(config, '$.project') IS NULL)
       ORDER BY created_at DESC LIMIT ?`
    ).all(project, project, limit) as PipelineRun[];
  },

  insertStepRun(runId: string, stepName: string): void {
    const db = getDb();
    db.prepare(`
      INSERT INTO pipeline_step_runs (run_id, step_name, status) VALUES (?, ?, 'pending')
    `).run(runId, stepName);
  },

  updateStepRun(runId: string, stepName: string, updates: {
    status?: string;
    pid?: number | null;
    startedAt?: string | null;
    completedAt?: string | null;
    error?: string | null;
    warning?: string | null;
    exitCode?: number | null;
  }): void {
    const db = getDb();
    const existing = db.prepare(
      'SELECT * FROM pipeline_step_runs WHERE run_id = ? AND step_name = ?'
    ).get(runId, stepName) as StepRun | undefined;
    if (!existing) return;

    db.prepare(`
      UPDATE pipeline_step_runs
      SET status = ?, pid = ?, started_at = COALESCE(?, started_at),
          completed_at = ?, error = ?, warning = ?, exit_code = ?
      WHERE run_id = ? AND step_name = ?
    `).run(
      updates.status ?? existing.status,
      updates.pid !== undefined ? updates.pid : existing.pid,
      updates.startedAt ?? null,
      updates.completedAt ?? existing.completed_at,
      updates.error !== undefined ? updates.error : existing.error,
      updates.warning !== undefined ? updates.warning : existing.warning,
      updates.exitCode !== undefined ? updates.exitCode : existing.exit_code,
      runId,
      stepName
    );
  },

  getStepRuns(runId: string): StepRun[] {
    const db = getDb();
    return db.prepare(
      'SELECT * FROM pipeline_step_runs WHERE run_id = ? ORDER BY id'
    ).all(runId) as StepRun[];
  },
};

// ─── Project Deletion ───

/**
 * 删除指定项目在数据库中的所有关联数据。
 * 手动管理事务，在事务外关闭 FK 检查（SQLite 不允许在事务内切换 PRAGMA foreign_keys）。
 * 返回各表删除的行数。
 */
export function deleteProjectData(projectId: string): {
  edits: number;
  versions: number;
  aiHistory: number;
  pipelineRuns: number;
  pipelineSteps: number;
} {
  const db = getDb();

  const result = { edits: 0, versions: 0, aiHistory: 0, pipelineRuns: 0, pipelineSteps: 0 };

  // 必须在事务外关闭 FK 检查
  db.pragma('foreign_keys = OFF');

  try {
    db.exec('BEGIN');

    // 1. chapter_versions
    const r1 = db.prepare('DELETE FROM chapter_versions WHERE project_id = ?').run(projectId);
    result.versions = r1.changes;

    // 2. chapter_edits
    const r2 = db.prepare('DELETE FROM chapter_edits WHERE project_id = ?').run(projectId);
    result.edits = r2.changes;

    // 3. ai_history
    const r3 = db.prepare('DELETE FROM ai_history WHERE project_id = ?').run(projectId);
    result.aiHistory = r3.changes;

    // 4. pipeline_runs + pipeline_step_runs
    const allRuns = db.prepare('SELECT id, config FROM pipeline_runs').all() as { id: string; config: string }[];
    const matchingRunIds: string[] = [];
    for (const row of allRuns) {
      try {
        const cfg = JSON.parse(row.config);
        if (cfg.project === projectId) {
          matchingRunIds.push(row.id);
        }
      } catch {
        // malformed JSON — skip
      }
    }

    if (matchingRunIds.length > 0) {
      const placeholders = matchingRunIds.map(() => '?').join(',');
      const r4 = db.prepare(`DELETE FROM pipeline_step_runs WHERE run_id IN (${placeholders})`).run(...matchingRunIds);
      result.pipelineSteps = r4.changes;
      const r5 = db.prepare(`DELETE FROM pipeline_runs WHERE id IN (${placeholders})`).run(...matchingRunIds);
      result.pipelineRuns = r5.changes;
    }

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    db.pragma('foreign_keys = ON');
  }

  return result;
}
