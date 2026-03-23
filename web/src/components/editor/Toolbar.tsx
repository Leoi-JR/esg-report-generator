'use client';

import React, { useState } from 'react';
import { useEditorStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { tiptapHTMLToContent } from '@/lib/tiptap/content-transform';
import {
  Save,
  Download,
  FileText,
  FileCode,
  ChevronDown,
  Undo2,
  Redo2,
  Check,
  Loader2,
  History,
  Sparkles,
} from 'lucide-react';

export const Toolbar: React.FC = () => {
  const {
    draftResults,
    currentChapter,
    tiptapEditor,
    saveStatus,
    setSaveStatus,
    selectedChapterId,
    setShowVersionHistory,
    showVersionHistory,
    setShowAIPanel,
    showAIPanel,
  } = useEditorStore();

  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const handleSave = async () => {
    if (!tiptapEditor || !selectedChapterId) return;
    setIsSaving(true);
    setSaveStatus('saving');

    try {
      const html = tiptapEditor.getHTML();
      const content = tiptapHTMLToContent(html);

      const resp = await fetch(`/api/chapters/${selectedChapterId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          word_count: content.length,
        }),
      });

      if (resp.ok) {
        localStorage.removeItem(`draft-edit-${selectedChapterId}`);
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      }
    } catch (error) {
      console.error('Save failed:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleExportWord = async () => {
    if (!draftResults) return;
    setIsExporting(true);
    setIsExportOpen(false);

    try {
      const response = await fetch('/api/export/word', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ results: draftResults.results }),
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = '艾森股份2025ESG报告.docx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('Export failed:', error);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportMarkdown = async () => {
    if (!draftResults) return;
    setIsExporting(true);
    setIsExportOpen(false);

    try {
      const response = await fetch('/api/export/markdown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ results: draftResults.results }),
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = '艾森股份2025ESG报告.md';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('Export failed:', error);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4">
      {/* Left: Project Name */}
      <div className="flex items-center gap-3">
        <FileText className="text-blue-600" size={24} />
        <div>
          <h1 className="text-lg font-semibold text-gray-900">
            艾森股份 2025 ESG 报告
          </h1>
        </div>
        <div className={cn(
          'flex items-center gap-1 px-2 py-1 text-xs rounded-full transition-colors',
          saveStatus === 'saving' && 'bg-blue-50 text-blue-600',
          saveStatus === 'saved' && 'bg-green-50 text-green-600',
          saveStatus === 'idle' && 'bg-gray-50 text-gray-500'
        )}>
          {saveStatus === 'saving' && (
            <>
              <Loader2 size={12} className="animate-spin" />
              <span>保存中...</span>
            </>
          )}
          {saveStatus === 'saved' && (
            <>
              <Check size={12} />
              <span>已保存</span>
            </>
          )}
          {saveStatus === 'idle' && (
            <span>自动保存</span>
          )}
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        {/* Undo/Redo */}
        <div className="flex items-center border-r border-gray-200 pr-2 mr-2">
          <button
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
            title="撤销 (Ctrl+Z)"
            disabled={!tiptapEditor?.can().undo()}
            onClick={() => tiptapEditor?.chain().focus().undo().run()}
          >
            <Undo2 size={18} />
          </button>
          <button
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
            title="重做 (Ctrl+Y)"
            disabled={!tiptapEditor?.can().redo()}
            onClick={() => tiptapEditor?.chain().focus().redo().run()}
          >
            <Redo2 size={18} />
          </button>
        </div>

        {/* AI Panel Toggle */}
        {currentChapter && (
          <button
            onClick={() => setShowAIPanel(!showAIPanel)}
            className={cn(
              'flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg transition-colors',
              showAIPanel
                ? 'bg-purple-100 text-purple-700'
                : 'text-purple-600 hover:bg-purple-50'
            )}
            title="AI 助手"
          >
            <Sparkles size={16} />
            AI 助手
          </button>
        )}

        {/* Version History */}
        <button
          onClick={() => setShowVersionHistory(!showVersionHistory)}
          className={cn(
            'p-2 rounded-lg transition-colors',
            showVersionHistory
              ? 'bg-blue-100 text-blue-700'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
          )}
          title="版本历史"
        >
          <History size={18} />
        </button>

        {/* Save */}
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
        >
          {isSaving ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Save size={16} />
          )}
          保存
        </button>

        {/* Export Dropdown */}
        <div className="relative">
          <button
            onClick={() => setIsExportOpen(!isExportOpen)}
            disabled={isExporting}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
          >
            {isExporting ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Download size={16} />
            )}
            导出
            <ChevronDown size={14} />
          </button>

          {isExportOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setIsExportOpen(false)}
              />
              <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 z-20 py-1">
                <button
                  onClick={handleExportWord}
                  className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <FileText size={16} className="text-blue-600" />
                  导出 Word (.docx)
                </button>
                <button
                  onClick={handleExportMarkdown}
                  className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <FileCode size={16} className="text-gray-600" />
                  导出 Markdown
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
};
