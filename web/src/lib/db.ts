import Database from 'better-sqlite3';
import path from 'path';

// Singleton database instance
let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = path.join(process.cwd(), 'data', 'esg_editor.db');
  db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');

  // Initialize schema
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
  `);

  return db;
}

// ─── Chapter Edits CRUD ───

export interface ChapterEdit {
  id: string;
  content: string;
  word_count: number;
  status: string;
  updated_at: string;
  created_at: string;
}

export function getEdit(chapterId: string): ChapterEdit | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM chapter_edits WHERE id = ?').get(chapterId) as ChapterEdit | undefined;
}

export function getAllEdits(): ChapterEdit[] {
  const db = getDb();
  return db.prepare('SELECT * FROM chapter_edits').all() as ChapterEdit[];
}

export function saveEdit(chapterId: string, content: string, wordCount: number): ChapterEdit {
  const db = getDb();
  const now = new Date().toISOString();

  const existing = getEdit(chapterId);

  if (existing) {
    db.prepare(`
      UPDATE chapter_edits SET content = ?, word_count = ?, updated_at = ? WHERE id = ?
    `).run(content, wordCount, now, chapterId);
  } else {
    db.prepare(`
      INSERT INTO chapter_edits (id, content, word_count, status, updated_at, created_at)
      VALUES (?, ?, ?, 'generated', ?, ?)
    `).run(chapterId, content, wordCount, now, now);
  }

  // Record version snapshot
  db.prepare(`
    INSERT INTO chapter_versions (chapter_id, content, word_count, created_at)
    VALUES (?, ?, ?, ?)
  `).run(chapterId, content, wordCount, now);

  return getEdit(chapterId)!;
}

export function updateChapterStatus(chapterId: string, status: string): void {
  const db = getDb();
  const now = new Date().toISOString();

  const existing = getEdit(chapterId);
  if (existing) {
    db.prepare('UPDATE chapter_edits SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, now, chapterId);
  } else {
    // Create a placeholder edit entry with status only
    // Content will be merged from draft_results on read
    db.prepare(`
      INSERT INTO chapter_edits (id, content, word_count, status, updated_at, created_at)
      VALUES (?, '', 0, ?, ?, ?)
    `).run(chapterId, status, now, now);
  }
}

// ─── Version History ───

export interface VersionRecord {
  version_id: number;
  chapter_id: string;
  content: string;
  word_count: number;
  change_summary: string | null;
  created_at: string;
}

export function getVersions(chapterId: string): VersionRecord[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM chapter_versions WHERE chapter_id = ? ORDER BY version_id DESC'
  ).all(chapterId) as VersionRecord[];
}

export function getVersion(versionId: number): VersionRecord | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM chapter_versions WHERE version_id = ?').get(versionId) as VersionRecord | undefined;
}

export function revertToVersion(chapterId: string, versionId: number): ChapterEdit | null {
  const version = getVersion(versionId);
  if (!version || version.chapter_id !== chapterId) return null;

  return saveEdit(chapterId, version.content, version.word_count || 0);
}

// ─── AI History ───

export interface AIHistoryRecord {
  id: number;
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
    INSERT INTO ai_history (chapter_id, action, input_text, source_context, uploaded_context, prompt, response, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
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

export function getAIHistory(chapterId: string): AIHistoryRecord[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM ai_history WHERE chapter_id = ? ORDER BY id DESC'
  ).all(chapterId) as AIHistoryRecord[];
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
