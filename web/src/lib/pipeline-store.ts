import { create } from 'zustand';
import type {
  PipelineRun,
  StepRun,
  ProgressFileData,
  StartPipelineRequest,
  PipelineRunResponse,
} from './pipeline-types';

export interface RetrievalDiffResult {
  changed: string[];
  unchanged: string[];
  added: string[];
  hasPrev: boolean;
}

interface PipelineStore {
  // ─── State ───
  runs: PipelineRun[];
  activeRun: PipelineRunResponse | null;
  liveProgress: ProgressFileData | null;
  isConnected: boolean;
  isStarting: boolean;
  error: string | null;

  // ─── Retrieval diff ───
  retrievalDiff: RetrievalDiffResult | null;
  isFetchingDiff: boolean;

  // ─── Internal ───
  _eventSource: EventSource | null;

  // ─── Actions ───
  fetchRuns: (project?: string) => Promise<void>;
  fetchActiveRun: (runId: string) => Promise<void>;
  initForProject: (project?: string) => Promise<void>;  // 进入页面时自动加载
  startRun: (request: StartPipelineRequest) => Promise<string>;
  cancelRun: (runId: string) => Promise<void>;
  skipFailed: (runId: string) => Promise<void>;
  fetchRetrievalDiff: (project?: string) => Promise<void>;
  connectSSE: (runId: string) => void;
  disconnectSSE: () => void;
  clearError: () => void;
  reset: () => void;
}

