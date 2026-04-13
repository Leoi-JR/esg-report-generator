'use client';

import React, { Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Play,
  RefreshCw,
  Check,
  Trash2,
  Plus,
  Loader2,
  Home,
  ChevronDown,
  Eye,
  EyeOff,
} from 'lucide-react';
import type { PlaygroundPrompt } from '@/lib/db';
import { SOURCE_TAG_SPLIT, SOURCE_TAG_CAPTURE, parseSourceIds } from '@/lib/source-patterns';

// ─── 类型定义 ───

interface ChapterTopChunk {
  rank: number;
  score: number;
  file_name: string;
  page_or_sheet: string | number;
  text?: string;
}

interface ChapterOption {
  id: string;
  leaf_title: string;
  full_path?: string;
  gloss?: string;
  retrieval_query?: string;
  has_retrieval: boolean;
  top_chunks: ChapterTopChunk[];
}

interface VersionState {
  data: PlaygroundPrompt;
  systemDraft: string;
  userDraft: string;
  runStatus: 'idle' | 'running' | 'done' | 'error';
  streamOutput: string;
  errorMsg: string | null;
  nameDraft: string;
  isEditingName: boolean;
  /** rank → chunk，运行完后从 chapter.top_chunks 填入，供 Popover 使用 */
  chunkMap: Record<number, ChapterTopChunk>;
}

function mkVersionState(data: PlaygroundPrompt): VersionState {
  return {
    data,
    systemDraft: data.system_prompt,
    userDraft: data.user_prompt,
    runStatus: 'idle',
    streamOutput: data.last_output || '',
    errorMsg: null,
    nameDraft: data.version_name,
    isEditingName: false,
    chunkMap: {},
  };
}

// ─── 主组件内部（需要 useSearchParams） ───

