'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { ChevronDown, FileText, Search } from 'lucide-react';

interface Section {
  section_id: string;
  page_or_sheet: string;
  text: string;
  section_title: string;
}

interface FileGroup {
  file_path: string;
  section_count: number;
  sections: Section[];
}

interface SectionsResponse {
  groups: FileGroup[];
  totalFiles: number;
  totalSections: number;
}

function SectionsPageInner() {
  const searchParams = useSearchParams();
  const project = searchParams.get('project') || '';
  const [data, setData] = useState<SectionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [searchInput, setSearchInput] = useState('');

  useEffect(() => {
    const qs = project ? `?project=${encodeURIComponent(project)}` : '';
    fetch(`/api/pipeline/data/sections${qs}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [project]);

  const toggleFile = (filePath: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  };

  const filteredGroups = data?.groups.filter((g) => {
    if (!searchInput) return true;
    const q = searchInput.toLowerCase();
    return (
      g.file_path.toLowerCase().includes(q) ||
      g.sections.some(
        (s) =>
          s.text.toLowerCase().includes(q) ||
          s.section_title.toLowerCase().includes(q)
      )
    );
  });

  if (loading) {
    return (
      <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '48px 24px', textAlign: 'center', color: 'var(--text-4)', fontSize: '12px', fontFamily: 'var(--font-body)' }}>
        加载中…
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '20px 24px' }}>

      {/* ── 搜索栏 + 统计 ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
        <div style={{ position: 'relative', flex: '0 0 320px' }}>
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
            placeholder="搜索文件名或段落内容…"
            style={{
              width: '100%',
              padding: '7px 10px 7px 28px',
              fontSize: '12px',
              fontFamily: 'var(--font-body)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-card)',
              color: 'var(--text-1)',
              outline: 'none',
              boxSizing: 'border-box',
            }}
            onFocus={e => (e.currentTarget.style.borderColor = 'var(--indigo)')}
            onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
          />
        </div>
        {data && (
          <span style={{ fontSize: '11px', color: 'var(--text-4)', fontFamily: 'var(--font-body)', whiteSpace: 'nowrap' }}>
            {data.totalFiles} 个文件 · {data.totalSections.toLocaleString()} 个段落
          </span>
        )}
      </div>

      {/* ── 手风琴列表 ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {filteredGroups?.map((group) => {
          const isExpanded = expandedFiles.has(group.file_path);
          const fileName = group.file_path.split('/').pop() || group.file_path;
          const pathParts = group.file_path.split('/');
          // 提取最后一级文件夹作为 ESG 编码提示（如 EA1）
          const folderCode = pathParts.length >= 2 ? pathParts[pathParts.length - 2] : '';

          return (
            <div
              key={group.file_path}
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                boxShadow: 'var(--shadow-sm)',
                overflow: 'hidden',
              }}
            >
              {/* ── 文件头（手风琴触发器） ── */}
              <button
                onClick={() => toggleFile(group.file_path)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 14px',
                  background: isExpanded ? 'var(--bg-warm)' : 'transparent',
                  border: 'none',
                  borderBottom: isExpanded ? '1px solid var(--border-light)' : 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background 0.15s',
                  fontFamily: 'var(--font-body)',
                }}
                onMouseEnter={e => {
                  if (!isExpanded) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-warm)';
                }}
                onMouseLeave={e => {
                  if (!isExpanded) (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                }}
              >
                {/* 展开箭头（旋转动画） */}
                <ChevronDown
                  size={14}
                  style={{
                    color: 'var(--text-4)',
                    flexShrink: 0,
                    transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                    transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                  }}
                />

                {/* 文件图标 */}
                <FileText size={14} style={{ color: 'var(--indigo)', flexShrink: 0 }} />

                {/* 文件名 + 路径提示 */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: '12px', fontWeight: 600,
                    color: 'var(--text-1)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    fontFamily: 'var(--font-body)',
                  }}>
                    {fileName}
                  </div>
                  {folderCode && (
                    <div style={{ fontSize: '11px', color: 'var(--text-4)', marginTop: '1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {pathParts.slice(0, -1).join(' / ')}
                    </div>
                  )}
                </div>

                {/* 编码标签 */}
                {folderCode && (
                  <span style={{
                    fontSize: '10px', fontWeight: 600,
                    padding: '1px 6px',
                    background: 'var(--indigo-soft)', color: 'var(--indigo)',
                    border: '1px solid var(--indigo-line)',
                    borderRadius: 'var(--radius-sm)',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}>
                    {folderCode}
                  </span>
                )}

                {/* 段落数量 */}
                <span style={{
                  fontSize: '11px', color: 'var(--text-4)',
                  whiteSpace: 'nowrap', flexShrink: 0,
                  fontFamily: 'var(--font-body)',
                }}>
                  {group.section_count} 段落
                </span>
              </button>

              {/* ── 段落列表（max-height 动画展开） ── */}
              <div style={{
                overflow: 'hidden',
                maxHeight: isExpanded ? `${group.sections.length * 300}px` : '0px',
                opacity: isExpanded ? 1 : 0,
                transition: isExpanded
                  ? 'max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease'
                  : 'max-height 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.15s ease',
              }}>
                {group.sections.map((section, idx) => (
                  <div
                    key={section.section_id || idx}
                    style={{
                      padding: '10px 14px 10px 36px',
                      borderBottom: idx < group.sections.length - 1 ? '1px solid var(--border-light)' : 'none',
                      transition: 'background 0.12s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-warm)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    {/* 段落元信息行 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '5px' }}>
                      {/* 序号 */}
                      <span style={{
                        fontSize: '10px', fontWeight: 600,
                        padding: '1px 5px',
                        background: 'var(--bg-warm)', color: 'var(--text-4)',
                        border: '1px solid var(--border-light)',
                        borderRadius: 'var(--radius-sm)',
                        fontFamily: 'monospace',
                        flexShrink: 0,
                      }}>
                        #{idx + 1}
                      </span>

                      {/* 段落标题 */}
                      {section.section_title && (
                        <span style={{
                          fontSize: '11px', fontWeight: 600,
                          color: 'var(--indigo)',
                          fontFamily: 'var(--font-head)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {section.section_title}
                        </span>
                      )}

                      {/* 页码 */}
                      {section.page_or_sheet && (
                        <span style={{
                          fontSize: '10px', color: 'var(--text-4)',
                          fontFamily: 'var(--font-body)',
                          whiteSpace: 'nowrap',
                          flexShrink: 0,
                        }}>
                          p.{section.page_or_sheet}
                        </span>
                      )}
                    </div>

                    {/* 段落正文 */}
                    <p style={{
                      fontSize: '12px',
                      color: 'var(--text-2)',
                      whiteSpace: 'pre-wrap',
                      lineHeight: 1.75,
                      margin: 0,
                      fontFamily: 'var(--font-body)',
                      wordBreak: 'break-all',
                    }}>
                      {section.text}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {filteredGroups?.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-4)', fontSize: '12px', fontFamily: 'var(--font-body)' }}>
          无匹配结果
        </div>
      )}
    </div>
  );
}

export default function SectionsPage() {
  return (
    <Suspense fallback={
      <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '48px 24px', textAlign: 'center', color: 'var(--text-4)', fontSize: '12px', fontFamily: 'var(--font-body)' }}>
        加载中…
      </div>
    }>
      <SectionsPageInner />
    </Suspense>
  );
}
