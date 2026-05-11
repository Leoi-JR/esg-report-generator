'use client';

import { useState, useEffect, useRef } from 'react';
import { CheckCircle2, Circle, Loader2, XCircle, Ban, Clock, RotateCcw, SkipForward, X, Copy, Check } from 'lucide-react';
import { PIPELINE_STEPS } from '@/lib/pipeline-types';
import type { StepRun, ProgressFileData } from '@/lib/pipeline-types';
import { usePipelineStore } from '@/lib/pipeline-store';

interface Props {
  stepRuns: StepRun[];
  progress: ProgressFileData | null;
  project?: string;
}

// 每种状态对应的 CSS 变量配色 + 图标
const statusConfig = {
  pending:   { icon: Circle,        color: 'var(--border)',      bg: 'transparent',          border: 'var(--border-light)', label: '等待中' },
  running:   { icon: Loader2,       color: 'var(--indigo)',      bg: 'var(--indigo-soft)',    border: 'var(--indigo-line)',  label: '运行中' },
  completed: { icon: CheckCircle2,  color: 'var(--green)',       bg: 'var(--green-soft)',     border: 'var(--green-mid)',    label: '已完成' },
  failed:    { icon: XCircle,       color: 'var(--red)',         bg: 'var(--red-soft)',       border: 'var(--red-line)',     label: '失败'   },
  cancelled: { icon: Ban,           color: 'var(--amber)',       bg: 'var(--amber-soft)',     border: 'var(--amber-border)', label: '已取消' },
  skipped:   { icon: Circle,        color: 'var(--text-4)',      bg: 'transparent',          border: 'var(--border-light)', label: '跳过'   },
} as const;

// 部分失败的配色（amber 系，复用 cancelled 配色）
const partialConfig = {
  icon: CheckCircle2,
  color: 'var(--amber)',
  bg: 'var(--amber-soft)',
  border: 'var(--amber-border)',
};

const DEBUG_UI = process.env.NEXT_PUBLIC_PIPELINE_DEBUG_UI === 'true';

