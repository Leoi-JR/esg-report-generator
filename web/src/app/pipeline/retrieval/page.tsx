'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { ChevronDown } from 'lucide-react';

interface TopChunkItem {
  rank: number;
  score: number;
  score_rq: number;
  score_hyde: number;
  score_bm25: number;
  source: string;
  chunk_id: string;
  file_name: string;
  folder_code: string;
  text: string;
  biencoder_rank: number | null;
  score_biencoder: number | null;
}

interface RetrievalSummary {
  id: string;
  full_path: string;
  leaf_title: string;
  gloss: string;
  retrieval_query: string;
  chunk_count: number;
  max_score: number;
  avg_score: number;
  source_files: string[];
  top_chunks: TopChunkItem[];
}

// source 标签配色：统一使用 CSS 变量色系
const SOURCE_STYLE: Record<string, { bg: string; color: string; border: string; label: string }> = {
  multi:            { bg: 'var(--indigo-soft)', color: 'var(--indigo)',  border: 'var(--indigo-line)',   label: 'multi' },
  retrieval_query:  { bg: 'var(--blue-soft)',   color: 'var(--blue)',    border: 'var(--blue-mid)',   label: 'RQ' },
  hypothetical_doc: { bg: 'var(--green-soft)',  color: 'var(--green)',   border: 'var(--green-mid)',  label: 'HyDE' },
  bm25:             { bg: 'var(--amber-soft)',  color: 'var(--amber)',   border: 'var(--amber-border)',  label: 'BM25' },
};

