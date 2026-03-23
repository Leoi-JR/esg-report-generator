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

export interface ChunkRecord {
  chunk_id: string;
  parent_id: string;
  file_path: string;
  file_name: string;
  folder_code: string;
  page_or_sheet: string;
  chunk_index: number;
  text: string;
  parent_text: string;
  section_title: string;
  char_count: number;
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
}

// Editor state
export interface EditorState {
  selectedChapterId: string | null;
  searchQuery: string;
  statusFilter: 'all' | 'generated' | 'skipped' | 'reviewed';
  expandedNodes: Set<string>;
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
