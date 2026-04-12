// ESG Report Editor Types

export type ChapterStatus = 'generated' | 'skipped' | 'reviewed' | 'approved';

export interface SourceMapping {
  chunk_id: string;
  file_name: string;
  page: string;
  score: number;
}

export interface Draft {
  content: string;
  word_count: number;
  cited_sources: string[];
  sources_mapping: Record<string, SourceMapping>;
  token_usage?: {
    prompt: number;
    completion: number;
  };
}

export interface ContextSummary {
  chunks_provided: number;
  max_score: number;
  avg_score: number;
}

export interface ChapterResult {
  id: string;
  full_path: string;
  leaf_title: string;
  status: ChapterStatus;
  skip_reason: string | null;
  draft?: Draft;
  context_summary: ContextSummary;
}

export interface DraftResults {
  generated_at: string;
  config: {
    model: string;
    text_limit: number;
    score_threshold: number;
    concurrency: number;
  };
  summary: {
    total: number;
    generated: number;
    skipped: number;
    error: number;
    total_tokens: {
      prompt: number;
      completion: number;
    };
  };
  results: ChapterResult[];
}

/**
 * ChunkRecord - 文档分块记录
 *
 * Phase 1-3 优化后的结构（2026-03-26）：
 * - 移除 parent_text（改为存储在 parents 映射中，减少 80% 冗余）
 * - 移除 chunk_index（通过 chunk_id 中的类型标识区分）
 * - 新增表格相关字段：is_table, table_summary, table_html, table_markdown, table_rows
 *
 * chunk_id 格式：{path}#{section_id}#{type}{index}[p{part}]
 * - type: 'c' 表示正文内容，'t' 表示表格
 * - 例如：A-总体概况/A3/公司介绍.pdf#s2#t0（第一个表格）
 */
export interface ChunkRecord {
  chunk_id: string;
  parent_id: string;
  file_path: string;
  file_name: string;
  folder_code: string;
  page_or_sheet: string;
  section_title: string;
  text: string;
  char_count: number;

  // 表格专用字段（Phase 1-2 新增）
  is_table?: boolean;           // 是否为表格 chunk
  table_summary?: string;       // LLM 生成的表格摘要（100-300 字）
  table_html?: string;          // 原始 HTML 表格
  table_markdown?: string;      // Markdown 格式表格
  table_rows?: number;          // 表格行数
}

// Tree structure for sidebar navigation
export interface TreeNode {
  id: string;
  label: string;
  fullPath: string;
  isLeaf: boolean;
  status?: ChapterStatus;
  skipReason?: string | null;
  children: TreeNode[];
  chapterIndex?: number; // index in results array
}

// Source with full text from chunks
export interface SourceWithText extends SourceMapping {
  id: string;
  text: string;
  is_cited: boolean;
  is_table: boolean;  // Phase 1-3: 标识是否为表格来源
}

// ─── P1 Types ───

export type EditorMode = 'edit' | 'review';

export type AIAction = 'polish' | 'extend' | 'verify' | 'freeform';

export interface AIRequest {
  chapter_id: string;
  selected_text: string;
  source_texts: { id: string; text: string }[];
  uploaded_file_ids: number[];
  action: AIAction;
  custom_prompt?: string;  // for freeform action
}

export interface AIResponse {
  text: string;
  ai_history_id: number;
  action: AIAction;
}

export interface VersionRecord {
  version_id: number;
  chapter_id: string;
  content: string;
  word_count: number;
  change_summary: string | null;
  created_at: string;
}

export interface UploadedFile {
  id: number;
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string | null;
  extracted_text: string | null;
  created_at: string;
}

export interface ChapterEditData {
  id: string;
  content: string;
  word_count: number;
  status: string;
  updated_at: string;
}

export interface SaveResponse {
  success: boolean;
  version_id?: number;
  updated_at?: string;
  error?: string;
}