function RetrievalPageInner() {
  const searchParams = useSearchParams();
  const project = searchParams.get('project') || '';
  const [items, setItems] = useState<RetrievalSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const qs = project ? `?project=${encodeURIComponent(project)}` : '';
    fetch(`/api/pipeline/data/retrieval${qs}`)
      .then((r) => r.json())
      .then((data) => {
        setItems(data.items ?? []);
        if (data.items?.length > 0) setSelectedId(data.items[0].id);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [project]);

  const selectedItem = items.find((it) => it.id === selectedId);

  if (loading) {
    return (
      <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '48px 24px', textAlign: 'center', color: 'var(--text-4)', fontSize: '12px', fontFamily: 'var(--font-body)' }}>
        加载中…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '48px 24px', textAlign: 'center', color: 'var(--text-4)', fontSize: '12px', fontFamily: 'var(--font-body)' }}>
        暂无检索结果数据。请先运行混合检索精排。
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '20px 24px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '14px', minHeight: '70vh' }}>

        {/* ── 左栏：章节列表 ── */}
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          boxShadow: 'var(--shadow-sm)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}>
          <div style={{
            padding: '8px 12px',
            background: 'var(--bg-warm)',
            borderBottom: '1px solid var(--border)',
            fontSize: '11px',
            fontWeight: 600,
            color: 'var(--text-3)',
            fontFamily: 'var(--font-head)',
            letterSpacing: '0.04em',
            flexShrink: 0,
          }}>
            检索章节 · {items.length} 个
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {items.map((item, idx) => (
              <button
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '9px 12px',
                  background: selectedId === item.id ? 'var(--indigo-soft)' : 'transparent',
                  borderBottom: idx < items.length - 1 ? '1px solid var(--border-light)' : 'none',
                  borderLeft: selectedId === item.id ? '2px solid var(--indigo)' : '2px solid transparent',
                  cursor: 'pointer',
                  transition: 'background 0.15s, border-color 0.15s',
                  fontFamily: 'var(--font-body)',
                }}
                onMouseEnter={e => {
                  if (selectedId !== item.id) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-warm)';
                }}
                onMouseLeave={e => {
                  if (selectedId !== item.id) (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' }}>
                  <span style={{
                    fontSize: '11px', fontWeight: 600,
                    padding: '1px 6px',
                    background: 'var(--indigo-soft)', color: 'var(--indigo)',
                    border: '1px solid var(--indigo-line)',
                    borderRadius: 'var(--radius-sm)',
                  }}>
                    {item.id}
                  </span>
                  <ScoreBadge score={item.max_score} />
                </div>
                <div style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-1)', marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.leaf_title}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.chunk_count} chunks · avg {item.avg_score.toFixed(3)}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ── 右栏：选中章节详情 ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {selectedItem ? (
            <>
              {/* 章节信息卡 */}
              <div style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                boxShadow: 'var(--shadow-sm)',
                padding: '14px 16px',
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <div>
                    <h3 style={{ fontFamily: 'var(--font-head)', fontSize: '14px', fontWeight: 700, color: 'var(--text-1)', margin: '0 0 3px' }}>
                      {selectedItem.leaf_title}
                    </h3>
                    <p style={{ fontSize: '11px', color: 'var(--text-4)', fontFamily: 'monospace', margin: 0 }}>
                      {selectedItem.full_path}
                    </p>
                  </div>
                  <ScoreBadge score={selectedItem.max_score} size="lg" />
                </div>
                {selectedItem.gloss && (
                  <p style={{ fontSize: '12px', color: 'var(--text-3)', margin: '6px 0 8px', fontFamily: 'var(--font-body)', lineHeight: 1.6 }}>
                    {selectedItem.gloss}
                  </p>
                )}
                <div style={{
                  padding: '9px 12px',
                  background: 'var(--bg-warm)',
                  border: '1px solid var(--border-light)',
                  borderLeft: '3px solid var(--indigo)',
                  borderRadius: 'var(--radius-sm)',
                }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-3)', marginBottom: '4px', fontFamily: 'var(--font-head)' }}>
                    检索查询
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--text-2)', margin: 0, fontFamily: 'var(--font-body)', lineHeight: 1.65 }}>
                    {selectedItem.retrieval_query}
                  </p>
                </div>
              </div>

              {/* Top-K Chunks */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {selectedItem.top_chunks.map((chunk) => (
                  <ChunkCard key={chunk.chunk_id} chunk={chunk} maxScore={selectedItem.max_score} />
                ))}
              </div>
            </>
          ) : (
            <div style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '48px 24px',
              textAlign: 'center',
              color: 'var(--text-4)',
              fontSize: '12px',
              fontFamily: 'var(--font-body)',
            }}>
              选择左侧章节查看检索结果
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function RetrievalPage() {
  return (
    <Suspense fallback={
      <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '48px 24px', textAlign: 'center', color: 'var(--text-4)', fontSize: '12px', fontFamily: 'var(--font-body)' }}>
        加载中…
      </div>
    }>
      <RetrievalPageInner />
    </Suspense>
  );
}

