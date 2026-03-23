'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useEditorStore } from '@/lib/store';
import { VersionRecord } from '@/lib/types';
import { contentToTiptapHTML } from '@/lib/tiptap/content-transform';
import { X, RotateCcw, Eye, Clock, Loader2 } from 'lucide-react';

export const VersionHistory: React.FC = () => {
  const {
    selectedChapterId,
    showVersionHistory,
    setShowVersionHistory,
    tiptapEditor,
    updateChapterContent,
  } = useEditorStore();

  const [versions, setVersions] = useState<VersionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [reverting, setReverting] = useState(false);

  const loadVersions = useCallback(async () => {
    if (!selectedChapterId) return;
    setLoading(true);
    try {
      const resp = await fetch(`/api/chapters/${selectedChapterId}/versions`);
      if (resp.ok) {
        const data = await resp.json();
        setVersions(data.versions || []);
      }
    } catch (error) {
      console.error('Failed to load versions:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedChapterId]);

  useEffect(() => {
    if (showVersionHistory && selectedChapterId) {
      loadVersions();
    }
  }, [showVersionHistory, selectedChapterId, loadVersions]);

  const handlePreview = (version: VersionRecord) => {
    if (previewId === version.version_id) {
      setPreviewId(null);
      return;
    }
    setPreviewId(version.version_id);
  };

  const handleRevert = async (version: VersionRecord) => {
    if (!selectedChapterId || !tiptapEditor) return;
    if (!confirm(`确定要回滚到此版本吗？（${new Date(version.created_at).toLocaleString('zh-CN')}）`)) return;

    setReverting(true);
    try {
      const resp = await fetch(`/api/chapters/${selectedChapterId}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version_id: version.version_id }),
      });

      if (resp.ok) {
        // Update editor content
        const html = contentToTiptapHTML(version.content);
        tiptapEditor.commands.setContent(html);
        updateChapterContent(selectedChapterId, version.content);
        localStorage.removeItem(`draft-edit-${selectedChapterId}`);
        // Reload versions
        await loadVersions();
      }
    } catch (error) {
      console.error('Failed to revert:', error);
    } finally {
      setReverting(false);
    }
  };

  if (!showVersionHistory) return null;

  const previewedVersion = previewId ? versions.find(v => v.version_id === previewId) : null;

  return (
    <div className="fixed right-0 top-14 bottom-8 w-[400px] bg-white border-l border-gray-200 shadow-lg z-30 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <Clock size={18} className="text-gray-500" />
          <h3 className="font-medium text-gray-700">版本历史</h3>
          <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full">
            {versions.length}
          </span>
        </div>
        <button
          onClick={() => setShowVersionHistory(false)}
          className="p-1 hover:bg-gray-100 rounded transition-colors"
        >
          <X size={18} className="text-gray-500" />
        </button>
      </div>

      {/* Version List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="animate-spin text-gray-400" size={24} />
          </div>
        ) : versions.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">
            暂无历史版本
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {versions.map((version, idx) => (
              <div key={version.version_id} className="px-4 py-3 hover:bg-gray-50">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-700">
                      版本 #{version.version_id}
                    </span>
                    {idx === 0 && (
                      <span className="px-1.5 py-0.5 text-xs bg-green-50 text-green-700 rounded">
                        最新
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-gray-400">
                    {version.word_count || 0} 字
                  </span>
                </div>
                <div className="text-xs text-gray-500 mb-2">
                  {new Date(version.created_at).toLocaleString('zh-CN')}
                </div>
                {version.change_summary && (
                  <div className="text-xs text-gray-600 mb-2">
                    {version.change_summary}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handlePreview(version)}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                  >
                    <Eye size={12} />
                    {previewId === version.version_id ? '关闭预览' : '预览'}
                  </button>
                  {idx > 0 && (
                    <button
                      onClick={() => handleRevert(version)}
                      disabled={reverting}
                      className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:text-amber-600 hover:bg-amber-50 rounded transition-colors disabled:opacity-50"
                    >
                      <RotateCcw size={12} />
                      回滚
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Preview Panel */}
      {previewedVersion && (
        <div className="border-t border-gray-200 max-h-[40%] overflow-y-auto">
          <div className="px-4 py-2 bg-gray-50 text-xs text-gray-500 font-medium sticky top-0">
            版本 #{previewedVersion.version_id} 内容预览
          </div>
          <div className="px-4 py-3 text-sm text-gray-700 whitespace-pre-wrap">
            {previewedVersion.content.slice(0, 2000)}
            {previewedVersion.content.length > 2000 && (
              <span className="text-gray-400">... (已截断)</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
