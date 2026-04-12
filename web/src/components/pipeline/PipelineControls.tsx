'use client';

import { useState } from 'react';
import { Play, XCircle, Loader2, Settings2 } from 'lucide-react';
import { PIPELINE_STEPS, StepName, RebuildLevel } from '@/lib/pipeline-types';
import { usePipelineStore } from '@/lib/pipeline-store';

export default function PipelineControls({ project }: { project?: string }) {
  const { activeRun, isStarting, startRun, cancelRun } = usePipelineStore();

  const [selectedSteps, setSelectedSteps] = useState<Set<StepName>>(
    new Set(PIPELINE_STEPS.map((s) => s.name))
  );
  const [showConfig, setShowConfig] = useState(false);
  const [resume, setResume] = useState(false);
  const [debug, setDebug] = useState(false);
  const [limit, setLimit] = useState<number | null>(null);
  const [rebuild, setRebuild] = useState<RebuildLevel | ''>('');
  const [retryFailed, setRetryFailed] = useState(false);

  const isRunning = activeRun?.run.status === 'running';

  const toggleStep = (name: StepName) => {
    setSelectedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      // 若不再是"单独勾选 Step 2"，重置 retryFailed
      const onlyRQ = next.size === 1 && next.has('generate_retrieval_queries');
      if (!onlyRQ) setRetryFailed(false);
      return next;
    });
  };

  const handleStart = async () => {
    const steps = PIPELINE_STEPS.filter((s) => selectedSteps.has(s.name)).map((s) => s.name);
    if (steps.length === 0) return;
    try {
      await startRun({
        steps, project,
        config: {
          resume: resume || undefined,
          debug: debug || undefined,
          limit: limit || undefined,
          rebuild: rebuild || undefined,
          retryFailed: retryFailed || undefined,
        },
      });
    } catch { /* error already in store */ }
  };

  const handleCancel = () => {
    if (activeRun) cancelRun(activeRun.run.id);
  };

  const inputStyle: React.CSSProperties = {
    padding: '5px 8px',
    fontSize: '12px',
    fontFamily: 'var(--font-body)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--bg-card)',
    color: 'var(--text-1)',
    outline: 'none',
  };

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      boxShadow: 'var(--shadow-sm)',
      padding: '14px 16px',
    }}>
      {/* 标题行 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <h2 style={{
          fontFamily: 'var(--font-head)',
          fontSize: '12px', fontWeight: 700,
          color: 'var(--text-2)',
          letterSpacing: '0.04em',
          margin: 0,
        }}>
          Pipeline 控制
        </h2>
        <button
          onClick={() => setShowConfig(!showConfig)}
          title="高级选项"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: showConfig ? 'var(--indigo)' : 'var(--text-4)',
            display: 'flex', alignItems: 'center',
            transition: 'color 0.15s',
            padding: '2px',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--indigo)')}
          onMouseLeave={e => { if (!showConfig) e.currentTarget.style.color = 'var(--text-4)'; }}
        >
          <Settings2 size={15} />
        </button>
      </div>

      {/* Step 勾选项 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
        {PIPELINE_STEPS.map((step) => {
          const checked = selectedSteps.has(step.name);
          return (
            <div key={step.name}>
              <label
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '7px 10px',
                  borderRadius: 'var(--radius-sm)',
                  border: `1px solid ${checked ? 'var(--green-mid)' : 'var(--border)'}`,
                  background: checked ? 'var(--green-soft)' : 'transparent',
                  cursor: isRunning ? 'not-allowed' : 'pointer',
                  opacity: isRunning ? 0.6 : 1,
                  transition: 'background 0.15s, border-color 0.15s',
                  fontFamily: 'var(--font-body)',
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleStep(step.name)}
                  disabled={isRunning}
                  style={{ accentColor: 'var(--green)', flexShrink: 0 }}
                />
                <span style={{ flex: 1, fontSize: '12px', fontWeight: 500, color: checked ? 'var(--green)' : 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {step.label}
                </span>
                <span style={{ fontSize: '11px', color: 'var(--text-4)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  ~{step.estimatedMinutes}min
                </span>
              </label>

              {/* 仅补跑失败节点（仅当只选中了 Step 2 时显示） */}
              {step.name === 'generate_retrieval_queries' && selectedSteps.has('generate_retrieval_queries') && selectedSteps.size === 1 && (
                <div style={{ marginLeft: '32px', marginTop: '5px' }}>
                  <label style={{
                    display: 'flex', alignItems: 'flex-start', gap: '7px',
                    fontSize: '11px', color: 'var(--text-2)',
                    cursor: isRunning ? 'not-allowed' : 'pointer',
                    fontFamily: 'var(--font-body)',
                    lineHeight: 1.5,
                  }}>
                    <input
                      type="checkbox"
                      checked={retryFailed}
                      onChange={(e) => setRetryFailed(e.target.checked)}
                      disabled={isRunning}
                      style={{ accentColor: 'var(--amber)', flexShrink: 0, marginTop: '2px' }}
                    />
                    <span>
                      <span style={{ fontWeight: 500 }}>仅补跑失败节点</span>
                      <span style={{ color: 'var(--text-4)' }}>（读取已有结果，只重新生成状态为「失败」的节点）</span>
                    </span>
                  </label>
                </div>
              )}

              {/* Rebuild 选项 */}
              {step.name === 'align_evidence' && selectedSteps.has('align_evidence') && (
                <div style={{ marginLeft: '32px', marginTop: '5px', marginBottom: '2px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: 'var(--text-3)' }}>
                    <span style={{ whiteSpace: 'nowrap', fontFamily: 'var(--font-body)' }}>缓存重建:</span>
                    <select
                      value={rebuild}
                      onChange={(e) => setRebuild(e.target.value as RebuildLevel | '')}
                      disabled={isRunning}
                      style={{ ...inputStyle, fontSize: '11px', cursor: isRunning ? 'not-allowed' : 'pointer', opacity: isRunning ? 0.5 : 1 }}
                    >
                      <option value="">复用已有缓存</option>
                      <option value="embedding">embedding — 重算向量</option>
                      <option value="chunk">chunk — 重新分块 → 向量</option>
                      <option value="extract">extract — 重新提取 → 分块 → 向量</option>
                      <option value="all">all — 全部重建</option>
                    </select>
                  </div>
                  {rebuild && (
                    <div style={{
                      marginTop: '5px', fontSize: '11px', color: 'var(--amber)',
                      background: 'var(--amber-soft)', border: '1px solid var(--amber-border)',
                      padding: '5px 8px', borderRadius: 'var(--radius-sm)',
                      fontFamily: 'var(--font-body)', lineHeight: 1.5,
                    }}>
                      {rebuild === 'embedding' && '删除 embedding 缓存 → 重算向量 + ChromaDB'}
                      {rebuild === 'chunk' && '删除分块缓存 → 重新分块 → 重算向量 + ChromaDB'}
                      {(rebuild === 'extract' || rebuild === 'all') && '删除所有缓存 → 重新提取 → 分块 → 向量 + ChromaDB（耗时最长）'}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 高级选项（折叠） */}
      {showConfig && (
        <div style={{
          marginBottom: '12px',
          padding: '10px 12px',
          background: 'var(--bg-warm)',
          border: '1px solid var(--border-light)',
          borderRadius: 'var(--radius-sm)',
          display: 'flex', flexDirection: 'column', gap: '8px',
        }}>
          {[
            { label: '断点续跑 (--resume)', checked: resume, onChange: setResume },
            { label: '调试模式 (--debug)', checked: debug, onChange: setDebug },
          ].map(({ label, checked, onChange }) => (
            <label key={label} style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12px', color: 'var(--text-2)', cursor: isRunning ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-body)' }}>
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                disabled={isRunning}
                style={{ accentColor: 'var(--indigo)' }}
              />
              {label}
            </label>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-2)', fontFamily: 'var(--font-body)' }}>
            <span>限制章节:</span>
            <input
              type="number"
              value={limit ?? ''}
              onChange={(e) => setLimit(e.target.value ? parseInt(e.target.value, 10) : null)}
              disabled={isRunning}
              placeholder="全部"
              min={1} max={119}
              style={{ ...inputStyle, width: '72px' }}
            />
          </div>
        </div>
      )}

      {/* 操作按钮 */}
      {!isRunning ? (
        <button
          onClick={handleStart}
          disabled={isStarting || selectedSteps.size === 0}
          style={{
            width: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
            padding: '8px 16px',
            fontSize: '12px', fontWeight: 500,
            fontFamily: 'var(--font-body)',
            borderRadius: 'var(--radius)',
            border: 'none',
            background: isStarting || selectedSteps.size === 0 ? 'var(--bg-warm)' : 'var(--indigo)',
            color: isStarting || selectedSteps.size === 0 ? 'var(--text-4)' : '#fff',
            cursor: isStarting || selectedSteps.size === 0 ? 'not-allowed' : 'pointer',
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => { if (!isStarting && selectedSteps.size > 0) (e.currentTarget as HTMLButtonElement).style.background = 'var(--indigo-hover)'; }}
          onMouseLeave={e => { if (!isStarting && selectedSteps.size > 0) (e.currentTarget as HTMLButtonElement).style.background = 'var(--indigo)'; }}
        >
          {isStarting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          {isStarting ? '启动中…' : '运行 Pipeline'}
        </button>
      ) : (
        <button
          onClick={handleCancel}
          style={{
            width: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
            padding: '8px 16px',
            fontSize: '12px', fontWeight: 500,
            fontFamily: 'var(--font-body)',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--red-line)',
            background: 'var(--red-soft)',
            color: 'var(--red)',
            cursor: 'pointer',
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--red-soft-hover)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'var(--red-soft)')}
        >
          <XCircle size={14} />
          取消运行
        </button>
      )}
    </div>
  );
}