function ChunkCard({ chunk, maxScore }: { chunk: TopChunkItem; maxScore: number }) {
  const [expanded, setExpanded] = useState(false);
  const barMax = Math.max(maxScore, 0.01);
  const sourceStyle = SOURCE_STYLE[chunk.source] ?? SOURCE_STYLE['multi'];

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      boxShadow: 'var(--shadow-sm)',
      padding: '12px 14px',
      fontFamily: 'var(--font-body)',
    }}>
      {/* 头部 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {/* rank 数字 — 方形徽章 */}
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: '20px', height: '20px',
            background: 'var(--indigo-soft)', color: 'var(--indigo)',
            border: '1px solid var(--indigo-line)',
            borderRadius: 'var(--radius-sm)',
            fontSize: '11px', fontWeight: 700,
          }}>
            {chunk.rank}
          </span>
          {/* chunk id */}
          <span style={{ fontSize: '11px', color: 'var(--text-4)', fontFamily: 'monospace', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {chunk.chunk_id.split('#').slice(-2).join('#')}
          </span>
          {/* source 标签 */}
          <span style={{
            fontSize: '10px', fontWeight: 500,
            padding: '1px 6px',
            background: sourceStyle.bg,
            color: sourceStyle.color,
            border: `1px solid ${sourceStyle.border}`,
            borderRadius: 'var(--radius-sm)',
            whiteSpace: 'nowrap',
          }}>
            {sourceStyle.label}
          </span>
        </div>
        {/* 综合得分 */}
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-1)', fontFamily: 'monospace' }}>
          {chunk.score.toFixed(4)}
        </span>
      </div>

      {/* 文件名 + 文件夹 */}
      <div style={{ fontSize: '11px', color: 'var(--text-3)', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{
          fontSize: '10px', fontWeight: 600,
          padding: '1px 5px',
          background: 'var(--indigo-soft)', color: 'var(--indigo)',
          border: '1px solid var(--indigo-line)',
          borderRadius: 'var(--radius-sm)',
        }}>
          {chunk.folder_code}
        </span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {chunk.file_name}
        </span>
      </div>

      {/* 三路分数条 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '10px' }}>
        <ScoreBar label="RQ"   value={chunk.score_rq}   max={barMax} color="var(--indigo)" />
        <ScoreBar label="HyDE" value={chunk.score_hyde} max={barMax} color="var(--green)" />
        <ScoreBar label="BM25" value={chunk.score_bm25} max={barMax} color="var(--amber-line)" />
      </div>

      {/* 文本预览 */}
      <div
        style={{ fontSize: '12px', color: 'var(--text-2)', whiteSpace: 'pre-wrap', lineHeight: 1.7, cursor: chunk.text.length > 150 ? 'pointer' : 'default' }}
        onClick={() => chunk.text.length > 150 && setExpanded(!expanded)}
      >
        {expanded ? chunk.text : chunk.text.slice(0, 150) + (chunk.text.length > 150 ? '…' : '')}
      </div>
      {chunk.text.length > 150 && (
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '3px',
            marginTop: '4px', fontSize: '11px',
            color: 'var(--indigo)', background: 'none', border: 'none',
            cursor: 'pointer', fontFamily: 'var(--font-body)', padding: 0,
            opacity: 0.8, transition: 'opacity 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '0.8')}
        >
          <ChevronDown
            size={11}
            style={{
              transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          />
          {expanded ? '收起' : '展开'}
        </button>
      )}
    </div>
  );
}

function ScoreBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-3)', marginBottom: '3px', fontFamily: 'var(--font-body)' }}>
        <span style={{ fontWeight: 500 }}>{label}</span>
        <span style={{ color: 'var(--text-4)', fontFamily: 'monospace' }}>{value.toFixed(3)}</span>
      </div>
      <div style={{ height: '4px', background: 'var(--border)', borderRadius: '99px', overflow: 'hidden' }}>
        <div style={{ height: '100%', borderRadius: '99px', background: color, width: `${pct}%`, transition: 'width 0.3s ease' }} />
      </div>
    </div>
  );
}

function ScoreBadge({ score, size = 'sm' }: { score: number; size?: 'sm' | 'lg' }) {
  const style =
    score >= 0.3
      ? { bg: 'var(--green-soft)',  color: 'var(--green)',  border: 'var(--green-mid)' }
      : score >= 0.15
      ? { bg: 'var(--amber-soft)',  color: 'var(--amber)',  border: 'var(--amber-border)' }
      : { bg: 'var(--red-soft)',    color: 'var(--red)',    border: 'var(--red-line)' };

  return (
    <span style={{
      display: 'inline-block',
      padding: size === 'lg' ? '3px 9px' : '1px 6px',
      fontSize: size === 'lg' ? '12px' : '11px',
      fontWeight: 500,
      background: style.bg,
      color: style.color,
      border: `1px solid ${style.border}`,
      borderRadius: 'var(--radius-sm)',   /* 3px 矩形，非 Pill */
      fontFamily: 'var(--font-body)',
      fontVariantNumeric: 'tabular-nums',
    }}>
      {score.toFixed(3)}
    </span>
  );
}
