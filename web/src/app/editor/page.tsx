'use client';

import { useEffect } from 'react';
import { useEditorStore } from '@/lib/store';
import { Toolbar } from '@/components/editor/Toolbar';
import { Sidebar } from '@/components/editor/Sidebar';
import { ContentEditor } from '@/components/editor/ContentEditor';
import { SourcePanel } from '@/components/editor/SourcePanel';
import { VersionHistory } from '@/components/editor/VersionHistory';
import { AIPanel } from '@/components/editor/AIPanel';
import { Loader2 } from 'lucide-react';

export default function EditorPage() {
  const {
    setDraftResults,
    setChunksCache,
    setChapterEdits,
    isLoading,
    setIsLoading,
    draftResults,
    showAIPanel,
    currentChapter,
  } = useEditorStore();

  useEffect(() => {
    async function loadData() {
      setIsLoading(true);

      // Startup cleanup: purge any corrupted localStorage caches from previous sessions.
      // This is a one-time sweep that removes caches with empty [来源] tags.
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
      } catch { /* localStorage may be unavailable in some contexts */ }

      try {
        // Load all data in parallel
        const [draftResponse, chunksResponse, editsResponse] = await Promise.all([
          fetch('/api/data/draft'),
          fetch('/api/data/chunks'),
          fetch('/api/chapters/_all'),
        ]);

        // Load edits first so they're available when draft results are set
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
  }, [setDraftResults, setChunksCache, setChapterEdits, setIsLoading]);

  // Compute dynamic stats
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
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 size={48} className="animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">正在加载报告数据...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-100">
      {/* Top Toolbar */}
      <Toolbar />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Sidebar - Directory Navigation */}
        <div className="w-64 flex-shrink-0">
          <Sidebar />
        </div>

        {/* Center - Content Editor */}
        <ContentEditor />

        {/* Right Sidebar - Source Panel */}
        <div className="w-[350px] flex-shrink-0">
          <SourcePanel />
        </div>

        {/* AI Panel (floating) */}
        {showAIPanel && currentChapter && (
          <AIPanel />
        )}

        {/* Version History (floating drawer) */}
        <VersionHistory />
      </div>

      {/* Bottom Status Bar */}
      <footer className="h-8 bg-white border-t border-gray-200 flex items-center justify-between px-4 text-xs text-gray-500">
        <div className="flex items-center gap-4">
          <span>📊 进度：{stats.generated}/{stats.total} 已生成</span>
          <span>|</span>
          <span>{stats.skipped} 跳过</span>
          <span>|</span>
          <span>{stats.reviewed} 已审核</span>
          {stats.approved > 0 && (
            <>
              <span>|</span>
              <span>{stats.approved} 已批准</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span>📝 合计 {stats.totalWords.toLocaleString()} 字</span>
        </div>
      </footer>
    </div>
  );
}
