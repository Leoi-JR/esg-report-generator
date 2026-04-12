'use client';

import { useMemo } from 'react';
import type { ProgressFileData } from '@/lib/pipeline-types';

interface Props {
  progress: ProgressFileData | null;
}

// 每种状态对应的 CSS 变量色（遵循 style-C-warm 规范）
const statusStyle: Record<string, { bg: string; border: string }> = {
  pending: { bg: 'var(--border)',      border: 'transparent' },
  running: { bg: 'var(--indigo)',      border: 'transparent' },
  done:    { bg: 'var(--green)',       border: 'transparent' },
  error:   { bg: 'var(--red)',         border: 'transparent' },
};

export default function ChapterGrid({ progress }: Props) {
  const substeps = progress?.substeps ?? {};
  const entries = useMemo(() => {
    return Object.entries(substeps).sort(([a], [b]) => a.localeCompare(b));
  }, [substeps]);

  if (entries.length === 0) return null;

  const counts = {
    total:   entries.length,
    done:    entries.filter(([, s]) => s === 'done').length,
    running: entries.filter(([, s]) => s === 'running').length,
    error:   entries.filter(([, s]) => s === 'error').length,
    pending: entries.filter(([, s]) => s === 'pending').length,
  };

  // 图例配置
  const legend = [
    { color: 'var(--green)',  count: counts.done,    label: '完成' },
    { color: 'var(--indigo)', count: counts.running,  label: '运行中' },
    { color: 'var(--red)',    count: counts.error,    label: '错误' },
    { color: 'var(--border)', count: counts.pending,  label: '等待' },
  ];

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      boxShadow: 'var(--shadow-sm)',
      padding: '14px 16px',
      fontFamily: 'var(--font-body)',
    }}>
      {/* 标题 + 图例 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <h2 style={{
          fontFamily: 'var(--font-head)',
          fontSize: '12px', fontWeight: 700,
          color: 'var(--text-2)',
          letterSpacing: '0.04em',
          margin: 0,
        }}>
          章节进度
          <span style={{ fontFamily: 'var(--font-body)', fontWeight: 400, color: 'var(--text-4)', marginLeft: '6px' }}>
            {counts.done}/{counts.total}
          </span>
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {legend.filter(l => l.count > 0).map(l => (
            <span key={l.label} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--text-4)' }}>
              <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '2px', background: l.color, flexShrink: 0 }} />
              {l.count}
            </span>
          ))}
        </div>
      </div>

      {/* 格子网格 */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, 10px)',
        gap: '3px',
      }}>
        {entries.map(([id, status]) => {
          const s = statusStyle[status as string] ?? statusStyle.pending;
          return (
            <div
              key={id}
              title={`${id}: ${status}`}
              style={{
                width: '10px', height: '10px',
                borderRadius: '2px',
                background: s.bg,
                ...(status === 'running' ? { opacity: 0.8 } : {}),
                cursor: 'default',
                flexShrink: 0,
              }}
              className={status === 'running' ? 'animate-pulse' : ''}
            />
          );
        })}
      </div>
    </div>
  );
}
