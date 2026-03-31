'use client';

import React, { useEffect, useMemo, useCallback, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import { useEditorStore } from '@/lib/store';
import { cn, getStatusDisplay, extractPendingBlocks } from '@/lib/utils';
import { SourceTag } from '@/lib/tiptap/source-tag';
import { PendingBlock } from '@/lib/tiptap/pending-block';
import { contentToTiptapHTML, tiptapHTMLToContent } from '@/lib/tiptap/content-transform';
import { EditorToolbar } from './EditorToolbar';
import { FileText, AlertTriangle, Edit3 } from 'lucide-react';

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
    setSelectedText,
  } = useEditorStore();

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedContentRef = useRef<string>('');
  const isSettingContentRef = useRef(false);
  // Track whether user has made actual edits (not just loading content)
  const hasUserEditedRef = useRef(false);
  const [localSaveStatus, setLocalSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

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

    setLocalSaveStatus('saving');
    setSaveStatus('saving');
    try {
      const resp = await fetch(`/api/chapters/${selectedChapterId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          word_count: content.length,
        }),
      });

      if (resp.ok) {
        lastSavedContentRef.current = content;
        // Clear localStorage backup on successful save
        localStorage.removeItem(`draft-edit-${selectedChapterId}`);
        setLocalSaveStatus('saved');
        setSaveStatus('saved');
        setTimeout(() => {
          setLocalSaveStatus('idle');
          setSaveStatus('idle');
        }, 2000);
      }
    } catch (error) {
      console.error('Auto-save failed:', error);
      setLocalSaveStatus('idle');
      setSaveStatus('idle');
    }
  }, [selectedChapterId, setSaveStatus]);

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
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center text-gray-400">
          <FileText size={48} className="mx-auto mb-4 opacity-50" />
          <p>请从左侧选择一个章节开始编辑</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-white overflow-hidden">
      {/* Chapter Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
        <div className="flex-1">
          <div className="text-sm text-gray-500 mb-1">
            {currentChapter.full_path.split(' > ').slice(0, -1).join(' > ')}
          </div>
          <h1 className="text-xl font-semibold text-gray-900">
            {currentChapter.leaf_title}
          </h1>
        </div>
        {statusDisplay && (
          <div className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium',
            currentChapter.status === 'generated' && 'bg-green-50 text-green-700',
            currentChapter.status === 'skipped' && 'bg-gray-100 text-gray-500',
            currentChapter.status === 'reviewed' && 'bg-blue-50 text-blue-700',
            currentChapter.status === 'approved' && 'bg-purple-50 text-purple-700',
          )}>
            <span>{statusDisplay.icon}</span>
            <span>{statusDisplay.label}</span>
          </div>
        )}
      </div>

      {/* Skipped Notice */}
      {currentChapter.status === 'skipped' && (
        <div className="px-6 py-3 bg-amber-50 border-b border-amber-100">
          <div className="flex items-center gap-2 text-amber-800">
            <AlertTriangle size={18} />
            <span className="text-sm">
              此章节因资料不足而跳过：{currentChapter.skip_reason}
            </span>
          </div>
        </div>
      )}

      {/* Editor Toolbar */}
      {currentChapter.status !== 'skipped' && currentChapter.draft && (
        <EditorToolbar editor={editor} />
      )}

      {/* Editor Content */}
      <div className="flex-1 overflow-y-auto">
        {currentChapter.draft ? (
          <EditorContent editor={editor} />
        ) : (
          <div className="px-6 py-8 text-center text-gray-400">
            <Edit3 size={32} className="mx-auto mb-3 opacity-50" />
            <p>此章节暂无内容</p>
            <p className="text-sm mt-1">需要补充更多资料后重新生成</p>
          </div>
        )}
      </div>

      {/* Footer Stats */}
      <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 flex items-center justify-between text-sm text-gray-500">
        <div className="flex items-center gap-4">
          <span>
            📝 {charCount} 字
          </span>
          <span>
            📎 引用 {currentChapter.draft?.cited_sources?.length || 0} 个来源
          </span>
          {pendingBlocks.length > 0 && (
            <span className="text-amber-600">
              ⚠️ {pendingBlocks.length} 处待补充
            </span>
          )}
        </div>
        <div className="text-xs text-gray-400">
          {localSaveStatus === 'saving' && '保存中...'}
          {localSaveStatus === 'saved' && '✓ 已保存'}
          {localSaveStatus === 'idle' && `上次更新：${new Date().toLocaleString('zh-CN')}`}
        </div>
      </div>
    </div>
  );
};
