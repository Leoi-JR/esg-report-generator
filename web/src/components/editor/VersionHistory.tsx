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
    activeProject,
  } = useEditorStore();

  const [versions, setVersions] = useState<VersionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [reverting, setReverting] = useState(false);

  const loadVersions = useCallback(async () => {
    if (!selectedChapterId) return;
    setLoading(true);
    try {
      const qs = activeProject ? `?project=${encodeURIComponent(activeProject)}` : '';
      const resp = await fetch(`/api/chapters/${selectedChapterId}/versions${qs}`);
      if (resp.ok) {
        const data = await resp.json();
        setVersions(data.versions || []);
      }
    } catch (error) {
      console.error('Failed to load versions:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedChapterId, activeProject]);

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
        body: JSON.stringify({ version_id: version.version_id, project_id: activeProject || 'default' }),
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
    <div style={{
      position: 'fixed',
      right: 0,
      // top-14 = 56px ≈ Toolbar 52px + 2px border；bottom-8 = 32px ≈ 页面底部留白
      // 改为 top:52px bottom:0，让 Drawer 精确从 Toolbar 底部延伸至页面底端
      top: '52px',
      bottom: 0,
      width: '380px',
      background: 'var(--bg-card)',
      borderLeft: '1px solid var(--border)',
      boxShadow: 'var(--shadow-md)',
      zIndex: 30,
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'var(--font-body)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
          <Clock size={15} style={{ color: 'var(--text-3)' }} />
          <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-1)', margin: 0, fontFamily: 'var(--font-head)' }}>
            版本历史
          </h3>
          <span style={{
            padding: '1px 7px', fontSize: '11px',
            background: 'var(--bg-warm)', color: 'var(--text-3)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-light)',
          }}>
            {versions.length}
          </span>
        </div>
        <button
          onClick={() => setShowVersionHistory(false)}
          style={{
            padding: '4px', borderRadius: 'var(--radius)', border: 'none',
            background: 'transparent', cursor: 'pointer',
            color: 'var(--text-4)', display: 'flex', alignItems: 'center',
            transition: 'background 0.15s, color 0.15s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-warm)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-2)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-4)'; }}
        >
          <X size={16} />
        </button>
      </div>

      {/* Version List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 0' }}>
            <Loader2 size={22} className="animate-spin" style={{ color: 'var(--text-4)' }} />
          </div>
        ) : versions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0', fontSize: '12px', color: 'var(--text-4)' }}>
            暂无历史版本
          </div>
        ) : (
          <div>
            {versions.map((version, idx) => (
              <div
                key={version.version_id}
                style={{
                  padding: '10px 14px',
                  borderBottom: '1px solid var(--border-light)',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-warm)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
              >
                {/* Version title row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-1)' }}>
                      版本 #{version.version_id}
                    </span>
                    {idx === 0 && (
                      <span style={{
                        padding: '1px 6px', fontSize: '11px',
                        background: 'var(--green-soft)', color: 'var(--green)',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--green-mid)',
                      }}>
                        最新
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: '11px', color: 'var(--text-4)' }}>
                    {version.word_count || 0} 字
                  </span>
                </div>

                {/* Timestamp */}
                <div style={{ fontSize: '11px', color: 'var(--text-4)', marginBottom: '6px' }}>
                  {new Date(version.created_at).toLocaleString('zh-CN')}
                </div>

                {/* Change summary */}
                {version.change_summary && (
                  <div style={{ fontSize: '11px', color: 'var(--text-3)', marginBottom: '7px' }}>
                    {version.change_summary}
                  </div>
                )}

                {/* Action buttons */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <button
                    onClick={() => handlePreview(version)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '4px',
                      padding: '3px 8px', fontSize: '11px',
                      borderRadius: 'var(--radius-sm)', border: 'none',
                      background: previewId === version.version_id ? 'var(--blue-soft)' : 'transparent',
                      color: previewId === version.version_id ? 'var(--blue)' : 'var(--text-3)',
                      cursor: 'pointer',
                      transition: 'background 0.15s, color 0.15s',
                    }}
                    onMouseEnter={e => { if (previewId !== version.version_id) { (e.currentTarget as HTMLButtonElement).style.background = 'var(--blue-soft)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--blue)'; }}}
                    onMouseLeave={e => { if (previewId !== version.version_id) { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-3)'; }}}
                  >
                    <Eye size={11} />
                    {previewId === version.version_id ? '关闭预览' : '预览'}
                  </button>
                  {idx > 0 && (
                    <button
                      onClick={() => handleRevert(version)}
                      disabled={reverting}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                        padding: '3px 8px', fontSize: '11px',
                        borderRadius: 'var(--radius-sm)', border: 'none',
                        background: 'transparent',
                        color: 'var(--text-3)',
                        cursor: reverting ? 'not-allowed' : 'pointer',
                        opacity: reverting ? 0.5 : 1,
                        transition: 'background 0.15s, color 0.15s',
                      }}
                      onMouseEnter={e => { if (!reverting) { (e.currentTarget as HTMLButtonElement).style.background = 'var(--amber-soft)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--amber)'; }}}
                      onMouseLeave={e => { if (!reverting) { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-3)'; }}}
                    >
                      <RotateCcw size={11} />
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
        <div style={{ borderTop: '1px solid var(--border)', maxHeight: '40%', overflowY: 'auto', flexShrink: 0 }}>
          <div style={{
            padding: '6px 14px', fontSize: '11px', fontWeight: 600,
            color: 'var(--text-3)', background: 'var(--bg-warm)',
            position: 'sticky', top: 0,
            borderBottom: '1px solid var(--border-light)',
          }}>
            版本 #{previewedVersion.version_id} 内容预览
          </div>
          <div style={{ padding: '12px 14px', fontSize: '12px', color: 'var(--text-2)', whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
            {previewedVersion.content.slice(0, 2000)}
            {previewedVersion.content.length > 2000 && (
              <span style={{ color: 'var(--text-4)' }}>... (已截断)</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
