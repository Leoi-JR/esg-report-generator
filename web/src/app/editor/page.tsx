'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useEditorStore } from '@/lib/store';
import { Toolbar } from '@/components/editor/Toolbar';
import { Sidebar } from '@/components/editor/Sidebar';
import { ContentEditor } from '@/components/editor/ContentEditor';
import { SourcePanel } from '@/components/editor/SourcePanel';
import { VersionHistory } from '@/components/editor/VersionHistory';
import { AIPanel } from '@/components/editor/AIPanel';
import { Loader2 } from 'lucide-react';

function EditorPageInner() {
  const searchParams = useSearchParams();
  const project = searchParams.get('project') || undefined;
  const {
    setDraftResults,
    setChunksCache,
    setChapterEdits,
    isLoading,
    setIsLoading,
    setActiveProject,
    draftResults,
    showAIPanel,
    currentChapter,
  } = useEditorStore();

  useEffect(() => {
    setActiveProject(project);
  }, [project, setActiveProject]);

  useEffect(() => {
    async function loadData() {
      setIsLoading(true);

      // Startup cleanup: purge any corrupted localStorage caches
      try {
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith('draft-edit-')) {
            try {
              const val = JSON.parse(localStorage.getItem(key) || '');
              if (val.content && /\[来源\]/.test(val.content)) {
                keysToRemove.push(key);
              }
            } catch { /* ignore parse errors */ }
          }
        }
        for (const key of keysToRemove) {
          localStorage.removeItem(key);
          console.warn(`Purged corrupted localStorage cache: ${key}`);
        }
      } catch { /* localStorage may be unavailable */ }

      try {
        const qs = project ? `?project=${encodeURIComponent(project)}` : '';
        const [draftResponse, chunksResponse, editsResponse] = await Promise.all([
          fetch(`/api/data/draft${qs}`),
          fetch(`/api/data/chunks${qs}`),
          fetch(`/api/chapters/_all${qs}`),
        ]);

        if (editsResponse.ok) {
          const editsData = await editsResponse.json();
          if (Array.isArray(editsData)) {
            setChapterEdits(editsData);
          }
        }

        if (draftResponse.ok) {
          const draftData = await draftResponse.json();
          setDraftResults(draftData);
        }

        if (chunksResponse.ok) {
          const chunksData = await chunksResponse.json();
          setChunksCache(chunksData);
        }
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, [setDraftResults, setChunksCache, setChapterEdits, setIsLoading, project]);

  const stats = draftResults ? {
    total: draftResults.summary.total,
    generated: draftResults.results.filter(r => r.status === 'generated').length,
    skipped: draftResults.results.filter(r => r.status === 'skipped').length,
    reviewed: draftResults.results.filter(r => r.status === 'reviewed').length,
    approved: draftResults.results.filter(r => r.status === 'approved').length,
    totalWords: draftResults.results.reduce((sum, r) => sum + (r.draft?.word_count || 0), 0),
  } : { total: 0, generated: 0, skipped: 0, reviewed: 0, approved: 0, totalWords: 0 };

  if (isLoading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <div style={{ textAlign: 'center' }}>
          <Loader2 size={36} className="animate-spin" style={{ color: 'var(--green)', margin: '0 auto 12px', display: 'block' }} />
          <p style={{ color: 'var(--text-3)', fontSize: '13px', fontFamily: 'var(--font-body)' }}>正在加载报告数据...</p>
        </div>
      </div>
    );
  }

  const isAIPanelVisible = showAIPanel && currentChapter;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      {/* 顶部工具栏 */}
      <Toolbar />

      {/* 主内容区：三栏布局 */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* 左侧：章节目录 */}
        <div style={{ width: '256px', flexShrink: 0 }}>
          <Sidebar />
        </div>

        {/* 中间：内容编辑器 */}
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          <ContentEditor />
        </div>

        {/* AI 面板（条件渲染） */}
        {isAIPanelVisible && (
          <div style={{
            width: '400px',
            flexShrink: 0,
            borderLeft: '1px solid var(--border)',
            borderRight: '2px solid var(--border)',
            position: 'relative',
          }}>
            {/* 顶部靛蓝色条，标识 AI 面板身份 */}
            <div style={{
              position: 'absolute',
              top: 0, left: 0, right: 0,
              height: '2px',
              background: 'var(--indigo)',
              zIndex: 1,
            }} />
            <AIPanel />
          </div>
        )}

        {/* 右侧：来源面板 */}
        <div style={{
          width: '340px',
          flexShrink: 0,
          borderLeft: isAIPanelVisible ? 'none' : '1px solid var(--border)',
        }}>
          <SourcePanel />
        </div>

        {/* 版本历史（浮动抽屉） */}
        <VersionHistory />
      </div>

      {/* 底部状态栏 — 暖色背景，无 emoji */}
      <footer style={{
        height: '27px',
        background: 'var(--bg-warm)',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 14px',
        fontSize: '11px',
        color: 'var(--text-4)',
        fontFamily: 'var(--font-body)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ display: 'inline-block', width: '3px', height: '10px', borderRadius: '99px', background: 'var(--green)' }} />
            {stats.generated}/{stats.total} 已生成
          </span>
          {stats.skipped > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ display: 'inline-block', width: '3px', height: '10px', borderRadius: '99px', background: 'var(--text-4)', opacity: 0.5 }} />
              {stats.skipped} 跳过
            </span>
          )}
          {stats.reviewed > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ display: 'inline-block', width: '3px', height: '10px', borderRadius: '99px', background: 'var(--blue)' }} />
              {stats.reviewed} 已审核
            </span>
          )}
          {stats.approved > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ display: 'inline-block', width: '3px', height: '10px', borderRadius: '99px', background: 'var(--indigo)' }} />
              {stats.approved} 已批准
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span>合计 {stats.totalWords.toLocaleString()} 字</span>
        </div>
      </footer>
    </div>
  );
}

export default function EditorPage() {
  return (
    <Suspense fallback={
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <div style={{ textAlign: 'center' }}>
          <Loader2 size={36} className="animate-spin" style={{ color: 'var(--green)', margin: '0 auto 12px', display: 'block' }} />
          <p style={{ color: 'var(--text-3)', fontSize: '13px', fontFamily: 'var(--font-body)' }}>正在加载报告数据...</p>
        </div>
      </div>
    }>
      <EditorPageInner />
    </Suspense>
  );
}