function PlaygroundInner() {
  const searchParams = useSearchParams();
  const project = searchParams.get('project') || '';

  const [chapters, setChapters] = useState<ChapterOption[]>([]);
  const [selectedChapterId, setSelectedChapterId] = useState<string>('');
  const [versions, setVersions] = useState<VersionState[]>([]);
  const [isLoadingChapters, setIsLoadingChapters] = useState(true);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  /** 当前聚焦的版本列索引，右侧来源面板据此切换 */
  const [focusedVersionIdx, setFocusedVersionIdx] = useState(0);

  // 用于并发安全更新单个版本状态
  const updateVersion = useCallback((idx: number, updater: (prev: VersionState) => VersionState) => {
    setVersions(prev => prev.map((v, i) => i === idx ? updater(v) : v));
  }, []);

  // ── 加载章节列表 ──
  useEffect(() => {
    if (!project) { setIsLoadingChapters(false); return; }
    setIsLoadingChapters(true);
    const qs = `?project=${encodeURIComponent(project)}`;
    fetch(`/api/pipeline/data/retrieval${qs}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then((res: { items: { id: string; leaf_title: string; full_path?: string; gloss?: string; retrieval_query?: string; chunk_count?: number; max_score?: number; top_chunks?: ChapterTopChunk[] }[] }) => {
        const items = res.items ?? [];
        setChapters(items.map(item => ({
          id: item.id,
          leaf_title: item.leaf_title,
          full_path: item.full_path,
          gloss: item.gloss,
          retrieval_query: item.retrieval_query,
          has_retrieval: (item.chunk_count ?? 0) > 0,
          top_chunks: (item.top_chunks ?? []).map(c => ({
            rank: c.rank,
            score: c.score,
            file_name: c.file_name,
            page_or_sheet: c.page_or_sheet,
            text: c.text,
          })),
        })));
        // 默认选第一个有检索结果的章节
        const first = items.find(it => (it.chunk_count ?? 0) > 0);
        if (first) setSelectedChapterId(first.id);
      })
      .catch(err => setGlobalError(`加载章节列表失败: ${err}`))
      .finally(() => setIsLoadingChapters(false));
  }, [project]);

  // ── 切换章节时加载版本列表 ──
  useEffect(() => {
    if (!selectedChapterId || !project) return;
    setIsLoadingVersions(true);
    const qs = `?project=${encodeURIComponent(project)}&chapter=${encodeURIComponent(selectedChapterId)}`;
    fetch(`/api/playground${qs}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then((list: PlaygroundPrompt[]) => {
        if (list.length === 0) {
          // 自动新建第一个版本
          return fetch('/api/playground', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ project, chapter_id: selectedChapterId, version_name: '版本1' }),
          })
            .then(r => r.json())
            .then(res => [res.version] as PlaygroundPrompt[]);
        }
        return list;
      })
      .then((list: PlaygroundPrompt[]) => {
        setVersions(list.map(mkVersionState));
        setFocusedVersionIdx(0);
      })
      .catch(err => setGlobalError(`加载 Prompt 版本失败: ${err}`))
      .finally(() => setIsLoadingVersions(false));
  }, [selectedChapterId, project]);

  // ── 运行单个版本 ──
  const runVersion = useCallback(async (idx: number) => {
    const v = versions[idx];
    if (!v || v.runStatus === 'running') return;

    // 1. 后台静默保存草稿
    fetch(`/api/playground/${v.data.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system_prompt: v.systemDraft, user_prompt: v.userDraft }),
    }).catch(() => { /* 保存失败不阻塞运行 */ });

    // 2. 切换状态
    updateVersion(idx, s => ({ ...s, runStatus: 'running', streamOutput: '', errorMsg: null }));

    // 3. 发起 SSE 请求
    try {
      const res = await fetch('/api/playground/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version_id: v.data.id,
          system_prompt: v.systemDraft,
          user_prompt_template: v.userDraft,
          chapter_id: selectedChapterId,
          project,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      if (!res.body) throw new Error('响应体为空');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const dataStr = trimmed.slice(5).trim();
          try {
            const parsed = JSON.parse(dataStr) as { delta?: string; done?: boolean };
            if (parsed.delta) {
              updateVersion(idx, s => ({ ...s, streamOutput: s.streamOutput + parsed.delta! }));
            }
            if (parsed.done) {
              updateVersion(idx, s => ({ ...s, runStatus: 'done' }));
            }
          } catch {
            // skip malformed
          }
        }
      }

      // 确保最终状态是 done，并写入 chunkMap
      updateVersion(idx, s => {
        if (s.runStatus !== 'running') return s;
        const chunkMap: Record<number, ChapterTopChunk> = {};
        const ch = chapters.find(c => c.id === selectedChapterId);
        if (ch) ch.top_chunks.forEach(c => { chunkMap[c.rank] = c; });
        return { ...s, runStatus: 'done', chunkMap };
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      updateVersion(idx, s => ({ ...s, runStatus: 'error', errorMsg: msg }));
    }
  }, [versions, selectedChapterId, project, updateVersion]);

  // ── 全部运行 ──
  const runAll = useCallback(() => {
    Promise.all(versions.map((_, idx) => runVersion(idx)));
  }, [versions, runVersion]);

  // ── 新增版本 ──
  const addVersion = useCallback(async () => {
    const versionNum = versions.length + 1;
    try {
      const res = await fetch('/api/playground', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project,
          chapter_id: selectedChapterId,
          version_name: `版本${versionNum}`,
        }),
      });
      const data = await res.json() as { version: PlaygroundPrompt };
      setVersions(prev => [...prev, mkVersionState(data.version)]);
    } catch (err: unknown) {
      setGlobalError(`新建版本失败: ${err}`);
    }
  }, [versions.length, project, selectedChapterId]);

  // ── 采用版本 ──
  const activateVersion = useCallback(async (idx: number) => {
    const v = versions[idx];
    // 先保存草稿
    await fetch(`/api/playground/${v.data.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system_prompt: v.systemDraft, user_prompt: v.userDraft }),
    });
    // 采用
    const res = await fetch(`/api/playground/${v.data.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'activate', project, chapter_id: selectedChapterId }),
    });
    if (res.ok) {
      const data = await res.json() as { versions: PlaygroundPrompt[] };
      setVersions(data.versions.map((d, i) => ({
        ...versions[i] ?? mkVersionState(d),
        data: d,
      })));
    }
  }, [versions, project, selectedChapterId]);

  // ── 删除版本 ──
  const deleteVersion = useCallback(async (idx: number) => {
    const v = versions[idx];
    const res = await fetch(`/api/playground/${v.data.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({} as { error?: string })) as { error?: string };
      setGlobalError(data.error || '删除失败');
      return;
    }
    setVersions(prev => prev.filter((_, i) => i !== idx));
  }, [versions]);

  // ── 保存版本名 ──
  const saveVersionName = useCallback((idx: number) => {
    const v = versions[idx];
    fetch(`/api/playground/${v.data.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version_name: v.nameDraft }),
    }).then(r => r.json()).then((data: { version: PlaygroundPrompt }) => {
      updateVersion(idx, s => ({ ...s, data: data.version, isEditingName: false }));
    }).catch(() => {
      updateVersion(idx, s => ({ ...s, isEditingName: false }));
    });
  }, [versions, updateVersion]);

  // ── 当前章节信息 ──
  const currentChapter = chapters.find(c => c.id === selectedChapterId);
  const hasRetrieval = currentChapter?.has_retrieval ?? false;

  // ── 派生项目显示名 ──
  const projectDisplayName = (() => {
    if (!project || project === 'default') return 'ESG 报告';
    const idx = project.lastIndexOf('_');
    if (idx > 0) return `${project.substring(0, idx)} ${project.substring(idx + 1)}`;
    return project;
  })();

  const qs = project ? `?project=${encodeURIComponent(project)}` : '';

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', overflow: 'hidden' }}>

      {/* ── 顶部 Header ── */}
      <header style={{
        height: '52px',
        background: 'var(--bg-card)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        flexShrink: 0,
        gap: '12px',
      }}>
        {/* 左：面包屑 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0 }}>
          <Link href={`/${qs}`} style={{ color: 'var(--text-3)', display: 'flex', alignItems: 'center' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-1)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-3)')}
          >
            <Home size={14} />
          </Link>
          <span style={{ color: 'var(--text-4)', fontSize: '11px', margin: '0 2px' }}>/</span>
          <Link href={`/pipeline${qs}`}
            style={{ color: 'var(--text-3)', fontSize: '11px', textDecoration: 'none', fontFamily: 'var(--font-body)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-1)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-3)')}
          >Pipeline</Link>
          <span style={{ color: 'var(--text-4)', fontSize: '11px', margin: '0 2px' }}>/</span>
          <Link href={`/editor${qs}`}
            style={{ color: 'var(--text-3)', fontSize: '11px', textDecoration: 'none', fontFamily: 'var(--font-body)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-1)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-3)')}
          >编辑器</Link>
          <span style={{ color: 'var(--text-4)', fontSize: '11px', margin: '0 2px' }}>/</span>
          <span style={{ color: 'var(--text-1)', fontSize: '11px', fontFamily: 'var(--font-body)', fontWeight: 600 }}>
            Playground
          </span>
        </div>

        {/* 右：项目名 + 章节选择器 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          {project && (
            <span style={{
              fontSize: '11px', color: 'var(--text-3)',
              fontFamily: 'var(--font-body)',
              background: 'var(--bg-warm)',
              padding: '2px 8px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
            }}>
              {projectDisplayName}
            </span>
          )}

          {!project ? (
            <span style={{ fontSize: '12px', color: 'var(--text-4)', fontFamily: 'var(--font-body)' }}>
              请先从首页选择项目
            </span>
          ) : isLoadingChapters ? (
            <Loader2 size={14} style={{ color: 'var(--text-4)' }} className="animate-spin" />
          ) : (
            <div style={{ position: 'relative' }}>
              <select
                value={selectedChapterId}
                onChange={e => setSelectedChapterId(e.target.value)}
                style={{
                  appearance: 'none',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '4px 28px 4px 10px',
                  fontSize: '12px',
                  color: 'var(--text-1)',
                  fontFamily: 'var(--font-body)',
                  cursor: 'pointer',
                  minWidth: '200px',
                  maxWidth: '300px',
                }}
              >
                {chapters.map(ch => (
                  <option key={ch.id} value={ch.id} disabled={!ch.has_retrieval}>
                    {ch.id} {ch.leaf_title}{!ch.has_retrieval ? ' （无检索结果）' : ''}
                  </option>
                ))}
              </select>
              <ChevronDown size={12} style={{
                position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)',
                color: 'var(--text-4)', pointerEvents: 'none',
              }} />
            </div>
          )}
        </div>
      </header>

      {/* ── 全局错误提示 ── */}
      {globalError && (
        <div style={{
          background: 'var(--red-soft)', border: '1px solid var(--red-line)',
          color: 'var(--red)', padding: '8px 14px', fontSize: '12px',
          fontFamily: 'var(--font-body)', display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', flexShrink: 0,
        }}>
          <span>{globalError}</span>
          <button onClick={() => setGlobalError(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', fontSize: '12px', fontFamily: 'var(--font-body)' }}>
            关闭
          </button>
        </div>
      )}

      {/* ── 主体：版本列区 + 右侧来源面板 ── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'row' }}>

        {/* 左侧：版本列横向滚动区 */}
        <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
          {!project ? (
            <EmptyState message="请先从首页选择一个项目，再进入 Playground" />
          ) : isLoadingVersions ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
              <Loader2 size={28} className="animate-spin" style={{ color: 'var(--text-4)' }} />
            </div>
          ) : !selectedChapterId ? (
            <EmptyState message="请选择一个章节" />
          ) : (
            <div style={{
              display: 'flex',
              flexDirection: 'row',
              gap: '12px',
              padding: '16px 20px',
              alignItems: 'flex-start',
              minHeight: '100%',
            }}>
              {/* 版本列 */}
              {versions.map((v, idx) => (
                <VersionColumn
                  key={v.data.id}
                  v={v}
                  idx={idx}
                  isFirst={idx === 0}
                  totalVersions={versions.length}
                  hasRetrieval={hasRetrieval}
                  chapter={currentChapter}
                  isFocused={focusedVersionIdx === idx}
                  project={project}
                  onFocus={() => setFocusedVersionIdx(idx)}
                  onSystemChange={val => updateVersion(idx, s => ({ ...s, systemDraft: val }))}
                  onUserChange={val => updateVersion(idx, s => ({ ...s, userDraft: val }))}
                  onNameChange={val => updateVersion(idx, s => ({ ...s, nameDraft: val }))}
                  onNameEditStart={() => updateVersion(idx, s => ({ ...s, isEditingName: true }))}
                  onNameSave={() => saveVersionName(idx)}
                  onRun={() => runVersion(idx)}
                  onRunAll={runAll}
                  onActivate={() => activateVersion(idx)}
                  onDelete={() => deleteVersion(idx)}
                />
              ))}

              {/* 新增版本按钮 */}
              <button
                onClick={addVersion}
                style={{
                  minWidth: '180px',
                  alignSelf: 'stretch',
                  minHeight: '200px',
                  border: '2px dashed var(--border)',
                  borderRadius: 'var(--radius)',
                  background: 'transparent',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  color: 'var(--text-4)',
                  fontFamily: 'var(--font-body)',
                  fontSize: '12px',
                  flexShrink: 0,
                  transition: 'border-color 0.15s, color 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'var(--green)';
                  e.currentTarget.style.color = 'var(--green)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'var(--border)';
                  e.currentTarget.style.color = 'var(--text-4)';
                }}
              >
                <Plus size={20} />
                新增版本
              </button>
            </div>
          )}
        </div>

        {/* 右侧：来源面板 */}
        {selectedChapterId && versions.length > 0 && (
          <SourcePanel
            versions={versions}
            focusedIdx={focusedVersionIdx}
            currentChapter={currentChapter}
            onFocus={setFocusedVersionIdx}
          />
        )}
      </div>
    </div>
  );
}

// ─── 版本列组件 ───

interface VersionColumnProps {
  v: VersionState;
  idx: number;
  isFirst: boolean;
  totalVersions: number;
  hasRetrieval: boolean;
  chapter?: ChapterOption;
  isFocused: boolean;
  project: string;
  onFocus: () => void;
  onSystemChange: (val: string) => void;
  onUserChange: (val: string) => void;
  onNameChange: (val: string) => void;
  onNameEditStart: () => void;
  onNameSave: () => void;
  onRun: () => void;
  onRunAll: () => void;
  onActivate: () => void;
  onDelete: () => void;
}

function VersionColumn({
  v, idx, isFirst, totalVersions, hasRetrieval, chapter, isFocused, project, onFocus,
  onSystemChange, onUserChange, onNameChange,
  onNameEditStart, onNameSave,
  onRun, onRunAll, onActivate, onDelete,
}: VersionColumnProps) {
  const isActive = v.data.is_active === 1;
  const isRunning = v.runStatus === 'running';
  const isError = v.runStatus === 'error';
  const isDone = v.runStatus === 'done';
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [metaExpanded, setMetaExpanded] = useState(true);

  useEffect(() => {
    if (v.isEditingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [v.isEditingName]);

  // 从 project 字符串（格式如 "艾森股份_2025"）解析企业名和年份
  const lastUnderscore = project.lastIndexOf('_');
  const companyName = lastUnderscore > 0 ? project.slice(0, lastUnderscore) : project;
  const reportYear  = lastUnderscore > 0 ? project.slice(lastUnderscore + 1) : '';

  // 构建预览用变量（chapter 中已有 top_chunks，context_text 用截断版展示）
  const previewVars: Record<string, string> | undefined = chapter ? (() => {
    const contextLines: string[] = [];
    chapter.top_chunks.forEach(c => {
      contextLines.push(`[来源${c.rank} 开始] ${c.file_name} | 第${c.page_or_sheet}页 | 相关度: ${typeof c.score === 'number' ? c.score.toFixed(2) : c.score}`);
      if (c.text) contextLines.push(c.text.slice(0, 400) + (c.text.length > 400 ? '…' : ''));
      contextLines.push(`[来源${c.rank} 结束]`);
      contextLines.push('');
    });
    const sourceKeys = chapter.top_chunks.map(c => `[来源${c.rank}]`).join(', ');
    return {
      company_name:     companyName,
      report_year:      reportYear,
      full_path:        chapter.full_path        ?? '',
      leaf_title:       chapter.leaf_title        ?? '',
      gloss:            chapter.gloss             ?? '',
      retrieval_query:  chapter.retrieval_query   ?? '',
      context_text:     contextLines.join('\n'),
      available_sources: sourceKeys,
    };
  })() : undefined;

  // System Prompt 只含 company_name / report_year，单独构建（不含 context_text）
  const systemPreviewVars: Record<string, string> = {
    company_name: companyName,
    report_year:  reportYear,
  };

  const columnBorder = isError
    ? '1px solid var(--red-line)'
    : isDone
    ? '1px solid var(--green-mid)'
    : isFocused
    ? '1px solid var(--indigo)'
    : '1px solid var(--border)';

  return (
    <div
      onClick={onFocus}
      style={{
        minWidth: '340px',
        maxWidth: '460px',
        flex: '1 0 340px',
        background: 'var(--bg-card)',
        border: columnBorder,
        borderRadius: 'var(--radius)',
        boxShadow: isFocused ? 'var(--shadow)' : 'var(--shadow-sm)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
        cursor: 'default',
        transition: 'border-color 0.15s, box-shadow 0.15s',
      }}
    >
      {/* 已采用绿色顶条 */}
      {isActive && (
        <div style={{
          position: 'absolute',
          top: 0, left: 0, right: 0,
          height: '2px',
          background: 'var(--green)',
        }} />
      )}

      {/* 列头 */}
      <div style={{
        padding: '10px 12px 8px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
        marginTop: isActive ? '2px' : 0,
      }}>
        {v.isEditingName ? (
          <input
            ref={nameInputRef}
            value={v.nameDraft}
            onChange={e => onNameChange(e.target.value)}
            onBlur={onNameSave}
            onKeyDown={e => { if (e.key === 'Enter') onNameSave(); if (e.key === 'Escape') onNameSave(); }}
            style={{
              flex: 1,
              border: '1px solid var(--green)',
              borderRadius: 'var(--radius-sm)',
              padding: '2px 6px',
              fontSize: '12px',
              fontWeight: 600,
              fontFamily: 'var(--font-body)',
              background: 'var(--bg-card)',
              color: 'var(--text-1)',
              outline: 'none',
            }}
          />
        ) : (
          <button
            onClick={onNameEditStart}
            title="点击编辑版本名"
            style={{
              background: 'none', border: 'none', cursor: 'text',
              fontSize: '12px', fontWeight: 600, color: 'var(--text-1)',
              fontFamily: 'var(--font-body)', padding: '2px 4px',
              borderRadius: 'var(--radius-sm)',
              textAlign: 'left', flex: 1,
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-warm)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >
            {v.data.version_name}
          </button>
        )}
        {isActive && (
          <span style={{
            fontSize: '10px', fontWeight: 600,
            color: 'var(--green)',
            background: 'var(--green-soft)',
            border: '1px solid var(--green-mid)',
            borderRadius: 'var(--radius-sm)',
            padding: '1px 6px',
            fontFamily: 'var(--font-body)',
            whiteSpace: 'nowrap',
          }}>
            已采用
          </span>
        )}
        <span style={{ fontSize: '10px', color: 'var(--text-4)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
          #{idx + 1}
        </span>
      </div>

      {/* Prompt 编辑区 */}
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>

        {/* 章节元数据信息条 */}
        {chapter && (
          <div style={{
            borderBottom: '1px solid var(--border-light)',
            background: 'var(--bg-warm)',
            fontSize: '12px',
            fontFamily: 'var(--font-body)',
          }}>
            {/* 折叠标题行 */}
            <button
              onClick={() => setMetaExpanded(p => !p)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '6px 12px', background: 'none', border: 'none', cursor: 'pointer',
                fontSize: '10px', fontWeight: 700, letterSpacing: '0.05em',
                color: 'var(--text-3)', fontFamily: 'var(--font-head)', textTransform: 'uppercase',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            >
              <span>📋 章节信息</span>
              <ChevronDown size={12} style={{
                transform: metaExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s',
                color: 'var(--text-4)',
              }} />
            </button>

            {/* 展开内容 */}
            {metaExpanded && (
              <div style={{ padding: '0 12px 10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {/* 路径 */}
                {chapter.full_path && (
                  <div>
                    <span style={{ fontSize: '10px', color: 'var(--text-4)', fontWeight: 600 }}>路径　</span>
                    <span style={{ color: 'var(--text-2)' }}>{chapter.full_path}</span>
                  </div>
                )}
                {/* 说明 */}
                {chapter.gloss && (
                  <div>
                    <span style={{ fontSize: '10px', color: 'var(--text-4)', fontWeight: 600 }}>说明　</span>
                    <span style={{ color: 'var(--text-2)', lineHeight: 1.6 }}>{chapter.gloss}</span>
                  </div>
                )}
                {/* 检索词 */}
                {chapter.retrieval_query && (
                  <div>
                    <span style={{ fontSize: '10px', color: 'var(--text-4)', fontWeight: 600 }}>检索词</span>
                    <span style={{
                      display: 'block', marginTop: '2px',
                      color: 'var(--text-3)', fontStyle: 'italic', lineHeight: 1.6,
                    }}>{chapter.retrieval_query}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <PromptSection
          label="System Prompt"
          value={v.systemDraft}
          onChange={onSystemChange}
          rows={4}
          previewVars={systemPreviewVars}
        />
        <PromptSection
          label="User Prompt 模板"
          value={v.userDraft}
          onChange={onUserChange}
          rows={8}
          hint="支持占位符：{full_path} {leaf_title} {gloss} {retrieval_query} {context_text} {available_sources}"
          previewVars={previewVars}
        />

        {/* 操作行 */}
        <div style={{
          padding: '8px 12px',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          background: 'var(--bg-warm)',
        }}>
          <button
            onClick={onRun}
            disabled={isRunning || !hasRetrieval}
            title={!hasRetrieval ? '该章节无检索结果' : '运行此版本'}
            style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              padding: '4px 10px',
              fontSize: '12px', fontWeight: 500,
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              background: isRunning ? 'var(--indigo-soft)' : 'var(--green)',
              color: isRunning ? 'var(--indigo)' : '#fff',
              cursor: isRunning || !hasRetrieval ? 'not-allowed' : 'pointer',
              opacity: !hasRetrieval ? 0.5 : 1,
              fontFamily: 'var(--font-body)',
              transition: 'background 0.15s',
            }}
          >
            {isRunning
              ? <><Loader2 size={12} className="animate-spin" /> 运行中</>
              : <><Play size={12} /> 运行</>
            }
          </button>

          {isFirst && totalVersions > 1 && (
            <button
              onClick={onRunAll}
              title="同时运行所有版本"
              style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                padding: '4px 10px',
                fontSize: '12px', fontWeight: 500,
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)',
                background: 'var(--bg-card)',
                color: 'var(--text-2)',
                cursor: 'pointer',
                fontFamily: 'var(--font-body)',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-warm)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'var(--bg-card)')}
            >
              <RefreshCw size={12} /> 全部运行
            </button>
          )}
        </div>

        {/* 输出区 */}
        <OutputArea v={v} chunkMap={v.chunkMap} />

        {/* 底部操作 */}
        <div style={{
          padding: '8px 12px',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}>
          <button
            onClick={onActivate}
            disabled={isActive || isRunning}
            title={isActive ? '已是当前采用版本' : '采用此版本作为生产 Prompt'}
            style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              padding: '4px 10px',
              fontSize: '12px', fontWeight: 500,
              borderRadius: 'var(--radius-sm)',
              border: `1px solid ${isActive ? 'var(--green-mid)' : 'var(--border)'}`,
              background: isActive ? 'var(--green-soft)' : 'var(--bg-card)',
              color: isActive ? 'var(--green)' : 'var(--text-2)',
              cursor: isActive || isRunning ? 'not-allowed' : 'pointer',
              opacity: isRunning ? 0.5 : 1,
              fontFamily: 'var(--font-body)',
            }}
            onMouseEnter={e => { if (!isActive && !isRunning) e.currentTarget.style.background = 'var(--green-soft)'; }}
            onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'var(--bg-card)'; }}
          >
            <Check size={12} />
            {isActive ? '已采用' : '采用此版本'}
          </button>

          <button
            onClick={onDelete}
            disabled={isActive || isRunning}
            title={isActive ? '无法删除已采用的版本' : '删除此版本'}
            style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              padding: '4px 8px',
              fontSize: '12px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              background: 'var(--bg-card)',
              color: isActive ? 'var(--text-4)' : 'var(--red)',
              cursor: isActive || isRunning ? 'not-allowed' : 'pointer',
              opacity: isActive || isRunning ? 0.4 : 1,
              fontFamily: 'var(--font-body)',
            }}
            onMouseEnter={e => { if (!isActive && !isRunning) e.currentTarget.style.background = 'var(--red-soft)'; }}
            onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'var(--bg-card)'; }}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Prompt 编辑区块 ───

function PromptSection({
  label, value, onChange, rows, hint, previewVars,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows: number;
  hint?: string;
  /** 传入后显示「预览实际内容」按钮；key 为占位符名，value 为实际值 */
  previewVars?: Record<string, string>;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);

  /** 用 previewVars 替换 {key} 占位符 */
  const previewText = previewVars
    ? value.replace(/\{(\w+)\}/g, (_, k) => previewVars[k] ?? `{${k}}`)
    : value;

  return (
    <div style={{ padding: '10px 12px 6px', borderBottom: '1px solid var(--border-light)' }}>
      {/* 标签行 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: '4px',
      }}>
        <div style={{
          fontSize: '10px', fontWeight: 700, letterSpacing: '0.05em',
          color: 'var(--text-3)', fontFamily: 'var(--font-head)',
          textTransform: 'uppercase',
        }}>
          {label}
        </div>
        {previewVars && (
          <button
            onClick={() => setPreviewOpen(p => !p)}
            title={previewOpen ? '收起预览' : '预览实际内容（占位符已替换）'}
            style={{
              display: 'flex', alignItems: 'center', gap: '3px',
              background: previewOpen ? 'var(--indigo-soft)' : 'none',
              border: previewOpen ? '1px solid var(--indigo-mid, var(--border))' : '1px solid transparent',
              borderRadius: 'var(--radius-sm)',
              padding: '1px 6px',
              cursor: 'pointer',
              fontSize: '10px',
              color: previewOpen ? 'var(--indigo)' : 'var(--text-4)',
              fontFamily: 'var(--font-body)',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { if (!previewOpen) e.currentTarget.style.color = 'var(--indigo)'; }}
            onMouseLeave={e => { if (!previewOpen) e.currentTarget.style.color = 'var(--text-4)'; }}
          >
            {previewOpen ? <EyeOff size={10} /> : <Eye size={10} />}
            {previewOpen ? '收起' : '预览实际内容'}
          </button>
        )}
      </div>

      {/* 编辑框 */}
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={rows}
        style={{
          width: '100%',
          resize: 'vertical',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          padding: '6px 8px',
          fontSize: '12px',
          fontFamily: 'monospace, "Noto Sans SC", sans-serif',
          lineHeight: 1.6,
          color: 'var(--text-1)',
          background: 'var(--bg)',
          outline: 'none',
          boxSizing: 'border-box',
        }}
        onFocus={e => (e.target.style.borderColor = 'var(--green)')}
        onBlur={e => (e.target.style.borderColor = 'var(--border)')}
      />

      {/* 预览展开区 */}
      {previewOpen && (
        <div style={{
          marginTop: '6px',
          border: '1px solid var(--indigo-mid, var(--border))',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--indigo-soft, var(--bg-warm))',
          padding: '8px 10px',
        }}>
          <div style={{
            fontSize: '10px', fontWeight: 700, color: 'var(--indigo)',
            fontFamily: 'var(--font-head)', letterSpacing: '0.05em',
            textTransform: 'uppercase', marginBottom: '6px',
          }}>
            实际内容预览（只读）
          </div>
          <div style={{
            whiteSpace: 'pre-wrap',
            fontSize: '12px',
            lineHeight: 1.7,
            color: 'var(--text-2)',
            fontFamily: 'monospace, "Noto Sans SC", sans-serif',
            maxHeight: '300px',
            overflow: 'auto',
          }}>
            {previewText}
          </div>
        </div>
      )}

      {hint && (
        <div style={{ fontSize: '10px', color: 'var(--text-4)', marginTop: '3px', fontFamily: 'var(--font-body)', lineHeight: 1.4 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

// ─── 来源角标 Popover ───

function SourcePopover({
  rank,
  chunk,
  onClose,
}: {
  rank: number;
  chunk: ChapterTopChunk;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  return (
    <div ref={ref} style={{
      position: 'absolute',
      zIndex: 100,
      top: '1.4em',
      left: '-8px',
      width: '280px',
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      boxShadow: 'var(--shadow)',
      padding: '10px 12px',
      fontSize: '12px',
      fontFamily: 'var(--font-body)',
    }}>
      {/* 标题 */}
      <div style={{ fontWeight: 700, color: 'var(--text-1)', marginBottom: '6px' }}>
        来源 {rank}
      </div>
      {/* 文件名 */}
      <div style={{ color: 'var(--text-2)', marginBottom: '3px', wordBreak: 'break-all' }}>
        📄 {chunk.file_name}
      </div>
      {/* 页码 + 相关度 */}
      <div style={{ display: 'flex', gap: '12px', color: 'var(--text-3)', marginBottom: '8px' }}>
        <span>第 {chunk.page_or_sheet} 页</span>
        <span>相关度 {typeof chunk.score === 'number' ? chunk.score.toFixed(2) : chunk.score}</span>
      </div>
      {/* 原文片段 */}
      {chunk.text && (
        <div style={{
          borderTop: '1px solid var(--border-light)',
          paddingTop: '6px',
          color: 'var(--text-3)',
          fontSize: '11px',
          lineHeight: 1.7,
          maxHeight: '140px',
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
        }}>
          {chunk.text.slice(0, 300)}{chunk.text.length > 300 ? '…' : ''}
        </div>
      )}
    </div>
  );
}

// ─── 单个来源角标（含 Popover 状态） ───

function SourceTag({
  rank,
  chunkMap,
}: {
  rank: number;
  chunkMap: Record<number, ChapterTopChunk>;
}) {
  const [open, setOpen] = useState(false);
  const chunk = chunkMap[rank];

  const scrollToPanel = () => {
    const el = document.getElementById(`source-chunk-${rank}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  if (!chunk) {
    // 没有 Popover 数据，但仍然可以点击跳转到右侧面板
    return (
      <sup
        onClick={e => { e.stopPropagation(); scrollToPanel(); }}
        title={`跳转到来源 ${rank}`}
        style={{
          fontSize: '10px', color: 'var(--indigo)', cursor: 'pointer',
          fontWeight: 700, padding: '0 1px', borderRadius: '2px',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--indigo-soft)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        [{rank}]
      </sup>
    );
  }

  return (
    <span style={{ position: 'relative', display: 'inline' }}>
      <sup
        onClick={e => {
          e.stopPropagation();
          setOpen(p => !p);
          scrollToPanel();
        }}
        title={`来源 ${rank}：${chunk.file_name}`}
        style={{
          fontSize: '10px',
          color: 'var(--indigo)',
          cursor: 'pointer',
          fontWeight: 700,
          padding: '0 1px',
          borderRadius: '2px',
          background: open ? 'var(--indigo-soft)' : 'transparent',
          transition: 'background 0.1s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--indigo-soft)')}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = 'transparent'; }}
      >
        [{rank}]
      </sup>
      {open && (
        <SourcePopover rank={rank} chunk={chunk} onClose={() => setOpen(false)} />
      )}
    </span>
  );
}

// ─── 把文本中的 [来源X] / [来源X,Y,Z] 解析为角标 ───

function parseOutputWithSources(
  text: string,
  chunkMap: Record<number, ChapterTopChunk>,
): React.ReactNode[] {
  // 使用统一的来源标签正则分割文本
  const parts = text.split(SOURCE_TAG_SPLIT);
  let keyCounter = 0;
  // 创建新的 RegExp 实例以安全匹配
  const captureRe = new RegExp(SOURCE_TAG_CAPTURE.source);
  return parts.flatMap((part) => {
    const m = part.match(captureRe);
    if (m) {
      const ranks = parseSourceIds(m[1]);
      return ranks.map(rank => (
        <SourceTag key={`src-${keyCounter++}`} rank={rank} chunkMap={chunkMap} />
      ));
    }
    return [<span key={`txt-${keyCounter++}`}>{part}</span>];
  });
}

// ─── 输出区块 ───

function OutputArea({ v, chunkMap }: { v: VersionState; chunkMap: Record<number, ChapterTopChunk> }) {
  const isEmpty = !v.streamOutput && v.runStatus === 'idle';
  const isError = v.runStatus === 'error';
  const isRunning = v.runStatus === 'running';

  return (
    <div style={{
      margin: '8px 12px',
      minHeight: '120px',
      borderRadius: 'var(--radius-sm)',
      background: isError ? 'var(--red-soft)' : 'var(--bg)',
      border: `1px solid ${isError ? 'var(--red-line)' : 'var(--border)'}`,
      padding: '8px 10px',
      position: 'relative',
    }}>
      <div style={{
        fontSize: '10px', fontWeight: 700, letterSpacing: '0.05em',
        color: isError ? 'var(--red)' : 'var(--text-3)',
        fontFamily: 'var(--font-head)',
        marginBottom: '6px',
        textTransform: 'uppercase',
        display: 'flex',
        alignItems: 'center',
        gap: '5px',
      }}>
        输出结果
        {isRunning && <Loader2 size={11} className="animate-spin" style={{ color: 'var(--indigo)' }} />}
      </div>

      {isEmpty ? (
        <div style={{ color: 'var(--text-4)', fontSize: '12px', fontFamily: 'var(--font-body)', fontStyle: 'italic' }}>
          点击「运行」生成结果…
        </div>
      ) : isError ? (
        <div style={{ color: 'var(--red)', fontSize: '12px', fontFamily: 'var(--font-body)' }}>
          <strong>运行失败：</strong>{v.errorMsg}
        </div>
      ) : (
        <div style={{
          whiteSpace: 'pre-wrap',
          fontSize: '13px',
          lineHeight: 1.8,
          color: 'var(--text-1)',
          fontFamily: 'var(--font-body)',
        }}>
          {isRunning
            ? (
              <>
                {v.streamOutput}
                <span style={{
                  display: 'inline-block',
                  width: '2px',
                  height: '14px',
                  background: 'var(--indigo)',
                  marginLeft: '2px',
                  verticalAlign: 'text-bottom',
                  animation: 'blink 0.8s infinite',
                }} />
              </>
            )
            : parseOutputWithSources(v.streamOutput, chunkMap)
          }
        </div>
      )}
    </div>
  );
}

// ─── 右侧来源面板 ───

interface SourcePanelProps {
  versions: VersionState[];
  focusedIdx: number;
  currentChapter?: ChapterOption;
  onFocus: (idx: number) => void;
}

/** 从输出文本里解析被引用的 rank 集合 */
function parseCitedRanks(text: string): Set<number> {
  const cited = new Set<number>();
  // 使用统一的来源标签正则
  const re = new RegExp(SOURCE_TAG_CAPTURE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    for (const id of parseSourceIds(m[1])) {
      cited.add(id);
    }
  }
  return cited;
}

function SourcePanel({ versions, focusedIdx, currentChapter, onFocus }: SourcePanelProps) {
  const focused = versions[focusedIdx];
  const versionName = focused?.data.version_name ?? '';

  // 优先用运行后保存的 chunkMap（更完整），降级到 chapter.top_chunks（预加载版）
  const chunks: ChapterTopChunk[] = focused
    ? Object.keys(focused.chunkMap).length > 0
      ? Object.values(focused.chunkMap).sort((a, b) => a.rank - b.rank)
      : (currentChapter?.top_chunks ?? [])
    : [];

  // 解析当前版本输出中被引用的 rank
  const citedRanks = focused ? parseCitedRanks(focused.streamOutput) : new Set<number>();
  const hasCitations = citedRanks.size > 0;

  return (
    <div style={{
      width: '264px',
      flexShrink: 0,
      borderLeft: '1px solid var(--border)',
      background: 'var(--bg-card)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* 面板标题 */}
      <div style={{
        padding: '10px 14px 8px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'baseline',
        gap: '6px',
        flexShrink: 0,
      }}>
        <span style={{
          fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em',
          color: 'var(--text-3)', fontFamily: 'var(--font-head)', textTransform: 'uppercase',
        }}>
          资料来源
        </span>
        {versionName && (
          <span style={{
            fontSize: '10px', color: 'var(--indigo)',
            fontFamily: 'var(--font-body)',
            background: 'var(--indigo-soft)',
            padding: '0px 5px',
            borderRadius: 'var(--radius-sm)',
          }}>
            {versionName}
          </span>
        )}
      </div>

      {/* 版本切换 Tab（多版本时显示） */}
      {versions.length > 1 && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: '4px',
          padding: '6px 10px',
          borderBottom: '1px solid var(--border-light)',
          flexShrink: 0,
        }}>
          {versions.map((v, idx) => (
            <button
              key={v.data.id}
              onClick={() => onFocus(idx)}
              style={{
                fontSize: '10px',
                padding: '2px 7px',
                borderRadius: 'var(--radius-sm)',
                border: `1px solid ${idx === focusedIdx ? 'var(--indigo)' : 'var(--border)'}`,
                background: idx === focusedIdx ? 'var(--indigo-soft)' : 'transparent',
                color: idx === focusedIdx ? 'var(--indigo)' : 'var(--text-3)',
                cursor: 'pointer',
                fontFamily: 'var(--font-body)',
              }}
            >
              {v.data.version_name}
            </button>
          ))}
        </div>
      )}

      {/* Chunk 列表 */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
        {chunks.length === 0 ? (
          <div style={{
            padding: '20px 14px',
            color: 'var(--text-4)', fontSize: '12px',
            fontFamily: 'var(--font-body)', fontStyle: 'italic', textAlign: 'center',
          }}>
            运行后显示来源
          </div>
        ) : (
          chunks.map(chunk => {
            const isCited = citedRanks.has(chunk.rank);
            // 仅在有引用结果时才区分引用/未引用；运行前全部不标记
            const showCitedBadge = hasCitations;
            return (
              <div
                key={chunk.rank}
                id={`source-chunk-${chunk.rank}`}
                style={{
                  padding: '8px 14px',
                  borderBottom: '1px solid var(--border-light)',
                  background: isCited ? 'var(--green-soft)' : 'transparent',
                  borderLeft: isCited ? '3px solid var(--green)' : '3px solid transparent',
                  transition: 'background 0.2s',
                }}
              >
                {/* 来源编号 + 引用状态 + 相关度 */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  marginBottom: '4px',
                }}>
                  <span style={{
                    fontSize: '11px', fontWeight: 700,
                    color: isCited ? 'var(--green)' : 'var(--indigo)',
                    fontFamily: 'var(--font-body)',
                  }}>
                    来源 {chunk.rank}
                  </span>
                  {showCitedBadge && (
                    <span style={{
                      fontSize: '9px', fontWeight: 600,
                      color: isCited ? 'var(--green)' : 'var(--text-4)',
                      background: isCited ? 'var(--green-soft)' : 'var(--bg-warm)',
                      border: `1px solid ${isCited ? 'var(--green-mid)' : 'var(--border)'}`,
                      borderRadius: 'var(--radius-sm)',
                      padding: '0 4px',
                      fontFamily: 'var(--font-body)',
                    }}>
                      {isCited ? '已引用' : '未引用'}
                    </span>
                  )}
                  <span style={{
                    fontSize: '10px', color: 'var(--text-4)',
                    fontFamily: 'monospace', marginLeft: 'auto',
                  }}>
                    {typeof chunk.score === 'number' ? chunk.score.toFixed(2) : chunk.score}
                  </span>
                </div>
                {/* 文件名 + 页码 */}
                <div style={{
                  fontSize: '11px', color: 'var(--text-2)',
                  fontFamily: 'var(--font-body)',
                  marginBottom: '5px',
                  wordBreak: 'break-all',
                  lineHeight: 1.4,
                }}>
                  📄 {chunk.file_name}
                  {chunk.page_or_sheet != null && String(chunk.page_or_sheet) !== '' && (
                    <span style={{ color: 'var(--text-4)', marginLeft: '4px' }}>
                      第 {chunk.page_or_sheet} 页
                    </span>
                  )}
                </div>
                {/* 原文片段 */}
                {chunk.text && (
                  <div style={{
                    fontSize: '11px', color: 'var(--text-3)',
                    fontFamily: 'var(--font-body)',
                    lineHeight: 1.6,
                    whiteSpace: 'pre-wrap',
                    maxHeight: '120px',
                    overflow: 'auto',
                    background: 'var(--bg)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '5px 7px',
                    border: '1px solid var(--border-light)',
                  }}>
                    {chunk.text.length > 300 ? chunk.text.slice(0, 300) + '…' : chunk.text}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── 空态 ───

function EmptyState({ message }: { message: string }) {
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--text-4)',
      fontSize: '13px',
      fontFamily: 'var(--font-body)',
    }}>
      {message}
    </div>
  );
}

// ─── 光标闪烁动画 ───
const blinkStyle = `
  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }
`;

// ─── 页面导出 ───

export default function PlaygroundPage() {
  return (
    <>
      <style>{blinkStyle}</style>
      <Suspense fallback={
        <div style={{
          height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--bg)',
        }}>
          <Loader2 size={32} className="animate-spin" style={{ color: 'var(--text-4)' }} />
        </div>
      }>
        <PlaygroundInner />
      </Suspense>
    </>
  );
}