export const usePipelineStore = create<PipelineStore>((set, get) => ({
  // ─── Initial State ───
  runs: [],
  activeRun: null,
  liveProgress: null,
  isConnected: false,
  isStarting: false,
  error: null,
  _eventSource: null,
  retrievalDiff: null,
  isFetchingDiff: false,

  // ─── Actions ───

  fetchRuns: async (project?: string) => {
    try {
      const qs = project ? `?project=${encodeURIComponent(project)}` : '';
      const res = await fetch(`/api/pipeline${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      set({ runs: data.runs ?? [] });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: `获取运行列表失败: ${msg}` });
    }
  },

  fetchActiveRun: async (runId: string) => {
    try {
      const res = await fetch(`/api/pipeline/${runId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: PipelineRunResponse = await res.json();
      set({ activeRun: data, liveProgress: data.progress });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: `获取运行详情失败: ${msg}` });
    }
  },

  // 进入 Pipeline 页面时调用：拉当前项目的历史，自动展示最相关的 run
  initForProject: async (project?: string) => {
    await get().fetchRuns(project);
    const { runs } = get();
    if (runs.length === 0) return;

    // 优先：正在运行的
    const running = runs.find(r => r.status === 'running' || r.status === 'pending');
    if (running) {
      await get().fetchActiveRun(running.id);
      get().connectSSE(running.id);
      return;
    }
    // 次选：最近一条（completed / failed / cancelled）
    await get().fetchActiveRun(runs[0].id);
  },

  startRun: async (request: StartPipelineRequest) => {
    set({ isStarting: true, error: null });
    try {
      const res = await fetch('/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const runId = data.runId as string;

      // 获取完整运行详情
      await get().fetchActiveRun(runId);
      // 连接 SSE
      get().connectSSE(runId);
      // 刷新列表
      await get().fetchRuns();

      set({ isStarting: false });
      return runId;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ isStarting: false, error: msg });
      throw err;
    }
  },

  cancelRun: async (runId: string) => {
    try {
      const res = await fetch(`/api/pipeline/${runId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      // 立即断开 SSE 并清除实时进度
      get().disconnectSSE();
      set({ liveProgress: null });
      // 重新获取最终状态（steps 已被后端标记为 cancelled/skipped）
      await get().fetchActiveRun(runId);
      // fetchActiveRun 会从进度文件恢复 liveProgress，再次清除
      set({ liveProgress: null });
      await get().fetchRuns();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: `取消失败: ${msg}` });
    }
  },

  skipFailed: async (runId: string) => {
    try {
      const res = await fetch(`/api/pipeline/${runId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'skip_failed' }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      // 重新连接 SSE 并刷新状态（后续步骤已开始）
      await get().fetchActiveRun(runId);
      get().connectSSE(runId);
      await get().fetchRuns();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: `跳过操作失败: ${msg}` });
    }
  },

  fetchRetrievalDiff: async (project?: string) => {
    set({ isFetchingDiff: true });
    try {
      const qs = project ? `?project=${encodeURIComponent(project)}` : '';
      const res = await fetch(`/api/pipeline/data/retrieval/diff${qs}`);
      if (!res.ok) {
        // 404 = 没有检索结果，不报错
        set({ retrievalDiff: null });
        return;
      }
      const data = await res.json() as RetrievalDiffResult;
      set({ retrievalDiff: data });
    } catch {
      set({ retrievalDiff: null });
    } finally {
      set({ isFetchingDiff: false });
    }
  },

  connectSSE: (runId: string) => {
    // 先断开已有连接
    get().disconnectSSE();

    const es = new EventSource(`/api/pipeline/progress/${runId}`);
    set({ _eventSource: es, isConnected: true });

    es.addEventListener('progress', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as ProgressFileData;
        set({ liveProgress: data });

        // 如果当前 step 发生变化，同步更新 activeRun.steps
        const { activeRun } = get();
        if (activeRun && data.step) {
          const updatedSteps = activeRun.steps.map((s: StepRun) => {
            if (s.step_name === data.step && s.status !== 'completed') {
              // 当前正在跑的 step → running
              return { ...s, status: 'running' as const };
            }
            if (s.step_name !== data.step && s.status === 'running') {
              // 其他还显示 running 的 step → 已完成（能跑到下一步说明上一步肯定结束了）
              return { ...s, status: 'completed' as const, exit_code: 0 };
            }
            return s;
          });
          set({
            activeRun: { ...activeRun, steps: updatedSteps },
          });
        }
      } catch {
        // malformed data — skip
      }
    });

    es.addEventListener('run_complete', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        // 重新获取完整状态
        get().fetchActiveRun(data.run_id || runId);
        get().fetchRuns();

        // 通知 Editor store 刷新数据
        if (data.status === 'completed') {
          import('./store').then(({ useEditorStore }) => {
            useEditorStore.getState().setPipelineRunCompleted(true);
          }).catch(() => { /* editor store may not be loaded */ });

          // 获取检索结果差异（若 retrieve_evidence 刚刚完成，快照已就绪）
          const { activeRun } = get();
          const configStr = activeRun?.run?.config;
          let project: string | undefined;
          if (configStr) {
            try {
              project = JSON.parse(configStr).project ?? undefined;
            } catch { /* ignore */ }
          }
          get().fetchRetrievalDiff(project);
        }
      } catch {
        // skip
      }
      get().disconnectSSE();
    });

    es.addEventListener('heartbeat', () => {
      // 保持连接标记（仅表明连接健康）
      set({ isConnected: true });
    });

    es.onerror = () => {
      set({ isConnected: false });
      // SSE 会自动重连，但如果服务器返回了 JSON（非 SSE），
      // 说明运行已结束（参见 SSE 路由的终态处理），手动关闭
      if (es.readyState === EventSource.CLOSED) {
        get().disconnectSSE();
        // 刷新最终状态
        get().fetchActiveRun(runId);
        get().fetchRuns();
      }
    };
  },

  disconnectSSE: () => {
    const { _eventSource } = get();
    if (_eventSource) {
      _eventSource.close();
      set({ _eventSource: null, isConnected: false });
    }
  },

  clearError: () => set({ error: null }),

  reset: () => {
    get().disconnectSSE();
    set({
      runs: [],
      activeRun: null,
      liveProgress: null,
      isConnected: false,
      isStarting: false,
      error: null,
      retrievalDiff: null,
      isFetchingDiff: false,
    });
  },
}));
