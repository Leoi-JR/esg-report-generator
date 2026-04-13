'use client';

import React, { useEffect, useMemo, useCallback, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import { useEditorStore } from '@/lib/store';
import { getStatusDisplay, extractPendingBlocks } from '@/lib/utils';
import { SourceTag } from '@/lib/tiptap/source-tag';
import { PendingBlock } from '@/lib/tiptap/pending-block';
import { contentToTiptapHTML, tiptapHTMLToContent } from '@/lib/tiptap/content-transform';
import { EditorToolbar } from './EditorToolbar';
import { FileText, AlertTriangle, Edit3, Info } from 'lucide-react';

/**
 * Validate content integrity: check that source tags are not corrupted.
 * Returns true if content is valid, false if it contains empty [来源] tags.
 */
function isContentValid(content: string): boolean {
  // If the content contains [来源] (without any source IDs), it's corrupted
  return !/\[来源\]/.test(content);
}

export const ContentEditor: React.FC = () => {
  const {
    currentChapter,
    highlightSource,
    updateChapterContent,
    selectedChapterId,
    setTiptapEditor,
    setSaveStatus,
    saveStatus,
    setSelectedText,
    activeProject,
  } = useEditorStore();

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedContentRef = useRef<string>('');
  const isSettingContentRef = useRef(false);
  // Track whether user has made actual edits (not just loading content)
  const hasUserEditedRef = useRef(false);

  // Get the current content — this is the authoritative source from store
  // (which merges SQLite edits over draft_results.json)
  const currentContent = useMemo(() => {
    if (!currentChapter?.draft?.content) return '';
    return currentChapter.draft.content;
  }, [currentChapter]);

  const tiptapHTML = useMemo(() => {
    return contentToTiptapHTML(currentContent);
  }, [currentContent]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        history: { depth: 100 },
      }),
      Underline,
      Placeholder.configure({
        placeholder: '开始编辑内容...',
      }),
      CharacterCount,
      SourceTag,
      PendingBlock,
    ],
    content: tiptapHTML,
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none px-6 py-4 min-h-[400px] focus:outline-none',
      },
      handleClick: (_view, _pos, event) => {
        const target = event.target as HTMLElement;
        if (target.classList.contains('source-tag') || target.closest('.source-tag')) {
          const el = target.classList.contains('source-tag') ? target : target.closest('.source-tag') as HTMLElement;
          const sourceId = el?.getAttribute('data-sources');
          if (sourceId) {
            highlightSource(sourceId);
            const sourceElement = document.getElementById(`source-${sourceId}`);
            sourceElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      // Skip updates triggered by programmatic setContent
      if (isSettingContentRef.current) return;

      // Mark that user has made an actual edit
      hasUserEditedRef.current = true;

      const html = ed.getHTML();
      const rawContent = tiptapHTMLToContent(html);

      // Integrity check: refuse to propagate corrupted content
      if (!isContentValid(rawContent)) {
        console.warn('Content integrity check failed: detected empty [来源] tags. Skipping save.');
        return;
      }

      // Update store (in-memory)
      if (selectedChapterId) {
        updateChapterContent(selectedChapterId, rawContent);
      }

      // localStorage backup — only for crash recovery of genuine user edits
      if (selectedChapterId) {
        localStorage.setItem(
          `draft-edit-${selectedChapterId}`,
          JSON.stringify({ content: rawContent, timestamp: Date.now() })
        );
      }

      // Debounced auto-save (30s)
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        performSave(rawContent);
      }, 30000);
    },
    onSelectionUpdate: ({ editor: ed }) => {
      const { from, to } = ed.state.selection;
      if (from !== to) {
        const text = ed.state.doc.textBetween(from, to, ' ');
        setSelectedText(text);
      } else {
        setSelectedText('');
      }
    },
  });

  // Register editor in store for Toolbar access
  useEffect(() => {
    setTiptapEditor(editor);
    return () => setTiptapEditor(null);
  }, [editor, setTiptapEditor]);

  // Sync content when chapter changes
  useEffect(() => {
    if (!editor || !selectedChapterId) return;

    isSettingContentRef.current = true;
    hasUserEditedRef.current = false;

    // Data authority order:
    // 1. Store (currentContent) — already merged SQLite edits over draft_results.json
    // 2. localStorage — ONLY used if it passes integrity check AND is newer than the store
    //
    // The store's data (from SQLite + draft_results.json) is always the authority.
    // localStorage is a crash-recovery fallback, not a data source.

    let contentToLoad = currentContent;
    let htmlToLoad = tiptapHTML;

    const cached = localStorage.getItem(`draft-edit-${selectedChapterId}`);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        const cachedContent = parsed.content as string;
        const cachedTimestamp = parsed.timestamp as number;

        // Only use localStorage if ALL conditions are met:
        // 1. The cached content passes integrity validation
        // 2. The cached content is different from the current store content
        //    (meaning it contains unsaved edits)
        // 3. The cache is less than 1 hour old (stale caches are not trustworthy)
        const isFresh = Date.now() - cachedTimestamp < 3600_000; // 1 hour
        const isDifferent = cachedContent !== currentContent;
        const isValid = isContentValid(cachedContent);

        if (isValid && isDifferent && isFresh) {
          contentToLoad = cachedContent;
          htmlToLoad = contentToTiptapHTML(cachedContent);
          console.info(`Restored unsaved edits for ${selectedChapterId} from localStorage`);
        } else {
          // Cache is stale, invalid, or same as current — remove it
          localStorage.removeItem(`draft-edit-${selectedChapterId}`);
          if (!isValid) {
            console.warn(`Discarded corrupted localStorage cache for ${selectedChapterId}`);
          }
        }
      } catch {
        // Corrupted JSON — remove it
        localStorage.removeItem(`draft-edit-${selectedChapterId}`);
      }
    }

    editor.commands.setContent(htmlToLoad);
    lastSavedContentRef.current = contentToLoad;

    isSettingContentRef.current = false;
  }, [selectedChapterId]); // eslint-disable-line react-hooks/exhaustive-deps

  const performSave = useCallback(async (content: string) => {
    if (!selectedChapterId || content === lastSavedContentRef.current) return;

    // Final integrity check before saving to server
    if (!isContentValid(content)) {
      console.warn('Blocked save: content integrity check failed');
      return;
    }

    setSaveStatus('saving');
    try {
      const resp = await fetch(`/api/chapters/${selectedChapterId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          word_count: content.length,
          project_id: activeProject || 'default',
        }),
      });

      if (resp.ok) {
        lastSavedContentRef.current = content;
        // Clear localStorage backup on successful save
        localStorage.removeItem(`draft-edit-${selectedChapterId}`);
        setSaveStatus('saved');
        setTimeout(() => {
          setSaveStatus('idle');
        }, 2000);
      }
    } catch (error) {
      console.error('Auto-save failed:', error);
      setSaveStatus('idle');
    }
  }, [selectedChapterId, setSaveStatus, activeProject]);

  // Save on blur — only if user has actually edited
  useEffect(() => {
    if (!editor) return;
    const handleBlur = () => {
      if (!hasUserEditedRef.current) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      const html = editor.getHTML();
      const rawContent = tiptapHTMLToContent(html);
      performSave(rawContent);
    };

    const editorElement = editor.view.dom;
    editorElement.addEventListener('blur', handleBlur);
    return () => editorElement.removeEventListener('blur', handleBlur);
  }, [editor, performSave]);

  // Cleanup save timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const pendingBlocks = useMemo(() => {
    if (!currentContent) return [];
    return extractPendingBlocks(currentContent);
  }, [currentContent]);

  const statusDisplay = currentChapter?.status
    ? getStatusDisplay(currentChapter.status)
    : null;

  const charCount = editor?.storage.characterCount?.characters() || currentChapter?.draft?.word_count || 0;

  if (!currentChapter) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <div style={{ textAlign: 'center', color: 'var(--text-4)' }}>
          <FileText size={48} style={{ margin: '0 auto 16px', opacity: 0.4 }} />
          <p style={{ fontSize: '13px', fontFamily: 'var(--font-body)' }}>请从左侧选择一个章节开始编辑</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-card)', overflow: 'hidden' }}>
      {/* Chapter Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 24px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '11px', color: 'var(--text-3)', marginBottom: '4px', fontFamily: 'var(--font-body)' }}>
            {currentChapter.full_path.split(' > ').slice(0, -1).join(' > ')}
          </div>
          <h1 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-1)', margin: 0, fontFamily: 'var(--font-head)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {currentChapter.leaf_title}
          </h1>
        </div>
        {statusDisplay && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '4px 10px',
            borderRadius: 'var(--radius)',
            fontSize: '12px', fontWeight: 500,
            fontFamily: 'var(--font-body)',
            background: currentChapter.status === 'generated' ? 'var(--green-soft)' :
                        currentChapter.status === 'skipped'   ? 'var(--bg-warm)' :
                        currentChapter.status === 'reviewed'  ? 'var(--blue-soft)' :
                        currentChapter.status === 'approved'  ? 'var(--indigo-soft)' : 'var(--bg-warm)',
            color: currentChapter.status === 'generated' ? 'var(--green)' :
                   currentChapter.status === 'skipped'   ? 'var(--text-3)' :
                   currentChapter.status === 'reviewed'  ? 'var(--blue)' :
                   currentChapter.status === 'approved'  ? 'var(--indigo)' : 'var(--text-3)',
            border: `1px solid ${
              currentChapter.status === 'generated' ? 'var(--green-mid)' :
              currentChapter.status === 'reviewed'  ? 'var(--blue-mid)' :
              'var(--border-light)'
            }`,
          }}>
            <span>{statusDisplay.label}</span>
          </div>
        )}
      </div>

      {/* Skipped Notice */}
      {currentChapter.status === 'skipped' && (
        <div style={{ padding: '8px 24px', background: 'var(--amber-soft)', borderBottom: '1px solid var(--amber-border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--amber)', fontSize: '12px', fontFamily: 'var(--font-body)' }}>
            <AlertTriangle size={14} />
            <span>{
              currentChapter.skip_reason?.startsWith('low_relevance')
                ? `此章节因资料相关度不足而跳过（${currentChapter.skip_reason.split(': ').slice(1).join(': ')}）`
                : currentChapter.skip_reason?.startsWith('insufficient_evidence')
                ? '此章节因 LLM 判断资料不足以支撑撰写而跳过'
                : `此章节已跳过：${currentChapter.skip_reason}`
            }</span>
          </div>
          {/* LLM 资料不足分析 — 展示来源摘要和补充建议 */}
          {currentChapter.draft?.no_content_analysis && (
            <div style={{
              marginTop: '8px',
              padding: '8px 12px',
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius)',
              fontSize: '12px',
              lineHeight: '1.6',
              color: 'var(--text-2)',
              fontFamily: 'var(--font-body)',
              whiteSpace: 'pre-wrap',
            }}>
              {currentChapter.draft.no_content_analysis}
            </div>
          )}
        </div>
      )}

      {/* Editor Toolbar */}
      {currentChapter.draft && (
        <EditorToolbar editor={editor} />
      )}

      {/* Editor Content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {currentChapter.draft ? (
          <>
            <EditorContent editor={editor} />
            {currentChapter.draft?.citation_warning && (
              <div style={{
                padding: '6px 24px',
                fontSize: '11px',
                color: 'var(--text-4)',
                fontFamily: 'var(--font-body)',
                borderTop: '1px solid var(--border-light)',
                display: 'flex', alignItems: 'center', gap: '4px',
              }}>
                <Info size={12} />
                <span>{currentChapter.draft.citation_warning}</span>
              </div>
            )}
          </>
        ) : (
          <div style={{ padding: '32px 24px', textAlign: 'center', color: 'var(--text-4)' }}>
            <Edit3 size={32} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
            <p style={{ fontSize: '13px', fontFamily: 'var(--font-body)', margin: '0 0 4px' }}>此章节暂无内容</p>
            <p style={{ fontSize: '12px', fontFamily: 'var(--font-body)', margin: 0 }}>需要补充更多资料后重新生成</p>
          </div>
        )}
      </div>

      {/* Footer Stats */}
      <div style={{ padding: '8px 24px', borderTop: '1px solid var(--border)', background: 'var(--bg-warm)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '11px', color: 'var(--text-4)', fontFamily: 'var(--font-body)' }}>
          <span>{charCount} 字</span>
          <span>引用 {currentChapter.draft?.cited_sources?.length || 0} 个来源</span>
          {pendingBlocks.length > 0 && (
            <span style={{ color: 'var(--amber)' }}>
              {pendingBlocks.length} 处待补充
            </span>
          )}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-4)', fontFamily: 'var(--font-body)' }}>
          {saveStatus === 'saving' && <span style={{ color: 'var(--blue)' }}>保存中...</span>}
          {saveStatus === 'saved'  && <span style={{ color: 'var(--green)' }}>✓ 已保存</span>}
          {saveStatus === 'idle'   && <span>自动保存</span>}
        </div>
      </div>
    </div>
  );
};
