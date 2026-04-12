'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Activity, Home } from 'lucide-react';

function PipelineHeaderInner() {
  const searchParams = useSearchParams();
  const project = searchParams.get('project');
  const qs = project ? `?project=${encodeURIComponent(project)}` : '';

  // 从 project 推导显示名称
  const projectLabel = (() => {
    if (!project) return null;
    const idx = project.lastIndexOf('_');
    if (idx > 0) {
      const company = project.substring(0, idx);
      const year = project.substring(idx + 1);
      return `${company} ${year}`;
    }
    return project;
  })();

  return (
    <header style={{
      height: '52px',
      background: 'var(--bg-card)',
      borderBottom: '2px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 24px',
      flexShrink: 0,
    }}>
      {/* 左侧：Logo（靛蓝）+ 面包屑 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {/* Logo 方块（靛蓝） */}
        <div style={{
          width: '22px', height: '22px',
          border: '2px solid var(--indigo)',
          borderRadius: '3px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <Activity size={12} style={{ color: 'var(--indigo)' }} />
        </div>

        {/* 面包屑：首页 / 当前 Pipeline */}
        <nav style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
          <Link
            href="/"
            style={{
              fontSize: '12px', color: 'var(--text-3)',
              padding: '3px 7px', borderRadius: 'var(--radius-sm)',
              textDecoration: 'none',
              display: 'flex', alignItems: 'center', gap: '3px',
              transition: 'background 0.15s, color 0.15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = 'var(--bg-warm)'; (e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-1)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = 'transparent'; (e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-3)'; }}
          >
            <Home size={11} />
            首页
          </Link>

          <span style={{ color: 'var(--border)', fontSize: '16px', fontWeight: 300, lineHeight: 1, userSelect: 'none' }}>/</span>

          <span style={{
            fontSize: '12px', color: 'var(--text-1)', fontWeight: 500,
            padding: '3px 7px',
            pointerEvents: 'none',
          }}>
            {projectLabel ? `${projectLabel} — Pipeline` : 'Pipeline Dashboard'}
          </span>
        </nav>
      </div>
    </header>
  );
}

export default function PipelineHeader() {
  return (
    <Suspense fallback={
      <header style={{
        height: '52px',
        background: 'var(--bg-card)',
        borderBottom: '2px solid var(--border)',
        flexShrink: 0,
      }} />
    }>
      <PipelineHeaderInner />
    </Suspense>
  );
}
