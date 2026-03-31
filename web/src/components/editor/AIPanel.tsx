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
} from 'lucide-react';
import { cn } from '@/lib/utils';

export const AIPanel: React.FC = () => {
  const {
    aiSelectedText,
    currentSources,
    selectedSourceIds,
    toggleSourceSelection,
    selectedChapterId,
    tiptapEditor,
    setShowAIPanel,
  } = useEditorStore();

  const [isLoading, setIsLoading] = useState(false);
  const [aiResponse, setAiResponse] = useState<string>('');
  const [aiHistoryId, setAiHistoryId] = useState<number | null>(null);
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
        setAiHistoryId(data.ai_history_id);
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
  }, [selectedChapterId, aiSelectedText, currentSources, selectedSourceIds, uploadedFiles]);

  /**
   * 将 AI 返回的文本转换为 Tiptap 兼容的 HTML 并插入编辑器。
   * 使用 textToBlockHTML 确保 [来源X] 被正确渲染为可点击角标，
   * 且段落结构和行距与现有内容保持一致。
   */
  const insertAIContent = useCallback((text: string, mode: 'replace' | 'append') => {
    if (!tiptapEditor || !text) return;

    // 将纯文本转换为带段落结构的 HTML（处理 [来源X] 等标记）
    const html = textToBlockHTML(text);

    if (mode === 'append') {
      // 续写：在当前光标位置后追加
      const { to } = tiptapEditor.state.selection;
      tiptapEditor.chain().focus().insertContentAt(to, html, {
        parseOptions: { preserveWhitespace: false }
      }).run();
    } else {
      // 替换：删除选中内容并插入新内容
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
    // verify 操作不替换任何内容

    // 记录采纳（非关键操作）
    if (aiHistoryId) {
      fetch('/api/ai/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: aiHistoryId, accepted: 1 }),
      }).catch(() => {});
    }

    setAiResponse('');
    setAiHistoryId(null);
    setCurrentAction(null);
  }, [tiptapEditor, aiResponse, currentAction, aiHistoryId, selectedChapterId, insertAIContent]);

  const handleReject = useCallback(() => {
    setAiResponse('');
    setAiHistoryId(null);
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
    setAiHistoryId(null);
    setCurrentAction(null);
  }, [setShowAIPanel]);

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gradient-to-r from-purple-50 to-white flex-shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-purple-600" />
          <h3 className="font-medium text-gray-700">AI 助手</h3>
        </div>
        <button
          onClick={handleClose}
          className="p-1 hover:bg-gray-100 rounded transition-colors"
        >
          <X size={18} className="text-gray-500" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Selected Text */}
        {aiSelectedText && (
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="text-xs text-gray-500 mb-1 font-medium">选中文本：</div>
            <div className="text-sm text-gray-700 bg-gray-50 p-2 rounded max-h-24 overflow-y-auto leading-relaxed">
              {aiSelectedText.slice(0, 500)}
              {aiSelectedText.length > 500 && '...'}
            </div>
          </div>
        )}

        {!aiSelectedText && (
          <div className="px-4 py-6 text-center text-gray-400 text-sm">
            请在编辑器中选中文本以使用 AI 助手
          </div>
        )}

        {/* Source Selection */}
        {aiSelectedText && currentSources.length > 0 && (
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="text-xs text-gray-500 mb-2 font-medium flex items-center gap-1">
              📎 参考来源（勾选作为 AI 上下文）：
            </div>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {currentSources.map(source => (
                <label
                  key={source.id}
                  className="flex items-start gap-2 text-xs cursor-pointer hover:bg-gray-50 p-1 rounded"
                >
                  <input
                    type="checkbox"
                    checked={selectedSourceIds.has(source.id)}
                    onChange={() => toggleSourceSelection(source.id)}
                    className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-gray-700 font-medium">[{source.id}]</span>
                    <span className="text-gray-500 ml-1 truncate">
                      {source.file_name} p.{source.page}
                    </span>
                    <span className="text-gray-400 ml-1">
                      ({(source.score * 100).toFixed(0)}%)
                    </span>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Upload Section */}
        {aiSelectedText && (
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="text-xs text-gray-500 mb-2 font-medium">📁 补充资料：</div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt,.xlsx"
              onChange={handleUpload}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="flex items-center gap-1 px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              {isUploading ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Upload size={12} />
              )}
              上传文件
            </button>
            {uploadedFiles.length > 0 && (
              <div className="mt-2 space-y-1">
                {uploadedFiles.map(f => (
                  <div key={f.id} className="flex items-center gap-2 text-xs text-gray-600 bg-gray-50 p-1.5 rounded">
                    <span className="truncate flex-1">{f.file_name}</span>
                    <button
                      onClick={() => setUploadedFiles(prev => prev.filter(x => x.id !== f.id))}
                      className="text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Action Buttons */}
        {aiSelectedText && (
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <button
                onClick={() => callAI('polish')}
                disabled={isLoading}
                className={cn(
                  'flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
                  'bg-purple-50 text-purple-700 hover:bg-purple-100 disabled:opacity-50'
                )}
              >
                <Sparkles size={12} />
                润色
              </button>
              <button
                onClick={() => callAI('extend')}
                disabled={isLoading}
                className={cn(
                  'flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
                  'bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50'
                )}
              >
                <FileEdit size={12} />
                续写
              </button>
              <button
                onClick={() => callAI('verify')}
                disabled={isLoading}
                className={cn(
                  'flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
                  'bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-50'
                )}
              >
                <Search size={12} />
                核查
              </button>
            </div>
          </div>
        )}

        {/* Freeform Input */}
        {aiSelectedText && (
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="text-xs text-gray-500 mb-2 font-medium flex items-center gap-1">
              <MessageSquare size={12} />
              自定义指令：
            </div>
            <div className="flex items-center gap-2">
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
                className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
              <button
                onClick={handleFreeformSubmit}
                disabled={isLoading || !customPrompt.trim()}
                className="p-1.5 text-purple-600 hover:bg-purple-50 rounded-lg transition-colors disabled:opacity-50"
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        )}

        {/* AI Response */}
        <div className="px-4 py-3">
          <div className="text-xs text-gray-500 mb-2 font-medium">🤖 AI 回复：</div>
          {isLoading ? (
            <div className="flex items-center gap-2 py-8 justify-center text-gray-400">
              <Loader2 size={20} className="animate-spin" />
              <span className="text-sm">AI 正在思考中...</span>
            </div>
          ) : aiResponse ? (
            <div>
              <div className="text-sm text-gray-700 bg-gray-50 p-3 rounded-lg whitespace-pre-wrap max-h-60 overflow-y-auto leading-relaxed">
                {aiResponse}
              </div>
              <div className="flex items-center gap-2 mt-3 justify-end">
                {currentAction !== 'verify' && (
                  <button
                    onClick={handleAccept}
                    className="flex items-center gap-1 px-4 py-1.5 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors"
                  >
                    <Check size={14} />
                    采纳
                  </button>
                )}
                <button
                  onClick={handleReject}
                  className="flex items-center gap-1 px-4 py-1.5 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  <XCircle size={14} />
                  {currentAction === 'verify' ? '关闭' : '拒绝'}
                </button>
              </div>
            </div>
          ) : aiSelectedText ? (
            <div className="text-center py-6 text-gray-400 text-sm">
              点击上方按钮开始 AI 操作
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
