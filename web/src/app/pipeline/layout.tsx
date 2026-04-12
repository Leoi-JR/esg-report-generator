'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import PipelineHeader from '@/components/pipeline/PipelineHeader';

const tabs = [
  { href: '/pipeline', label: 'Dashboard' },
  { href: '/pipeline/chunks', label: '分块浏览' },
  { href: '/pipeline/sections', label: '段落浏览' },
  { href: '/pipeline/retrieval', label: '检索结果' },
];

function PipelineLayoutInner({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const project = searchParams.get('project');
  const qs = project ? `?project=${encodeURIComponent(project)}` : '';

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      <PipelineHeader />

      {/* Tab 导航 — 靛蓝激活态 */}
      <div style={{
        background: 'var(--bg-card)',
        borderBottom: '2px solid var(--border)',
      }}>
        <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '0 24px' }}>
          <nav style={{ display: 'flex', gap: '2px' }}>
            {tabs.map((tab) => {
              const isActive =
                tab.href === '/pipeline'
                  ? pathname === '/pipeline'
                  : pathname.startsWith(tab.href);

              return (
                <Link
                  key={tab.href}
                  href={`${tab.href}${qs}`}
                  style={{
                    padding: '8px 14px',
                    fontSize: '12px',
                    fontWeight: isActive ? 600 : 400,
                    fontFamily: 'var(--font-body)',
                    textDecoration: 'none',
                    borderBottom: isActive ? '2px solid var(--indigo)' : '2px solid transparent',
                    color: isActive ? 'var(--indigo)' : 'var(--text-3)',
                    transition: 'color 0.15s, border-color 0.15s',
                    marginBottom: '-2px',
                    display: 'inline-block',
                  }}
                  onMouseEnter={e => { if (!isActive) { (e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-1)'; (e.currentTarget as HTMLAnchorElement).style.borderBottomColor = 'var(--border)'; }}}
                  onMouseLeave={e => { if (!isActive) { (e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-3)'; (e.currentTarget as HTMLAnchorElement).style.borderBottomColor = 'transparent'; }}}
                >
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>

      {/* 页面内容 */}
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

export default function PipelineLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={null}>
      <PipelineLayoutInner>{children}</PipelineLayoutInner>
    </Suspense>
  );
}
