// ─── Pipeline Types ─────────────────────────────────────────────────────────
// TypeScript 类型定义：流水线步骤、进度数据、SSE 事件、API 请求/响应

// ─── Step Definitions ───

export const PIPELINE_STEPS = [
  {
    name: 'align_evidence' as const,
    label: 'Step 1: 资料分析',
    script: 'align_evidence.py',
    description: '提取并分析上传的资料文档',
    stages: [
      'Load manifest',
      'Text extraction',
      'Chunking',
      'Table summaries',
      'Build embeddings',
      'Semantic search',
      'Output Excel',
    ],
    estimatedMinutes: 60,
    conda: 'esg',
  },
  {
    name: 'generate_retrieval_queries' as const,
    label: 'Step 2: 查询生成',
    script: 'generate_retrieval_queries.py',
    description: '为报告框架生成检索查询',
    stages: ['Parse Excel', 'Identify leaves', 'Base queries', 'HyDE docs', 'Validate'],
    estimatedMinutes: 10,
    conda: 'esg',
  },
  {
    name: 'generate_report_draft' as const,
    label: 'Step 3: 检索',
    script: 'generate_report_draft.py',
    description: '从资料中检索与章节相关的内容',
    stages: ['Dual embedding', 'BM25 scoring', 'RRF fusion', 'Reranker'],
    estimatedMinutes: 15,
    conda: 'esg',
  },
  {
    name: 'generate_draft' as const,
    label: 'Step 4: 初稿生成',
    script: 'generate_draft.py',
    description: 'AI 生成各章节初稿',
    stages: ['Load data', 'Quality filter', 'Generate drafts', 'Save results'],
    estimatedMinutes: 15,
    conda: 'esg',
    hasSubsteps: true, // 支持 119 章节级网格
  },
] as const;

export type StepName = (typeof PIPELINE_STEPS)[number]['name'];

export type StepDefinition = (typeof PIPELINE_STEPS)[number];

// ─── Progress File Shape (Python → JSON → Node.js) ───

export interface ProgressFileData {
  run_id: string;
  step: string;
  stage: string;
  status: 'running' | 'completed' | 'failed';
  current: number;
  total: number;
  detail: string;
  percent: number;
  started_at: number;
  updated_at: number;
  error: string | null;
  stages_completed: string[];
  substeps: Record<string, 'pending' | 'running' | 'done' | 'error'>;
  partial_failed: number;
  partial_failed_ids: string[];
}

// ─── SQLite Row Types ───

export interface PipelineRun {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'waiting_retry' | 'waiting_user';
  current_step: string | null;
  config: string; // JSON string
  steps: string; // JSON string of StepName[]
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  created_at: string;
  retry_count: number;
}

export interface StepRun {
  id: number;
  run_id: string;
  step_name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  pid: number | null;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  warning: string | null;
  exit_code: number | null;
}

// ─── SSE Event Types ───

export type PipelineSSEEvent =
  | { type: 'progress'; data: ProgressFileData }
  | { type: 'step_change'; data: { run_id: string; step: string; status: string } }
  | { type: 'run_complete'; data: { run_id: string; status: string; error?: string } }
  | { type: 'heartbeat'; data: { ts: number } };

// ─── API Types ───

export type RebuildLevel = 'embedding' | 'chunk' | 'extract' | 'all';

export interface StartPipelineRequest {
  steps: StepName[];
  project?: string; // 项目标识（default/null → 旧模式，其他 → projects/<project>/）
  config: {
    resume?: boolean;
    limit?: number;
    debug?: boolean;
    rebuild?: RebuildLevel; // 仅对 align_evidence 有效，级联：all/extract → chunk → embedding
    retryFailed?: boolean;  // 仅对 generate_retrieval_queries 有效，补跑 needs_manual_review 节点
    skipFailed?: boolean;   // 仅对 generate_retrieval_queries 有效，跳过失败节点继续后续步骤
  };
}

export interface PipelineRunResponse {
  run: PipelineRun;
  steps: StepRun[];
  progress: ProgressFileData | null;
}
