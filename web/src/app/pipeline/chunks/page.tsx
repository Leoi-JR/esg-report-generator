'use client';

import { Suspense, useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { Search, ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react';

interface ChunkItem {
  chunk_id: string;
  parent_id: string;
  file_name: string;
  folder_code: string;
  page_or_sheet: string;
  section_title: string;
  text: string;
  char_count: string | number;
  is_table?: boolean;
}

interface ChunksResponse {
  items: ChunkItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  folderCodes: string[];
}

const PREVIEW_LEN = 120;

function ChunksPageInner() {
  const searchParams = useSearchParams();
  const project = searchParams.get('project') || '';
  const [data, setData] = useState<ChunksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [folderCode, setFolderCode] = useState('');
  const [isTable, setIsTable] = useState<string>('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: '50' });
    if (project) params.set('project', project);
    if (search) params.set('search', search);
    if (folderCode) params.set('folder_code', folderCode);
    if (isTable) params.set('is_table', isTable);

    try {
      const res = await fetch(`/api/pipeline/data/chunks?${params}`);
      const json = await res.json();
      setData(json);
    } catch {
      // ignore
    }
    setLoading(false);
  }, [page, search, folderCode, isTable, project]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const [searchInput, setSearchInput] = useState('');
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── shared inline style helpers ──────────────────────────────
  const inputStyle: React.CSSProperties = {
    padding: '7px 10px',
    fontSize: '12px',
    fontFamily: 'var(--font-body)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--bg-card)',
    color: 'var(--text-1)',
    outline: 'none',
  };

  const thStyle: React.CSSProperties = {
    padding: '8px 14px',
    textAlign: 'left',
    fontSize: '11px',
    fontWeight: 600,
    color: 'var(--text-3)',
    letterSpacing: '0.04em',
    fontFamily: 'var(--font-head)',
    whiteSpace: 'nowrap',
    borderBottom: '1px solid var(--border)',
    background: 'var(--bg-warm)',
  };

  return (
    <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '20px 24px' }}>

      {/* ── 筛选栏 ────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', alignItems: 'center' }}>
        {/* 搜索框 */}
        <div style={{ position: 'relative', flex: 1 }}>
          <Search
            size={13}
            style={{
              position: 'absolute', left: '9px', top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-4)', pointerEvents: 'none',
            }}
          />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="搜索分块内容、文件名或 chunk_id…"
            style={{ ...inputStyle, width: '100%', paddingLeft: '28px', boxSizing: 'border-box' }}
            onFocus={e => (e.currentTarget.style.borderColor = 'var(--indigo)')}
            onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
          />
        </div>

        {/* 编码筛选 */}
        <select
          value={folderCode}
          onChange={(e) => { setFolderCode(e.target.value); setPage(1); }}
          style={{ ...inputStyle, cursor: 'pointer' }}
        >
          <option value="">全部文件夹</option>
          {data?.folderCodes.map((code) => (
            <option key={code} value={code}>{code}</option>
          ))}
        </select>

        {/* 类型筛选 */}
        <select
          value={isTable}
          onChange={(e) => { setIsTable(e.target.value); setPage(1); }}
          style={{ ...inputStyle, cursor: 'pointer' }}
        >
          <option value="">全部类型</option>
          <option value="true">仅表格</option>
          <option value="false">仅文本</option>
        </select>

        {/* 统计 */}
        {data && (
          <span style={{ fontSize: '11px', color: 'var(--text-4)', whiteSpace: 'nowrap', fontFamily: 'var(--font-body)' }}>
            共 {data.total.toLocaleString()} 条
          </span>
        )}
      </div>

      {/* ── 主体 ──────────────────────────────────────────────── */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-4)', fontSize: '12px', fontFamily: 'var(--font-body)' }}>
          加载中…
        </div>
      ) : !data || data.items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-4)', fontSize: '12px', fontFamily: 'var(--font-body)' }}>
          无匹配结果
        </div>
      ) : (
        <>
          {/* ── 表格 ── */}
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            overflow: 'hidden',
            boxShadow: 'var(--shadow-sm)',
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', fontFamily: 'var(--font-body)' }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, width: '80px' }}>文件夹</th>
                  <th style={{ ...thStyle, width: '180px' }}>文件名</th>
                  <th style={{ ...thStyle }}>内容预览</th>
                  <th style={{ ...thStyle, width: '60px', textAlign: 'right' }}>字数</th>
                  <th style={{ ...thStyle, width: '80px', textAlign: 'center' }}>类型</th>
                  <th style={{ ...thStyle, width: '52px', textAlign: 'center' }}>展开</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((chunk) => {
                  const isExpanded = expandedIds.has(chunk.chunk_id);
                  const needsExpand = chunk.text.length > PREVIEW_LEN;
                  const previewText = needsExpand
                    ? chunk.text.slice(0, PREVIEW_LEN) + '…'
                    : chunk.text;
                  const isTableChunk = chunk.is_table ||
                    String(chunk.chunk_id).includes('_t') ||
                    chunk.section_title?.includes('表');

                  return (
                    <>
                      {/* ── 主行 ── */}
                      <tr
                        key={chunk.chunk_id}
                        style={{
                          borderBottom: '1px solid var(--border-light)',
                          cursor: needsExpand ? 'pointer' : 'default',
                          transition: 'background 0.15s',
                        }}
                        onClick={() => needsExpand && toggleExpand(chunk.chunk_id)}
                        onMouseEnter={e => { (e.currentTarget as HTMLTableRowElement).style.background = 'var(--bg-warm)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background = 'transparent'; }}
                      >
                        {/* 文件夹 */}
                        <td style={{ padding: '9px 14px', verticalAlign: 'top' }}>
                          <span style={{
                            display: 'inline-block',
                            fontSize: '11px', fontWeight: 600,
                            padding: '2px 7px',
                            background: 'var(--indigo-soft)', color: 'var(--indigo)',
                            border: '1px solid var(--indigo-line)',
                            borderRadius: 'var(--radius-sm)',
                          }}>
                            {chunk.folder_code}
                          </span>
                        </td>

                        {/* 文件名 */}
                        <td style={{ padding: '9px 14px', verticalAlign: 'top' }}>
                          <div style={{ fontSize: '11px', color: 'var(--text-2)', lineHeight: 1.6 }} title={chunk.file_name}>
                            {chunk.file_name}
                          </div>
                          {chunk.page_or_sheet && (
                            <div style={{ fontSize: '10px', color: 'var(--text-4)', marginTop: '2px' }}>
                              第 {chunk.page_or_sheet} 页
                            </div>
                          )}
                        </td>

                        {/* 内容预览 */}
                        <td style={{ padding: '9px 14px', verticalAlign: 'top', lineHeight: 1.7, color: 'var(--text-2)' }}>
                          {previewText}
                        </td>

                        {/* 字数 */}
                        <td style={{ padding: '9px 14px', textAlign: 'right', verticalAlign: 'top', fontSize: '11px', color: 'var(--text-4)', whiteSpace: 'nowrap' }}>
                          {Number(chunk.char_count).toLocaleString()}
                        </td>

                        {/* 类型 */}
                        <td style={{ padding: '9px 14px', textAlign: 'center', verticalAlign: 'top' }}>
                          {isTableChunk ? (
                            <span style={{
                              fontSize: '10px', fontWeight: 500,
                              padding: '2px 7px',
                              background: 'var(--blue-soft)', color: 'var(--blue)',
                              border: '1px solid var(--blue-mid)',
                              borderRadius: 'var(--radius-sm)',
                              whiteSpace: 'nowrap',
                            }}>表格</span>
                          ) : (
                            <span style={{
                              fontSize: '10px', fontWeight: 500,
                              padding: '2px 7px',
                              background: 'var(--bg-warm)', color: 'var(--text-3)',
                              border: '1px solid var(--border)',
                              borderRadius: 'var(--radius-sm)',
                              whiteSpace: 'nowrap',
                            }}>文本</span>
                          )}
                        </td>

                        {/* 展开按钮 */}
                        <td style={{ padding: '9px 14px', textAlign: 'center', verticalAlign: 'top' }}>
                          {needsExpand ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleExpand(chunk.chunk_id); }}
                              style={{
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                width: '22px', height: '22px',
                                background: isExpanded ? 'var(--indigo-soft)' : 'transparent',
                                border: '1px solid ' + (isExpanded ? 'var(--indigo-line)' : 'var(--border)'),
                                borderRadius: 'var(--radius-sm)',
                                color: isExpanded ? 'var(--indigo)' : 'var(--text-3)',
                                cursor: 'pointer',
                                transition: 'background 0.2s, color 0.2s, border-color 0.2s',
                              }}
                              onMouseEnter={e => {
                                (e.currentTarget as HTMLButtonElement).style.background = 'var(--indigo-soft)';
                                (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--indigo-line)';
                                (e.currentTarget as HTMLButtonElement).style.color = 'var(--indigo)';
                              }}
                              onMouseLeave={e => {
                                if (!isExpanded) {
                                  (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                                  (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
                                  (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-3)';
                                }
                              }}
                              title={isExpanded ? '收起' : '展开完整内容'}
                            >
                              <ChevronDown
                                size={12}
                                style={{
                                  transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                                  transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                                }}
                              />
                            </button>
                          ) : (
                            <span style={{ display: 'inline-block', width: '22px' }} />
                          )}
                        </td>
                      </tr>

                      {/* ── 展开行（始终在 DOM，用 max-height 动画） ── */}
                      <tr
                        key={chunk.chunk_id + '_expanded'}
                        style={{ borderBottom: isExpanded ? '1px solid var(--border-light)' : 'none' }}
                      >
                        <td colSpan={6} style={{ padding: 0 }}>
                          <div style={{
                            overflow: 'hidden',
                            maxHeight: isExpanded ? '2000px' : '0px',
                            opacity: isExpanded ? 1 : 0,
                            transition: isExpanded
                              ? 'max-height 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease'
                              : 'max-height 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.15s ease',
                          }}>
                            <div style={{
                              margin: '0 14px 12px',
                              background: 'var(--bg-warm)',
                              border: '1px solid var(--border-light)',
                              borderLeft: '3px solid var(--indigo)',
                              borderRadius: 'var(--radius-sm)',
                              padding: '12px 14px',
                            }}>
                              {chunk.section_title && (
                                <div style={{
                                  fontSize: '11px', fontWeight: 600,
                                  color: 'var(--text-3)',
                                  marginBottom: '8px',
                                  fontFamily: 'var(--font-head)',
                                }}>
                                  {chunk.section_title}
                                </div>
                              )}
                              <p style={{
                                fontSize: '12px',
                                color: 'var(--text-2)',
                                lineHeight: 1.85,
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-all',
                                margin: 0,
                                fontFamily: 'var(--font-body)',
                              }}>
                                {chunk.text}
                              </p>
                              <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'flex-end' }}>
                                <button
                                  onClick={() => toggleExpand(chunk.chunk_id)}
                                  style={{
                                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                                    fontSize: '11px', color: 'var(--indigo)',
                                    background: 'none', border: 'none',
                                    cursor: 'pointer', fontFamily: 'var(--font-body)',
                                    padding: '2px 0',
                                    opacity: 0.8,
                                    transition: 'opacity 0.15s',
                                  }}
                                  onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                                  onMouseLeave={e => (e.currentTarget.style.opacity = '0.8')}
                                >
                                  <ChevronUp size={11} />
                                  收起
                                </button>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    </>
                  );
                })}
              </tbody>
            </table>

            {/* ── 分页 footer ── */}
            <div style={{
              padding: '9px 14px',
              borderTop: '1px solid var(--border-light)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: 'var(--bg-warm)',
            }}>
              <span style={{ fontSize: '11px', color: 'var(--text-4)', fontFamily: 'var(--font-body)' }}>
                共 {data.total.toLocaleString()} 条 · 第 {page} / {data.totalPages} 页
              </span>
              <div style={{ display: 'flex', gap: '3px' }}>
                <button
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page <= 1}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '3px',
                    padding: '4px 10px', fontSize: '11px',
                    fontFamily: 'var(--font-body)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-card)',
                    color: 'var(--text-3)',
                    cursor: page <= 1 ? 'not-allowed' : 'pointer',
                    opacity: page <= 1 ? 0.4 : 1,
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => { if (page > 1) (e.currentTarget as HTMLButtonElement).style.background = 'var(--border-light)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-card)'; }}
                >
                  <ChevronLeft size={12} />
                  上一页
                </button>
                <button
                  onClick={() => setPage(Math.min(data.totalPages, page + 1))}
                  disabled={page >= data.totalPages}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '3px',
                    padding: '4px 10px', fontSize: '11px',
                    fontFamily: 'var(--font-body)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-card)',
                    color: 'var(--text-3)',
                    cursor: page >= data.totalPages ? 'not-allowed' : 'pointer',
                    opacity: page >= data.totalPages ? 0.4 : 1,
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => { if (page < data.totalPages) (e.currentTarget as HTMLButtonElement).style.background = 'var(--border-light)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-card)'; }}
                >
                  下一页
                  <ChevronRight size={12} />
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function ChunksPage() {
  return (
    <Suspense fallback={
      <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '48px 24px', textAlign: 'center', color: 'var(--text-4)', fontSize: '12px', fontFamily: 'var(--font-body)' }}>
        加载中…
      </div>
    }>
      <ChunksPageInner />
    </Suspense>
  );
}
