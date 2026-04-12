'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useEditorStore } from '@/lib/store';
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
  Activity,
  RefreshCw,
  Home,
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
    pipelineRunCompleted,
    refreshDraftData,
    chapterEdits,
    activeProject,
    isRegenerating,
    regenerateChapter,
  } = useEditorStore();

  // 从 activeProject 推导显示名称
  const projectDisplayName = (() => {
    const p = activeProject || 'default';
    if (p === 'default') return 'ESG 报告';
    const idx = p.lastIndexOf('_');
    if (idx > 0) {
      const company = p.substring(0, idx);
      const year = p.substring(idx + 1);
      return `${company} ${year} ESG 报告`;
    }
    return `${p} ESG 报告`;
  })();

  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [regenConfirm, setRegenConfirm] = useState(false);

  const handleRegenerate = async () => {
    if (!selectedChapterId || isRegenerating) return;
    // 检查该章节是否有用户编辑
    const hasEdit = chapterEdits.has(selectedChapterId);
    if (hasEdit && !regenConfirm) {
      setRegenConfirm(true);
      return;
    }
    setRegenConfirm(false);
    try {
      await regenerateChapter(selectedChapterId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      window.alert(`重新生成失败：${msg}`);
    }
  };

  const handleRefreshData = async () => {
    const editCount = chapterEdits.size;
    let clearEdits = false;
    if (editCount > 0) {
      clearEdits = window.confirm(
        `检测到 ${editCount} 个章节有编辑记录。\n\n` +
        `点击「确定」→ 清除所有编辑，使用新生成的初稿\n` +
        `点击「取消」→ 保留编辑内容，仅更新未编辑的章节`
      );
    }
    setIsRefreshing(true);
    await refreshDraftData(clearEdits);
    setIsRefreshing(false);
  };

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
        body: JSON.stringify({ content, word_count: content.length, project_id: activeProject || 'default' }),
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
        body: JSON.stringify({ results: draftResults.results, project_id: activeProject || 'default' }),
      });
      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${projectDisplayName}.docx`;
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
        body: JSON.stringify({ results: draftResults.results, project_id: activeProject || 'default' }),
      });
      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${projectDisplayName}.md`;
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
    <div>
      {/* 主 Header — 52px，暖白，底部 2px 边框 */}
      <header style={{
        height: '52px',
        background: 'var(--bg-card)',
        borderBottom: '2px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        flexShrink: 0,
        gap: '0',
      }}>
        {/* 左侧：Logo + 面包屑导航 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0, overflow: 'hidden' }}>
          {/* Logo 方块（墨绿） */}
          <div style={{
            width: '22px', height: '22px',
            border: '2px solid var(--green)',
            borderRadius: '3px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <FileText size={12} style={{ color: 'var(--green)' }} />
          </div>

          {/* 面包屑：首页 / Pipeline / 当前报告 */}
          <nav style={{ display: 'flex', alignItems: 'center', gap: '2px', overflow: 'hidden' }}>
            <Link
              href="/"
              style={{
                fontSize: '12px', color: 'var(--text-3)',
                padding: '3px 7px', borderRadius: 'var(--radius-sm)',
                textDecoration: 'none',
                display: 'flex', alignItems: 'center', gap: '3px',
                flexShrink: 0,
                transition: 'background 0.15s, color 0.15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = 'var(--bg-warm)'; (e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-1)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = 'transparent'; (e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-3)'; }}
            >
              <Home size={11} />
              首页
            </Link>

            <span style={{ color: 'var(--border)', fontSize: '16px', fontWeight: 300, lineHeight: 1, userSelect: 'none', flexShrink: 0 }}>/</span>

            <Link
              href={`/pipeline?project=${encodeURIComponent(activeProject || '')}`}
              style={{
                fontSize: '12px', color: 'var(--text-3)',
                padding: '3px 7px', borderRadius: 'var(--radius-sm)',
                textDecoration: 'none',
                display: 'flex', alignItems: 'center', gap: '3px',
                flexShrink: 0,
                transition: 'background 0.15s, color 0.15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = 'var(--bg-warm)'; (e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-1)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = 'transparent'; (e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-3)'; }}
            >
              <Activity size={11} />
              Pipeline
            </Link>

            <span style={{ color: 'var(--border)', fontSize: '16px', fontWeight: 300, lineHeight: 1, userSelect: 'none', flexShrink: 0 }}>/</span>

            <span style={{
              fontSize: '12px', color: 'var(--text-1)', fontWeight: 500,
              padding: '3px 7px',
              pointerEvents: 'none',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {projectDisplayName}
            </span>
          </nav>

          {/* 保存状态指示 */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '4px',
            padding: '2px 8px', borderRadius: 'var(--radius-sm)',
            fontSize: '11px', marginLeft: '2px', flexShrink: 0,
            background: saveStatus === 'saving' ? 'var(--blue-soft)' :
                        saveStatus === 'saved' ? 'var(--green-soft)' : 'transparent',
            color: saveStatus === 'saving' ? 'var(--blue)' :
                   saveStatus === 'saved' ? 'var(--green)' : 'var(--text-4)',
          }}>
            {saveStatus === 'saving' && <><Loader2 size={11} className="animate-spin" /><span>保存中...</span></>}
            {saveStatus === 'saved' && <><Check size={11} /><span>已保存</span></>}
            {saveStatus === 'idle' && <span>自动保存</span>}
          </div>
        </div>

        {/* 右侧：操作按钮组 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
          {/* Undo/Redo */}
          <div style={{ display: 'flex', alignItems: 'center', borderRight: '1px solid var(--border-light)', paddingRight: '6px', marginRight: '2px' }}>
            <button
              title="撤销 (Ctrl+Z)"
              disabled={!tiptapEditor?.can().undo()}
              onClick={() => tiptapEditor?.chain().focus().undo().run()}
              style={{
                padding: '5px', background: 'none', border: 'none',
                borderRadius: 'var(--radius)', cursor: 'pointer',
                color: 'var(--text-3)',
                opacity: !tiptapEditor?.can().undo() ? 0.4 : 1,
                transition: 'background 0.15s, color 0.15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-warm)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-1)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-3)'; }}
            >
              <Undo2 size={15} />
            </button>
            <button
              title="重做 (Ctrl+Y)"
              disabled={!tiptapEditor?.can().redo()}
              onClick={() => tiptapEditor?.chain().focus().redo().run()}
              style={{
                padding: '5px', background: 'none', border: 'none',
                borderRadius: 'var(--radius)', cursor: 'pointer',
                color: 'var(--text-3)',
                opacity: !tiptapEditor?.can().redo() ? 0.4 : 1,
                transition: 'background 0.15s, color 0.15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-warm)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-1)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-3)'; }}
            >
              <Redo2 size={15} />
            </button>
          </div>

          {/* AI 助手 */}
          {currentChapter && (
            <button
              onClick={() => setShowAIPanel(!showAIPanel)}
              style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                padding: '5px 10px', fontSize: '12px', fontWeight: 500,
                borderRadius: 'var(--radius)', cursor: 'pointer', border: 'none',
                fontFamily: 'var(--font-body)',
                background: showAIPanel ? 'var(--indigo-soft)' : 'transparent',
                color: showAIPanel ? 'var(--indigo)' : 'var(--text-3)',
                transition: 'background 0.15s, color 0.15s',
              }}
              onMouseEnter={e => { if (!showAIPanel) { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-warm)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-1)'; }}}
              onMouseLeave={e => { if (!showAIPanel) { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-3)'; }}}
            >
              <Sparkles size={13} />
              AI 助手
            </button>
          )}

          {/* 重新生成本章 */}
          {selectedChapterId && (
            <div style={{ position: 'relative' }}>
              <button
                onClick={handleRegenerate}
                disabled={isRegenerating}
                title="用最新检索结果重新生成本章节初稿"
                style={{
                  padding: '5px', borderRadius: 'var(--radius)',
                  background: isRegenerating ? 'var(--amber-soft)' : 'none',
                  color: isRegenerating ? 'var(--amber)' : 'var(--text-3)',
                  border: 'none', cursor: isRegenerating ? 'not-allowed' : 'pointer',
                  transition: 'background 0.15s, color 0.15s',
                }}
                onMouseEnter={e => { if (!isRegenerating) { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-warm)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-1)'; }}}
                onMouseLeave={e => { if (!isRegenerating) { (e.currentTarget as HTMLButtonElement).style.background = 'none'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-3)'; }}}
              >
                {isRegenerating
                  ? <Loader2 size={15} className="animate-spin" />
                  : <RefreshCw size={15} />
                }
              </button>

              {/* 确认提示（inline，非全屏 Dialog） */}
              {regenConfirm && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 30 }} onClick={() => setRegenConfirm(false)} />
                  <div style={{
                    position: 'absolute', right: 0, top: 'calc(100% + 6px)',
                    width: '260px', background: 'var(--bg-card)',
                    border: '1px solid var(--amber-border)',
                    borderRadius: 'var(--radius)',
                    boxShadow: 'var(--shadow-md)',
                    zIndex: 40, padding: '12px 14px',
                  }}>
                    <p style={{ fontSize: '12px', color: 'var(--text-1)', margin: '0 0 8px', lineHeight: 1.6, fontFamily: 'var(--font-body)' }}>
                      此章节已有编辑内容。重新生成将更新 AI 初稿，原有编辑已保存在版本历史中，可随时回滚。
                    </p>
                    <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                      <button
                        onClick={() => setRegenConfirm(false)}
                        style={{
                          padding: '4px 10px', fontSize: '11px',
                          background: 'var(--bg-warm)', color: 'var(--text-2)',
                          border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                          cursor: 'pointer', fontFamily: 'var(--font-body)',
                        }}
                      >
                        取消
                      </button>
                      <button
                        onClick={handleRegenerate}
                        style={{
                          padding: '4px 10px', fontSize: '11px',
                          background: 'var(--amber)', color: '#fff',
                          border: 'none', borderRadius: 'var(--radius-sm)',
                          cursor: 'pointer', fontFamily: 'var(--font-body)',
                          fontWeight: 500,
                        }}
                      >
                        确认重新生成
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* 版本历史 */}
          <button
            onClick={() => setShowVersionHistory(!showVersionHistory)}
            title="版本历史"
            style={{
              padding: '5px', borderRadius: 'var(--radius)',
              background: showVersionHistory ? 'var(--blue-soft)' : 'none',
              color: showVersionHistory ? 'var(--blue)' : 'var(--text-3)',
              border: 'none', cursor: 'pointer',
              transition: 'background 0.15s, color 0.15s',
            }}
            onMouseEnter={e => { if (!showVersionHistory) { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-warm)'; }}}
            onMouseLeave={e => { if (!showVersionHistory) { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}}
          >
            <History size={15} />
          </button>

          {/* 保存按钮 */}
          <button
            onClick={handleSave}
            disabled={isSaving}
            style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              padding: '5px 11px', fontSize: '12px', fontWeight: 500,
              borderRadius: 'var(--radius)',
              cursor: isSaving ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--font-body)',
              background: 'var(--bg-warm)',
              color: 'var(--text-2)',
              border: '1px solid var(--border)',
              opacity: isSaving ? 0.6 : 1,
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => { if (!isSaving) (e.currentTarget as HTMLButtonElement).style.background = 'var(--border-light)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-warm)'; }}
          >
            {isSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            保存
          </button>

          {/* 导出下拉 */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setIsExportOpen(!isExportOpen)}
              disabled={isExporting}
              style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                padding: '5px 11px', fontSize: '12px', fontWeight: 500,
                borderRadius: 'var(--radius)',
                cursor: isExporting ? 'not-allowed' : 'pointer',
                fontFamily: 'var(--font-body)',
                background: 'var(--green)', color: '#fff',
                border: 'none',
                opacity: isExporting ? 0.6 : 1,
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => { if (!isExporting) (e.currentTarget as HTMLButtonElement).style.background = 'var(--green-hover)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--green)'; }}
            >
              {isExporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
              导出
              <ChevronDown size={11} />
            </button>

            {isExportOpen && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 10 }} onClick={() => setIsExportOpen(false)} />
                <div style={{
                  position: 'absolute', right: 0, top: '100%', marginTop: '4px',
                  width: '168px', background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  boxShadow: 'var(--shadow-md)',
                  zIndex: 20, padding: '4px',
                }}>
                  <button
                    onClick={handleExportWord}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: '8px',
                      padding: '7px 10px', fontSize: '12px', color: 'var(--text-2)',
                      background: 'none', border: 'none', borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer', fontFamily: 'var(--font-body)',
                      transition: 'background 0.15s', textAlign: 'left',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-warm)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    <FileText size={14} style={{ color: 'var(--blue)' }} />
                    导出 Word (.docx)
                  </button>
                  <button
                    onClick={handleExportMarkdown}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: '8px',
                      padding: '7px 10px', fontSize: '12px', color: 'var(--text-2)',
                      background: 'none', border: 'none', borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer', fontFamily: 'var(--font-body)',
                      transition: 'background 0.15s', textAlign: 'left',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-warm)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    <FileCode size={14} style={{ color: 'var(--text-3)' }} />
                    导出 Markdown
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Pipeline 完成通知条 */}
      {pipelineRunCompleted && (
        <div style={{
          background: 'var(--blue-soft)',
          borderBottom: '1px solid var(--blue-mid)',
          padding: '6px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: '12px', color: 'var(--blue)' }}>
            Pipeline 已完成，新数据可用。
          </span>
          <button
            onClick={handleRefreshData}
            disabled={isRefreshing}
            style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              padding: '3px 10px', fontSize: '12px', fontWeight: 500,
              background: 'var(--blue-mid)', color: 'var(--blue)',
              border: 'none', borderRadius: 'var(--radius)',
              cursor: isRefreshing ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--font-body)',
              opacity: isRefreshing ? 0.6 : 1,
            }}
          >
            {isRefreshing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            刷新数据
          </button>
        </div>
      )}
    </div>
  );
};