export default function StepTimeline({ stepRuns, progress, project }: Props) {
  const { startRun, isStarting, activeRun, skipFailed } = usePipelineStore();
  const [retryingStep, setRetryingStep] = useState<string | null>(null);
  const [showSkipDialog, setShowSkipDialog] = useState(false);
  const [skipConfirming, setSkipConfirming] = useState(false);
  const [copied, setCopied] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  if (!stepRuns || stepRuns.length === 0) return null;

  const runStatus = activeRun?.run.status;
  const isRunning = runStatus === 'running';

  // ── 倒计时（waiting_retry 状态下）──
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (runStatus !== 'waiting_retry') {
      setCountdown(null);
      if (countdownRef.current) clearInterval(countdownRef.current);
      return;
    }
    const retryCount = activeRun?.run.retry_count ?? 1;
    const waitSec = retryCount <= 1 ? 60 : 90;
    setCountdown(waitSec);
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev === null || prev <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runStatus, activeRun?.run.retry_count]);

  const handleRetryFailed = async (stepName: string) => {
    setRetryingStep(stepName);
    try {
      await startRun({
        steps: [stepName as 'generate_retrieval_queries'],
        project,
        config: { retryFailed: true },
      });
    } catch {
      // error already in store
    } finally {
      setRetryingStep(null);
    }
  };

  const handleSkipConfirm = async () => {
    if (!activeRun) return;
    setSkipConfirming(true);
    await skipFailed(activeRun.run.id);
    setSkipConfirming(false);
    setShowSkipDialog(false);
  };

  const handleCopyIds = () => {
    const ids = progress?.partial_failed_ids ?? [];
    if (ids.length === 0) return;
    navigator.clipboard.writeText(ids.join('\n')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // 失败节点 ID（用于 Dialog 展示）
  const failedIds = progress?.partial_failed_ids ?? [];

  return (
    <>
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        boxShadow: 'var(--shadow-sm)',
        padding: '14px 16px',
      }}>
        <h2 style={{
          fontFamily: 'var(--font-head)',
          fontSize: '12px', fontWeight: 700,
          color: 'var(--text-2)',
          letterSpacing: '0.04em',
          margin: '0 0 12px',
        }}>
          执行步骤
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {stepRuns.map((step, idx) => {
            const stepDef = PIPELINE_STEPS.find((s) => s.name === step.step_name);
            const cfg = statusConfig[step.status as keyof typeof statusConfig] ?? statusConfig.pending;
            const isActive = step.status === 'running';

            // 是否是"部分完成"状态：generate_retrieval_queries 且 exit_code=1，或 skipped 且有 warning
            const isPartial =
              step.step_name === 'generate_retrieval_queries' &&
              (step.exit_code === 1 || (step.status === 'skipped' && !!step.warning));

            // 有效配色：部分失败时覆盖为 amber
            const effectiveCfg = isPartial
              ? {
                  ...partialConfig,
                  label: step.status === 'skipped' ? '已跳过' : '待确认',
                  border: partialConfig.border,
                }
              : cfg;
            const Icon = isPartial ? partialConfig.icon : cfg.icon;

            const stages = stepDef?.stages ?? [];
            const completedStages = isActive ? (progress?.stages_completed ?? []) : [];
            const currentStage = isActive ? progress?.stage : null;

            // waiting_retry / waiting_user 下这个 step 是否是等待中的那个
            const isWaitingStep = isPartial && (runStatus === 'waiting_retry' || runStatus === 'waiting_user');

            return (
              <div key={step.step_name}>
                {/* 连接线 */}
                {idx > 0 && (
                  <div style={{
                    marginLeft: '17px',
                    height: '8px',
                    width: '1px',
                    background: 'var(--border)',
                  }} />
                )}

                {/* 步骤卡片 */}
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: '10px',
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-sm)',
                  border: `1px solid ${effectiveCfg.border}`,
                  background: effectiveCfg.bg,
                  transition: 'background 0.15s',
                }}>
                  <Icon
                    size={18}
                    style={{
                      color: effectiveCfg.color,
                      flexShrink: 0,
                      marginTop: '1px',
                    }}
                    className={isActive ? 'animate-spin' : ''}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-body)' }}>
                        {stepDef?.label ?? step.step_name}
                      </span>
                      <span style={{ fontSize: '11px', fontWeight: 500, color: effectiveCfg.color, whiteSpace: 'nowrap', fontFamily: 'var(--font-body)' }}>
                        {effectiveCfg.label}
                      </span>
                    </div>

                    {/* 阶段进度：调试模式显示文字标签，默认显示胶囊 */}
                    {stages.length > 0 && (isActive || step.status === 'completed') && (
                      DEBUG_UI ? (
                        /* 文字标签模式 */
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
                          {stages.map((stage) => {
                            const isDone = (step.status === 'completed' && !isPartial) || completedStages.includes(stage);
                            const isCurrent = stage === currentStage;
                            return (
                              <span
                                key={stage}
                                style={{
                                  display: 'inline-flex', alignItems: 'center', gap: '3px',
                                  padding: '1px 7px',
                                  fontSize: '10px',
                                  borderRadius: '99px',
                                  fontFamily: 'var(--font-body)',
                                  fontWeight: isCurrent ? 600 : 400,
                                  background: isDone
                                    ? 'var(--green-soft)'
                                    : isCurrent
                                    ? 'var(--indigo-soft)'
                                    : 'var(--bg-warm)',
                                  color: isDone
                                    ? 'var(--green)'
                                    : isCurrent
                                    ? 'var(--indigo)'
                                    : 'var(--text-4)',
                                  border: `1px solid ${isDone ? 'var(--green-mid)' : isCurrent ? 'var(--indigo-line)' : 'var(--border-light)'}`,
                                }}
                                className={isCurrent ? 'animate-pulse' : ''}
                              >
                                {isCurrent && <Loader2 size={9} className="animate-spin" />}
                                {stage}
                              </span>
                            );
                          })}
                        </div>
                      ) : (
                        /* 胶囊模式（默认） */
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
                          {stages.map((stage) => {
                            const isDone = (step.status === 'completed' && !isPartial) || completedStages.includes(stage);
                            const isCurrent = stage === currentStage;
                            return (
                              <span
                                key={stage}
                                title={stage}
                                style={{
                                  display: 'inline-block',
                                  width: '24px', height: '4px',
                                  borderRadius: '99px',
                                  background: isDone
                                    ? 'var(--green)'
                                    : isCurrent
                                    ? 'var(--indigo)'
                                    : 'var(--border)',
                                  ...(isCurrent ? { opacity: 0.7 } : {}),
                                }}
                                className={isCurrent ? 'animate-pulse' : ''}
                              />
                            );
                          })}
                        </div>
                      )
                    )}

                    {/* 耗时 */}
                    {step.started_at && step.completed_at && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px', fontSize: '11px', color: 'var(--text-4)', fontFamily: 'var(--font-body)' }}>
                        <Clock size={11} />
                        <span>{formatDuration(new Date(step.completed_at).getTime() - new Date(step.started_at).getTime())}</span>
                      </div>
                    )}

                    {/* 错误（仅非 partial 步骤显示红色 error） */}
                    {step.error && !isPartial && (
                      <div style={{
                        marginTop: '5px', fontSize: '11px', color: 'var(--red)',
                        background: 'var(--red-soft)', padding: '4px 8px',
                        borderRadius: 'var(--radius-sm)', fontFamily: 'monospace',
                        maxHeight: '80px', overflowY: 'auto',
                      }}>
                        {step.error}
                      </div>
                    )}

                    {/* Warning 块（部分失败时） */}
                    {step.warning && (
                      <div style={{
                        marginTop: '5px',
                        padding: '5px 8px',
                        background: 'var(--amber-soft)',
                        border: '1px solid var(--amber-border)',
                        borderLeft: '3px solid var(--amber-line)',
                        borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
                        fontSize: '11px', color: 'var(--amber)',
                        fontFamily: 'var(--font-body)', lineHeight: 1.5,
                      }}>
                        {step.warning}
                        {step.status === 'skipped' && '，已跳过这些节点继续生成。'}
                      </div>
                    )}

                    {/* waiting_retry：倒计时提示 */}
                    {isWaitingStep && runStatus === 'waiting_retry' && (
                      <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--text-4)', fontFamily: 'var(--font-body)' }}>
                        {countdown !== null && countdown > 0
                          ? `将在 ${countdown} 秒后自动重试…`
                          : '正在准备重试…'
                        }
                      </div>
                    )}

                    {/* waiting_user：手动操作区 */}
                    {isWaitingStep && runStatus === 'waiting_user' && (
                      <div style={{ marginTop: '8px' }}>
                        <div style={{
                          marginBottom: '8px',
                          padding: '6px 10px',
                          background: 'var(--amber-soft)',
                          border: '1px solid var(--amber-border)',
                          borderLeft: '3px solid var(--amber-line)',
                          borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
                          fontSize: '11px', color: 'var(--amber)',
                          fontFamily: 'var(--font-body)', lineHeight: 1.6,
                        }}>
                          多次尝试后仍有少量内容未能完成，可能是服务暂时繁忙或内容较复杂。
                          不影响其余章节正常生成。
                        </div>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          {/* 再次尝试 */}
                          <button
                            onClick={() => handleRetryFailed(step.step_name)}
                            disabled={retryingStep === step.step_name || isStarting}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: '5px',
                              padding: '5px 10px',
                              fontSize: '11px', fontWeight: 500,
                              fontFamily: 'var(--font-body)',
                              borderRadius: 'var(--radius-sm)',
                              border: '1px solid var(--amber-border)',
                              background: 'var(--bg-card)',
                              color: 'var(--amber)',
                              cursor: retryingStep === step.step_name || isStarting ? 'not-allowed' : 'pointer',
                              opacity: retryingStep === step.step_name || isStarting ? 0.6 : 1,
                              transition: 'background 0.15s',
                            }}
                            onMouseEnter={e => {
                              if (retryingStep !== step.step_name && !isStarting)
                                (e.currentTarget as HTMLButtonElement).style.background = 'var(--amber-soft)';
                            }}
                            onMouseLeave={e => {
                              if (retryingStep !== step.step_name && !isStarting)
                                (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-card)';
                            }}
                          >
                            {retryingStep === step.step_name
                              ? <Loader2 size={12} className="animate-spin" />
                              : <RotateCcw size={12} />
                            }
                            {retryingStep === step.step_name ? '重试中…' : '再次尝试'}
                          </button>
                          {/* 跳过 */}
                          <button
                            onClick={() => setShowSkipDialog(true)}
                            disabled={retryingStep === step.step_name || isStarting}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: '5px',
                              padding: '5px 10px',
                              fontSize: '11px', fontWeight: 500,
                              fontFamily: 'var(--font-body)',
                              borderRadius: 'var(--radius-sm)',
                              border: '1px solid var(--border)',
                              background: 'var(--bg-card)',
                              color: 'var(--text-3)',
                              cursor: retryingStep === step.step_name || isStarting ? 'not-allowed' : 'pointer',
                              opacity: retryingStep === step.step_name || isStarting ? 0.6 : 1,
                              transition: 'background 0.15s',
                            }}
                            onMouseEnter={e => {
                              if (retryingStep !== step.step_name && !isStarting)
                                (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-warm)';
                            }}
                            onMouseLeave={e => {
                              if (retryingStep !== step.step_name && !isStarting)
                                (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-card)';
                            }}
                          >
                            <SkipForward size={12} />
                            跳过这几条，继续生成
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 跳过确认 Dialog */}
      {showSkipDialog && (
        <div
          style={{
            position: 'fixed', inset: 0,
            background: 'var(--overlay)',
            zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={() => setShowSkipDialog(false)}
        >
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              boxShadow: 'var(--shadow-lg)',
              padding: '20px 22px',
              width: '420px',
              maxWidth: 'calc(100vw - 32px)',
              maxHeight: '80vh',
              overflowY: 'auto',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* 标题行 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <h3 style={{ fontFamily: 'var(--font-head)', fontSize: '13px', fontWeight: 700, color: 'var(--text-1)', margin: 0 }}>
                确认跳过？
              </h3>
              <button
                onClick={() => setShowSkipDialog(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-4)', padding: '2px', display: 'flex', alignItems: 'center' }}
              >
                <X size={14} />
              </button>
            </div>

            {/* 说明文字 */}
            <p style={{ fontSize: '12px', color: 'var(--text-2)', lineHeight: 1.75, fontFamily: 'var(--font-body)', margin: '0 0 12px' }}>
              以下节点的查询生成多次尝试后仍未完成，跳过后这些章节<strong>不会出现在初稿中</strong>。
              初稿完成后，可在控制面板中单独勾选「检索查询生成」并开启「仅补跑失败节点」选项重新生成。
            </p>

            {/* 失败节点 ID */}
            {failedIds.length > 0 && (
              <div style={{
                background: 'var(--bg-warm)',
                border: '1px solid var(--border-light)',
                borderRadius: 'var(--radius-sm)',
                padding: '8px 10px',
                marginBottom: '10px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-3)', fontFamily: 'var(--font-body)' }}>
                    涉及节点（{failedIds.length} 个）
                  </span>
                  <button
                    onClick={handleCopyIds}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '3px',
                      fontSize: '11px', color: copied ? 'var(--green)' : 'var(--indigo)',
                      cursor: 'pointer', border: 'none', background: 'none',
                      fontFamily: 'var(--font-body)',
                      transition: 'color 0.15s',
                    }}
                  >
                    {copied ? <Check size={11} /> : <Copy size={11} />}
                    {copied ? '已复制' : '复制全部'}
                  </button>
                </div>
                <div style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--text-2)', wordBreak: 'break-all', lineHeight: 1.6 }}>
                  {failedIds.join('、')}
                </div>
              </div>
            )}

            {/* 提示小字 */}
            <p style={{ fontSize: '11px', color: 'var(--text-4)', fontFamily: 'var(--font-body)', lineHeight: 1.6, margin: '0 0 16px' }}>
              💡 可复制以上节点 ID，结合文件大小、内容复杂度等情况排查原因。
            </p>

            {/* 按钮行 */}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowSkipDialog(false)}
                style={{
                  padding: '6px 14px',
                  fontSize: '12px', fontWeight: 500,
                  fontFamily: 'var(--font-body)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-card)',
                  color: 'var(--text-3)',
                  cursor: 'pointer',
                }}
              >
                取消
              </button>
              <button
                onClick={handleSkipConfirm}
                disabled={skipConfirming}
                style={{
                  padding: '6px 14px',
                  fontSize: '12px', fontWeight: 500,
                  fontFamily: 'var(--font-body)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--green-mid)',
                  background: skipConfirming ? 'var(--green-soft)' : 'var(--green)',
                  color: skipConfirming ? 'var(--green)' : '#fff',
                  cursor: skipConfirming ? 'not-allowed' : 'pointer',
                  opacity: skipConfirming ? 0.7 : 1,
                  transition: 'background 0.15s',
                }}
              >
                {skipConfirming ? '处理中…' : '确认跳过，继续生成'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m < 60) return `${m}m ${sec}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
