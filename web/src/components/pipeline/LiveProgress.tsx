'use client';

import type { ProgressFileData } from '@/lib/pipeline-types';

interface Props {
  progress: ProgressFileData | null;
}

export default function LiveProgress({ progress }: Props) {
  if (!progress || progress.status === 'completed') return null;

  const percent = Math.min(100, Math.max(0, progress.percent || 0));
  const hasTotal = progress.total > 0;
  const isFailed = progress.status === 'failed';

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      boxShadow: 'var(--shadow-sm)',
      padding: '14px 16px',
      fontFamily: 'var(--font-body)',
    }}>
      <h2 style={{
        fontFamily: 'var(--font-head)',
        fontSize: '12px', fontWeight: 700,
        color: 'var(--text-2)',
        letterSpacing: '0.04em',
        margin: '0 0 10px',
      }}>
        实时进度
      </h2>

      {/* 当前进度数字 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
        <span style={{ fontSize: '12px', color: 'var(--text-2)' }}>
          {progress.detail ? (
            <span style={{ color: 'var(--text-3)', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px', display: 'inline-block' }}>
              {progress.detail}
            </span>
          ) : '处理中…'}
        </span>
        {hasTotal && (
          <span style={{ fontSize: '11px', color: 'var(--text-4)', whiteSpace: 'nowrap' }}>
            {progress.current} / {progress.total} · {percent.toFixed(1)}%
          </span>
        )}
      </div>

      {/* 进度条 */}
      <div style={{ height: '4px', background: 'var(--border)', borderRadius: '99px', overflow: 'hidden', marginBottom: '8px' }}>
        {hasTotal ? (
          <div style={{
            height: '100%', borderRadius: '99px',
            background: isFailed ? 'var(--red)' : 'var(--indigo)',
            width: `${percent}%`,
            transition: 'width 0.5s ease',
          }} />
        ) : (
          // 无总数时：脉冲条
          <div style={{
            height: '100%', width: '33%', borderRadius: '99px',
            background: 'var(--indigo)',
            opacity: 0.6,
          }} className="animate-pulse" />
        )}
      </div>

      {/* 已完成阶段胶囊 */}
      {progress.stages_completed.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '6px' }}>
          {progress.stages_completed.map((s) => (
            <span
              key={s}
              title={s}
              style={{
                display: 'inline-block',
                width: '24px', height: '4px',
                borderRadius: '99px',
                background: 'var(--green)',
              }}
            />
          ))}
        </div>
      )}

      {/* 错误 */}
      {progress.error && (
        <div style={{
          fontSize: '11px', color: 'var(--red)',
          background: 'var(--red-soft)',
          border: '1px solid var(--red-line)',
          padding: '6px 10px',
          borderRadius: 'var(--radius-sm)',
          fontFamily: 'monospace',
        }}>
          {progress.error}
        </div>
      )}
    </div>
  );
}
