'use client';

import React, { useState, useCallback, useRef } from 'react';
import { useEditorStore } from '@/lib/store';
import { AIAction, UploadedFile } from '@/lib/types';
import { textToBlockHTML } from '@/lib/tiptap/content-transform';
import {
  Sparkles,
  FileEdit,
  Search,
  MessageSquare,
  X,
  Check,
  XCircle,
  Upload,
  Loader2,
  Send,
  Trash2,
  Paperclip,
  FolderOpen,
} from 'lucide-react';

export const AIPanel: React.FC = () => {
  const {
    aiSelectedText,
    currentSources,
    selectedSourceIds,
    toggleSourceSelection,
    selectedChapterId,
    tiptapEditor,
    setShowAIPanel,
    activeProject,
  } = useEditorStore();

  const [isLoading, setIsLoading] = useState(false);
  const [aiResponse, setAiResponse] = useState<string>('');
  const [currentAction, setCurrentAction] = useState<AIAction | null>(null);
  const [customPrompt, setCustomPrompt] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const callAI = useCallback(async (action: AIAction, customPromptText?: string) => {
    if (!selectedChapterId || !aiSelectedText) return;

    setIsLoading(true);
    setAiResponse('');
    setCurrentAction(action);

    const sourceTexts = currentSources
      .filter(s => selectedSourceIds.has(s.id))
      .map(s => ({ id: s.id, text: s.text }));

    const uploadedFileIds = uploadedFiles.map(f => f.id);

    try {
      const endpoint = `/api/ai/${action}`;
      const body: Record<string, unknown> = {
        chapter_id: selectedChapterId,
        project_id: activeProject || 'default',
        selected_text: aiSelectedText,
        source_texts: sourceTexts,
        uploaded_file_ids: uploadedFileIds,
        action,
      };

      if (action === 'freeform' && customPromptText) {
        body.custom_prompt = customPromptText;
      }

      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (resp.ok) {
        const data = await resp.json();
        setAiResponse(data.text);
      } else {
        const err = await resp.json();
        setAiResponse(`错误：${err.error || 'AI 调用失败'}`);
      }
    } catch (error) {
      console.error('AI call failed:', error);
      setAiResponse('网络错误：无法连接到 AI 服务');
    } finally {
      setIsLoading(false);
    }
  }, [selectedChapterId, aiSelectedText, currentSources, selectedSourceIds, uploadedFiles, activeProject]);

  const insertAIContent = useCallback((text: string, mode: 'replace' | 'append') => {
    if (!tiptapEditor || !text) return;

    const html = textToBlockHTML(text);

    if (mode === 'append') {
      const { to } = tiptapEditor.state.selection;
      tiptapEditor.chain().focus().insertContentAt(to, html, {
        parseOptions: { preserveWhitespace: false }
      }).run();
    } else {
      tiptapEditor.chain().focus().deleteSelection().insertContent(html, {
        parseOptions: { preserveWhitespace: false }
      }).run();
    }
  }, [tiptapEditor]);

  const handleAccept = useCallback(async () => {
    if (!tiptapEditor || !aiResponse || !selectedChapterId) return;

    if (currentAction === 'extend') {
      insertAIContent(aiResponse, 'append');
    } else if (currentAction === 'polish' || currentAction === 'freeform') {
      insertAIContent(aiResponse, 'replace');
    }

    setAiResponse('');
    setCurrentAction(null);
  }, [tiptapEditor, aiResponse, currentAction, selectedChapterId, insertAIContent]);

  const handleReject = useCallback(() => {
    setAiResponse('');
    setCurrentAction(null);
  }, []);

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const resp = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (resp.ok) {
        const data = await resp.json();
        setUploadedFiles(prev => [...prev, data.file]);
      }
    } catch (error) {
      console.error('Upload failed:', error);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, []);

  const handleFreeformSubmit = useCallback(() => {
    if (!customPrompt.trim()) return;
    callAI('freeform', customPrompt);
    setCustomPrompt('');
  }, [customPrompt, callAI]);

  const handleClose = useCallback(() => {
    setShowAIPanel(false);
    setAiResponse('');
    setCurrentAction(null);
  }, [setShowAIPanel]);

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg-card)',
      fontFamily: 'var(--font-body)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: '40px',
        padding: '0 12px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-warm)',
        flexShrink: 0,
        boxSizing: 'border-box',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Sparkles size={14} style={{ color: 'var(--indigo)' }} />
          <span style={{
            fontFamily: 'var(--font-head)',
            fontSize: '12px',
            fontWeight: 600,
            color: 'var(--text-1)',
          }}>
            AI 助手
          </span>
        </div>
        <button
          onClick={handleClose}
          style={{
            padding: '4px',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-4)',
            borderRadius: 'var(--radius-sm)',
            display: 'flex',
            alignItems: 'center',
            transition: 'background 0.15s, color 0.15s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--border-light)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-1)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-4)'; }}
        >
          <X size={16} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>

        {/* 选中文本预览 */}
        {aiSelectedText ? (
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-light)' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-4)', marginBottom: '5px', fontWeight: 500 }}>
              选中文本
            </div>
            <div style={{
              fontSize: '12px',
              color: 'var(--text-2)',
              background: 'var(--bg-warm)',
              border: '1px solid var(--border-light)',
              borderRadius: 'var(--radius)',
              padding: '7px 10px',
              maxHeight: '80px',
              overflowY: 'auto',
              lineHeight: 1.7,
            }}>
              {aiSelectedText.slice(0, 500)}
              {aiSelectedText.length > 500 && '...'}
            </div>
          </div>
        ) : (
          <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--text-4)', fontSize: '12px' }}>
            请在编辑器中选中文本以使用 AI 助手
          </div>
        )}

        {/* 参考来源勾选 */}
        {aiSelectedText && currentSources.length > 0 && (
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-light)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: 'var(--text-4)', fontWeight: 500, marginBottom: '7px' }}>
              <Paperclip size={11} />
              参考来源（勾选作为 AI 上下文）
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '140px', overflowY: 'auto' }}>
              {currentSources.map(source => (
                <label
                  key={source.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '7px',
                    fontSize: '11px',
                    cursor: 'pointer',
                    padding: '4px 6px',
                    borderRadius: 'var(--radius-sm)',
                    transition: 'background 0.12s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-warm)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <input
                    type="checkbox"
                    checked={selectedSourceIds.has(source.id)}
                    onChange={() => toggleSourceSelection(source.id)}
                    style={{ marginTop: '1px', accentColor: 'var(--green)' }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-2)' }}>[{source.id}]</span>
                    <span style={{ color: 'var(--text-3)', marginLeft: '4px' }}>
                      {source.file_name} p.{source.page}
                    </span>
                    <span style={{ color: 'var(--text-4)', marginLeft: '4px' }}>
                      ({(source.score * 100).toFixed(0)}%)
                    </span>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* 补充资料上传 */}
        {aiSelectedText && (
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-light)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: 'var(--text-4)', fontWeight: 500, marginBottom: '7px' }}>
              <FolderOpen size={11} />
              补充资料
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt,.xlsx"
              onChange={handleUpload}
              style={{ display: 'none' }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 10px',
                fontSize: '11px',
                color: 'var(--text-2)',
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                cursor: isUploading ? 'not-allowed' : 'pointer',
                fontFamily: 'var(--font-body)',
                opacity: isUploading ? 0.6 : 1,
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => { if (!isUploading) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-warm)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
            >
              {isUploading ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
              上传文件
            </button>
            {uploadedFiles.length > 0 && (
              <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                {uploadedFiles.map(f => (
                  <div key={f.id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '11px',
                    color: 'var(--text-3)',
                    background: 'var(--bg-warm)',
                    border: '1px solid var(--border-light)',
                    padding: '4px 8px',
                    borderRadius: 'var(--radius-sm)',
                  }}>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.file_name}
                    </span>
                    <button
                      onClick={() => setUploadedFiles(prev => prev.filter(x => x.id !== f.id))}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: 'var(--text-4)', padding: '1px',
                        display: 'flex', alignItems: 'center',
                        transition: 'color 0.15s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.color = 'var(--red)')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-4)')}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 操作按钮组 */}
        {aiSelectedText && (
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-light)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              {/* 润色 — indigo 实色（最重要操作） */}
              <button
                onClick={() => callAI('polish')}
                disabled={isLoading}
                style={{
                  display: 'flex', alignItems: 'center', gap: '4px',
                  padding: '4px 10px', fontSize: '11px', fontWeight: 500,
                  background: 'var(--indigo)', color: '#fff',
                  border: '1px solid var(--indigo)',
                  borderRadius: 'var(--radius)', cursor: isLoading ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--font-body)', opacity: isLoading ? 0.5 : 1,
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => { if (!isLoading) (e.currentTarget as HTMLButtonElement).style.background = 'var(--indigo-hover)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--indigo)'; }}
              >
                <Sparkles size={11} />
                润色
              </button>

              {/* 续写 — indigo 中软色 */}
              <button
                onClick={() => callAI('extend')}
                disabled={isLoading}
                style={{
                  display: 'flex', alignItems: 'center', gap: '4px',
                  padding: '4px 10px', fontSize: '11px', fontWeight: 500,
                  background: 'var(--indigo-mid)', color: 'var(--indigo)',
                  border: '1px solid var(--indigo-mid-border)',
                  borderRadius: 'var(--radius)', cursor: isLoading ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--font-body)', opacity: isLoading ? 0.5 : 1,
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => { if (!isLoading) (e.currentTarget as HTMLButtonElement).style.background = 'var(--indigo-line)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--indigo-mid)'; }}
              >
                <FileEdit size={11} />
                续写
              </button>

              {/* 核查 — indigo 最浅软色 */}
              <button
                onClick={() => callAI('verify')}
                disabled={isLoading}
                style={{
                  display: 'flex', alignItems: 'center', gap: '4px',
                  padding: '4px 10px', fontSize: '11px', fontWeight: 500,
                  background: 'var(--indigo-soft)', color: 'var(--indigo)',
                  border: '1px solid var(--indigo-line)',
                  borderRadius: 'var(--radius)', cursor: isLoading ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--font-body)', opacity: isLoading ? 0.5 : 1,
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => { if (!isLoading) (e.currentTarget as HTMLButtonElement).style.background = 'var(--indigo-mid)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--indigo-soft)'; }}
              >
                <Search size={11} />
                核查
              </button>
            </div>
          </div>
        )}

        {/* 自定义指令输入框 */}
        {aiSelectedText && (
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-light)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: 'var(--text-4)', fontWeight: 500, marginBottom: '7px' }}>
              <MessageSquare size={11} />
              自定义指令
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <input
                type="text"
                value={customPrompt}
                onChange={e => setCustomPrompt(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleFreeformSubmit();
                  }
                }}
                placeholder="请输入你的要求..."
                style={{
                  flex: 1,
                  padding: '6px 10px',
                  fontSize: '12px',
                  fontFamily: 'var(--font-body)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  background: 'var(--bg-card)',
                  color: 'var(--text-1)',
                  outline: 'none',
                }}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--indigo)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
              />
              <button
                onClick={handleFreeformSubmit}
                disabled={isLoading || !customPrompt.trim()}
                style={{
                  padding: '6px',
                  color: customPrompt.trim() && !isLoading ? 'var(--indigo)' : 'var(--text-4)',
                  background: 'none',
                  border: 'none',
                  borderRadius: 'var(--radius)',
                  cursor: isLoading || !customPrompt.trim() ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => { if (customPrompt.trim() && !isLoading) (e.currentTarget as HTMLButtonElement).style.background = 'var(--indigo-soft)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
              >
                <Send size={15} />
              </button>
            </div>
          </div>
        )}

        {/* AI 回复区域 */}
        <div style={{ padding: '10px 12px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-4)', fontWeight: 500, marginBottom: '7px' }}>
            AI 回复
          </div>
          {isLoading ? (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: '8px', padding: '28px 0',
              color: 'var(--text-3)', fontSize: '12px',
            }}>
              <Loader2 size={16} className="animate-spin" style={{ color: 'var(--indigo)' }} />
              <span>AI 正在思考中...</span>
            </div>
          ) : aiResponse ? (
            <div>
              <div style={{
                fontSize: '12px',
                color: 'var(--text-2)',
                background: 'var(--bg-warm)',
                border: '1px solid var(--border-light)',
                borderRadius: 'var(--radius)',
                padding: '10px 12px',
                whiteSpace: 'pre-wrap',
                maxHeight: '220px',
                overflowY: 'auto',
                lineHeight: 1.75,
                fontFamily: 'var(--font-body)',
              }}>
                {aiResponse}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px', marginTop: '10px' }}>
                {currentAction !== 'verify' && (
                  <button
                    onClick={handleAccept}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '4px',
                      padding: '5px 12px', fontSize: '12px', fontWeight: 500,
                      background: 'var(--green)', color: '#fff',
                      border: 'none', borderRadius: 'var(--radius)',
                      cursor: 'pointer', fontFamily: 'var(--font-body)',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--green-hover)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'var(--green)')}
                  >
                    <Check size={13} />
                    采纳
                  </button>
                )}
                <button
                  onClick={handleReject}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '4px',
                    padding: '5px 12px', fontSize: '12px', fontWeight: 500,
                    background: 'var(--bg-warm)', color: 'var(--text-2)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    cursor: 'pointer', fontFamily: 'var(--font-body)',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--border-light)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'var(--bg-warm)')}
                >
                  <XCircle size={13} />
                  {currentAction === 'verify' ? '关闭' : '拒绝'}
                </button>
              </div>
            </div>
          ) : aiSelectedText ? (
            <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-4)', fontSize: '12px' }}>
              点击上方按钮开始 AI 操作
            </div>
          ) : null}
        </div>

      </div>
    </div>
  );
};
