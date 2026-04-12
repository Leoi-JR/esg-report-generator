'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { usePipelineStore } from '@/lib/pipeline-store';

import PipelineControls from '@/components/pipeline/PipelineControls';
import StepTimeline from '@/components/pipeline/StepTimeline';
import LiveProgress from '@/components/pipeline/LiveProgress';
import ChapterGrid from '@/components/pipeline/ChapterGrid';
import RunHistory from '@/components/pipeline/RunHistory';
import RetrievalDiffBanner from '@/components/pipeline/RetrievalDiffBanner';

function PipelinePageInner() {
  const searchParams = useSearchParams();
  const project = searchParams.get('project') || undefined;
  const { activeRun, liveProgress, error, clearError, fetchRuns, retrievalDiff, fetchRetrievalDiff, initForProject } =
    usePipelineStore();

  useEffect(() => {
    // 按当前项目过滤历史，并自动加载最新 run
    initForProject(project);
    fetchRetrievalDiff(project);
  }, [initForProject, fetchRetrievalDiff, project]);

  return (
    <main style={{ maxWidth: '1280px', margin: '0 auto', padding: '20px 24px' }}>
      {/* 错误提示 */}
      {error && (
        <div style={{
          marginBottom: '14px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'var(--red-soft)',
          border: '1px solid var(--red-line)',
          color: 'var(--red)',
          padding: '10px 14px',
          borderRadius: 'var(--radius)',
          fontSize: '12px',
          fontFamily: 'var(--font-body)',
        }}>
          <span>{error}</span>
          <button
            onClick={clearError}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--red)', fontWeight: 500,
              fontSize: '12px', marginLeft: '14px',
              fontFamily: 'var(--font-body)',
            }}
          >
            关闭
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '14px' }}>
        {/* 左栏：控制 + 历史 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <PipelineControls project={project} />
          <RunHistory project={project} />
        </div>

        {/* 右栏：实时状态 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {activeRun ? (
            <>
              {/* 运行总览卡片 */}
              <div style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                boxShadow: 'var(--shadow-sm)',
                padding: '14px 16px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <h2 style={{
                      fontFamily: 'var(--font-head)',
                      fontSize: '12px', fontWeight: 700,
                      color: 'var(--text-2)',
                      letterSpacing: '0.04em',
                      margin: '0 0 3px',
                    }}>
                      当前运行
                    </h2>
                    <p style={{ fontSize: '11px', color: 'var(--text-4)', fontFamily: 'monospace', margin: 0 }}>
                      {activeRun.run.id}
                    </p>
                  </div>
                  <StatusBadge status={activeRun.run.status} />
                  {activeRun.run.status === 'completed' && (
                    <Link
                      href={`/editor${project ? `?project=${encodeURIComponent(project)}` : ''}`}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                        padding: '4px 12px',
                        fontSize: '12px', fontWeight: 500,
                        borderRadius: 'var(--radius)',
                        background: 'var(--green)', color: '#fff',
                        textDecoration: 'none',
                        fontFamily: 'var(--font-body)',
                        marginLeft: '8px',
                      }}
                    >
                      进入编辑 <ArrowRight size={13} />
                    </Link>
                  )}
                </div>
                {activeRun.run.error && (
                  <div style={{
                    marginTop: '10px', fontSize: '11px', color: 'var(--red)',
                    background: 'var(--red-soft)', padding: '6px 10px',
                    borderRadius: 'var(--radius-sm)', fontFamily: 'monospace',
                  }}>
                    {activeRun.run.error}
                  </div>
                )}
              </div>

              <StepTimeline stepRuns={activeRun.steps} progress={liveProgress} project={project} />
              {retrievalDiff && (
                <RetrievalDiffBanner diff={retrievalDiff} project={project} />
              )}
              <LiveProgress progress={liveProgress} />
              <ChapterGrid progress={liveProgress} />
            </>
          ) : (
            <div style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              boxShadow: 'var(--shadow-sm)',
              padding: '48px 24px',
              textAlign: 'center',
            }}>
              <div style={{ color: 'var(--border)', fontSize: '36px', marginBottom: '8px', lineHeight: 1 }}>~</div>
              <p style={{ color: 'var(--text-3)', fontSize: '12px', fontFamily: 'var(--font-body)' }}>
                选择步骤并点击运行，或从历史记录中查看之前的运行
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

export default function PipelinePage() {
  return (
    <Suspense fallback={
      <main style={{ maxWidth: '1280px', margin: '0 auto', padding: '20px 24px', textAlign: 'center', color: 'var(--text-4)', fontSize: '12px', fontFamily: 'var(--font-body)' }}>
        加载中…
      </main>
    }>
      <PipelinePageInner />
    </Suspense>
  );
}

function StatusBadge({ status }: { status: string }) {
  type StyleEntry = { bg: string; color: string; border: string };
  const styles: Record<string, StyleEntry> = {
    pending:   { bg: 'var(--bg-warm)',     color: 'var(--text-3)',  border: 'var(--border)' },
    running:   { bg: 'var(--indigo-soft)', color: 'var(--indigo)',  border: 'var(--indigo-line)' },
    completed: { bg: 'var(--green-soft)',  color: 'var(--green)',   border: 'var(--green-mid)' },
    failed:    { bg: 'var(--red-soft)',    color: 'var(--red)',     border: 'var(--red-line)' },
    cancelled: { bg: 'var(--amber-soft)',  color: 'var(--amber)',   border: 'var(--amber-border)' },
  };
  const labels: Record<string, string> = {
    pending: '等待中', running: '运行中',
    completed: '已完成', failed: '失败', cancelled: '已取消',
  };
  const s = styles[status] ?? styles.pending;

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 8px',
      fontSize: '11px', fontWeight: 500,
      borderRadius: 'var(--radius-sm)',
      border: `1px solid ${s.border}`,
      background: s.bg, color: s.color,
      fontFamily: 'var(--font-body)',
    }}>
      {labels[status] ?? status}
    </span>
  );
}
