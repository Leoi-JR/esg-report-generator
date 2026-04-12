'use client';

import { useEffect } from 'react';
import { CheckCircle2, XCircle, Clock, Loader2, Ban } from 'lucide-react';
import { usePipelineStore } from '@/lib/pipeline-store';
import type { PipelineRun } from '@/lib/pipeline-types';

const statusConfig: Record<string, { icon: typeof CheckCircle2; color: string; label: string }> = {
  pending:   { icon: Clock,         color: 'var(--text-4)',   label: '等待中' },
  running:   { icon: Loader2,       color: 'var(--indigo)',   label: '运行中' },
  completed: { icon: CheckCircle2,  color: 'var(--green)',    label: '已完成' },
  failed:    { icon: XCircle,       color: 'var(--red)',      label: '失败'   },
  cancelled: { icon: Ban,           color: 'var(--amber)',    label: '已取消' },
};

export default function RunHistory({ project }: { project?: string }) {
  const { runs, fetchRuns, fetchActiveRun, connectSSE, activeRun } = usePipelineStore();

  useEffect(() => {
    fetchRuns(project);
  }, [fetchRuns, project]);

  if (runs.length === 0) {
    return (
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        boxShadow: 'var(--shadow-sm)',
        padding: '14px 16px',
      }}>
        <h2 style={{
          fontFamily: 'var(--font-head)',
          fontSize: '12px', fontWeight: 700,
          color: 'var(--text-2)',
          letterSpacing: '0.04em',
          margin: '0 0 10px',
        }}>
          运行历史
        </h2>
        <p style={{ fontSize: '12px', color: 'var(--text-4)', textAlign: 'center', padding: '16px 0', fontFamily: 'var(--font-body)', margin: 0 }}>
          暂无运行记录
        </p>
      </div>
    );
  }

  const handleClickRun = (run: PipelineRun) => {
    fetchActiveRun(run.id);
    if (run.status === 'running') connectSSE(run.id);
  };

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      boxShadow: 'var(--shadow-sm)',
      padding: '14px 16px',
    }}>
      <h2 style={{
        fontFamily: 'var(--font-head)',
        fontSize: '12px', fontWeight: 700,
        color: 'var(--text-2)',
        letterSpacing: '0.04em',
        margin: '0 0 10px',
      }}>
        运行历史
      </h2>

      <div style={{ maxHeight: '256px', overflowY: 'auto' }}>
        {runs.map((run, idx) => {
          const cfg = statusConfig[run.status] ?? statusConfig.pending;
          const Icon = cfg.icon;
          const isActive = activeRun?.run.id === run.id;

          return (
            <button
              key={run.id}
              onClick={() => handleClickRun(run)}
              style={{
                width: '100%',
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '7px 8px',
                textAlign: 'left',
                background: isActive ? 'var(--indigo-soft)' : 'transparent',
                borderLeft: isActive ? '2px solid var(--indigo)' : '2px solid transparent',
                border: 'none',
                borderBottom: idx < runs.length - 1 ? '1px solid var(--border-light)' : 'none',
                cursor: 'pointer',
                transition: 'background 0.15s',
                fontFamily: 'var(--font-body)',
              }}
              onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-warm)'; }}
              onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
            >
              <Icon
                size={14}
                style={{ color: cfg.color, flexShrink: 0 }}
                className={run.status === 'running' ? 'animate-spin' : ''}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '11px', color: 'var(--text-1)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {run.id.slice(0, 8)}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-4)' }}>
                  {formatTime(run.created_at)}
                </div>
              </div>
              <span style={{ fontSize: '11px', fontWeight: 500, color: cfg.color, whiteSpace: 'nowrap' }}>
                {cfg.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}
