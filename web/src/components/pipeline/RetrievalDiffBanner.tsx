'use client';

import { useState, useRef } from 'react';
import { Loader2, RefreshCw, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import type { RetrievalDiffResult } from '@/lib/pipeline-store';

interface Props {
  diff: RetrievalDiffResult;
  project?: string;
  /** 已有编辑记录的章节 ID 集合（从 Editor store 获取） */
  editedChapterIds?: Set<string>;
}

/**
 * 检索结果差异摘要横幅。
 * 在 Pipeline 完成且存在 retrieval_results_prev.json 快照时展示，
 * 提示用户哪些章节的 Top-10 资料来源发生了变化，并提供批量重生成入口。
 */
export default function RetrievalDiffBanner({ diff, project, editedChapterIds = new Set() }: Props) {
  const { changed, added, hasPrev } = diff;
  const allChangedIds = [...changed, ...added];
  const totalChanged = allChangedIds.length;

  // 有变化的章节中，哪些有编辑记录
  const editedInChanged = allChangedIds.filter(id => editedChapterIds.has(id));
  const uneditedInChanged = allChangedIds.filter(id => !editedChapterIds.has(id));

  const [isExpanded, setIsExpanded] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenProgress, setRegenProgress] = useState<{ done: number; total: number } | null>(null);
  const [showAllConfirm, setShowAllConfirm] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const abortRef = useRef(false);

  if (dismissed || !hasPrev || totalChanged === 0) return null;

  const runBatchRegen = async (ids: string[]) => {
    if (ids.length === 0) return;
    abortRef.current = false;
    setIsRegenerating(true);
    setRegenProgress({ done: 0, total: ids.length });

    // 并发 3 个
    const CONCURRENCY = 3;
    let idx = 0;
    let done = 0;

    const worker = async () => {
      while (idx < ids.length) {
        if (abortRef.current) break;
        const id = ids[idx++];
        try {
          await fetch(`/api/chapters/${encodeURIComponent(id)}/regenerate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ project }),
          });
        } catch {
          // 单章节失败不中断整体
        }
        done++;
        setRegenProgress({ done, total: ids.length });
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker)
    );

    setIsRegenerating(false);
    setRegenProgress(null);
    if (!abortRef.current) {
      setDismissed(true);
    }
  };

  const handleRegenUnedited = () => runBatchRegen(uneditedInChanged);
  const handleRegenAll = () => {
    if (editedInChanged.length > 0) {
      setShowAllConfirm(true);
    } else {
      runBatchRegen(allChangedIds);
    }
  };

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--blue-mid)',
      borderRadius: 'var(--radius)',
      boxShadow: 'var(--shadow-sm)',
      padding: '12px 16px',
      fontFamily: 'var(--font-body)',
    }}>
      {/* 标题行 */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
            <RefreshCw size={13} style={{ color: 'var(--blue)', flexShrink: 0 }} />
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-1)' }}>
              混合检索结果已更新
            </span>
          </div>
          <p style={{ fontSize: '11px', color: 'var(--text-3)', margin: 0, lineHeight: 1.6 }}>
            <strong style={{ color: 'var(--text-2)' }}>{totalChanged} 个</strong>章节的资料来源有变化
            {editedInChanged.length > 0 && (
              <>，其中 <strong style={{ color: 'var(--amber)' }}>{editedInChanged.length} 个</strong>包含已编辑内容</>
            )}
          </p>
        </div>
        <button
          onClick={() => setDismissed(true)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-4)', padding: '2px', lineHeight: 1, fontSize: '16px', flexShrink: 0 }}
          title="关闭"
        >
          ×
        </button>
      </div>

      {/* 进度条（重生成中） */}
      {isRegenerating && regenProgress && (
        <div style={{ marginTop: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-3)', marginBottom: '4px' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Loader2 size={11} className="animate-spin" />
              正在重新生成…
            </span>
            <span>{regenProgress.done} / {regenProgress.total}</span>
          </div>
          <div style={{ height: '4px', background: 'var(--border-light)', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${(regenProgress.done / regenProgress.total) * 100}%`,
              background: 'var(--blue)',
              borderRadius: '2px',
              transition: 'width 0.3s',
            }} />
          </div>
        </div>
      )}

      {/* 操作按钮 */}
      {!isRegenerating && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '10px', flexWrap: 'wrap' }}>
          {uneditedInChanged.length > 0 && (
            <button
              onClick={handleRegenUnedited}
              style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                padding: '5px 10px', fontSize: '11px', fontWeight: 500,
                background: 'var(--blue)', color: '#fff',
                border: 'none', borderRadius: 'var(--radius-sm)',
                cursor: 'pointer', transition: 'background 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--indigo)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'var(--blue)')}
            >
              <RefreshCw size={11} />
              仅重生成无编辑的章节（{uneditedInChanged.length} 个）
            </button>
          )}
          <button
            onClick={handleRegenAll}
            style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              padding: '5px 10px', fontSize: '11px', fontWeight: 500,
              background: editedInChanged.length > 0 ? 'var(--amber-soft)' : 'var(--blue)',
              color: editedInChanged.length > 0 ? 'var(--amber)' : '#fff',
              border: editedInChanged.length > 0 ? '1px solid var(--amber-border)' : 'none',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer', transition: 'background 0.15s',
            }}
          >
            全部重生成（{totalChanged} 个）
          </button>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            style={{
              display: 'flex', alignItems: 'center', gap: '3px',
              padding: '5px 8px', fontSize: '11px',
              background: 'none', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)', cursor: 'pointer', color: 'var(--text-3)',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-warm)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >
            查看详情
            {isExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
        </div>
      )}

      {/* 详情展开 */}
      {isExpanded && (
        <div style={{
          marginTop: '10px',
          padding: '8px 10px',
          background: 'var(--bg-warm)',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border-light)',
        }}>
          {editedInChanged.length > 0 && (
            <div style={{ marginBottom: '8px' }}>
              <p style={{ fontSize: '11px', fontWeight: 500, color: 'var(--amber)', margin: '0 0 4px' }}>
                已编辑章节（{editedInChanged.length} 个）
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {editedInChanged.map(id => (
                  <span key={id} style={{
                    fontSize: '10px', padding: '1px 6px',
                    background: 'var(--amber-soft)', color: 'var(--amber)',
                    border: '1px solid var(--amber-border)',
                    borderRadius: 'var(--radius-sm)', fontFamily: 'monospace',
                  }}>{id}</span>
                ))}
              </div>
            </div>
          )}
          {uneditedInChanged.length > 0 && (
            <div>
              <p style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-2)', margin: '0 0 4px' }}>
                待重生成章节（{uneditedInChanged.length} 个）
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {uneditedInChanged.map(id => (
                  <span key={id} style={{
                    fontSize: '10px', padding: '1px 6px',
                    background: 'var(--blue-soft)', color: 'var(--blue)',
                    border: '1px solid var(--blue-mid)',
                    borderRadius: 'var(--radius-sm)', fontFamily: 'monospace',
                  }}>{id}</span>
                ))}
              </div>
            </div>
          )}
          {added.length > 0 && (
            <div style={{ marginTop: '8px' }}>
              <p style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-2)', margin: '0 0 4px' }}>
                新增章节（{added.length} 个，快照中没有）
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {added.map(id => (
                  <span key={id} style={{
                    fontSize: '10px', padding: '1px 6px',
                    background: 'var(--green-soft)', color: 'var(--green)',
                    border: '1px solid var(--green-mid)',
                    borderRadius: 'var(--radius-sm)', fontFamily: 'monospace',
                  }}>{id}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 全量重生成确认 Dialog */}
      {showAllConfirm && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', zIndex: 100 }}
            onClick={() => setShowAllConfirm(false)}
          />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            width: '400px', background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow-md)',
            zIndex: 101, padding: '20px 24px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <AlertTriangle size={16} style={{ color: 'var(--amber)', flexShrink: 0 }} />
              <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: 'var(--text-1)', fontFamily: 'var(--font-body)' }}>
                全部重新生成
              </h3>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-2)', margin: '0 0 8px', lineHeight: 1.7, fontFamily: 'var(--font-body)' }}>
              以下 <strong>{editedInChanged.length} 个</strong>章节包含用户编辑内容，重新生成后 AI 初稿将被更新。
              原有编辑已保存在版本历史中，可随时回滚。
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '16px' }}>
              {editedInChanged.map(id => (
                <span key={id} style={{
                  fontSize: '11px', padding: '2px 7px',
                  background: 'var(--amber-soft)', color: 'var(--amber)',
                  border: '1px solid var(--amber-border)',
                  borderRadius: 'var(--radius-sm)', fontFamily: 'monospace',
                }}>{id}</span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowAllConfirm(false)}
                style={{
                  padding: '6px 14px', fontSize: '12px',
                  background: 'var(--bg-warm)', color: 'var(--text-2)',
                  border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer', fontFamily: 'var(--font-body)',
                }}
              >
                取消
              </button>
              <button
                onClick={() => { setShowAllConfirm(false); runBatchRegen(allChangedIds); }}
                style={{
                  padding: '6px 14px', fontSize: '12px', fontWeight: 500,
                  background: 'var(--amber)', color: '#fff',
                  border: 'none', borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer', fontFamily: 'var(--font-body)',
                }}
              >
                确认全部重生成
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
