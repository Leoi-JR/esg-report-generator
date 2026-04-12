'use client';

import { useState, useCallback } from 'react';
import { X, Plus, Loader2 } from 'lucide-react';

interface CreateProjectModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export function CreateProjectModal({ open, onClose, onCreated }: CreateProjectModalProps) {
  const [companyName, setCompanyName] = useState('');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: companyName.trim(),
          year: year.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? '创建失败');
        return;
      }

      // 成功 — 重置表单并通知父组件
      setCompanyName('');
      setYear(String(new Date().getFullYear()));
      onCreated();
      onClose();
    } catch {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  }, [companyName, year, onClose, onCreated]);

  if (!open) return null;

  const projectId =
    companyName.trim() && year.trim()
      ? `${companyName.trim()}_${year.trim()}`
      : '';

  const canSubmit = !loading && !!companyName.trim() && !!year.trim();

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '7px 10px',
    fontSize: '13px',
    fontFamily: 'var(--font-body)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    background: 'var(--bg-card)',
    color: 'var(--text-1)',
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s, box-shadow 0.15s',
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--overlay)',
    }}>
      <div style={{
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius)',
        boxShadow: 'var(--shadow-md)',
        width: '100%', maxWidth: '420px',
        margin: '0 16px',
        padding: '24px',
        fontFamily: 'var(--font-body)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <h2 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-1)', margin: 0, fontFamily: 'var(--font-head)' }}>
            新建项目
          </h2>
          <button
            onClick={onClose}
            style={{
              padding: '4px', borderRadius: 'var(--radius)', border: 'none',
              background: 'transparent', cursor: 'pointer',
              color: 'var(--text-4)', display: 'flex', alignItems: 'center',
              transition: 'background 0.15s, color 0.15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-warm)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-2)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-4)'; }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--text-2)', marginBottom: '5px' }}>
              公司名称
            </label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="例如：艾森股份"
              style={{ ...inputStyle, opacity: loading ? 0.6 : 1 }}
              disabled={loading}
              autoFocus
              onFocus={e => { (e.currentTarget as HTMLInputElement).style.borderColor = 'var(--green)'; (e.currentTarget as HTMLInputElement).style.boxShadow = '0 0 0 2px var(--green-soft)'; }}
              onBlur={e => { (e.currentTarget as HTMLInputElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLInputElement).style.boxShadow = 'none'; }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSubmit) handleSubmit();
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--text-2)', marginBottom: '5px' }}>
              报告年份
            </label>
            <input
              type="text"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder="例如：2025"
              style={{ ...inputStyle, opacity: loading ? 0.6 : 1 }}
              disabled={loading}
              maxLength={4}
              onFocus={e => { (e.currentTarget as HTMLInputElement).style.borderColor = 'var(--green)'; (e.currentTarget as HTMLInputElement).style.boxShadow = '0 0 0 2px var(--green-soft)'; }}
              onBlur={e => { (e.currentTarget as HTMLInputElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLInputElement).style.boxShadow = 'none'; }}
            />
          </div>

          {/* 项目 ID 预览 */}
          {projectId && (
            <p style={{ fontSize: '11px', color: 'var(--text-4)', margin: 0 }}>
              项目文件夹：
              <code style={{
                background: 'var(--bg-warm)', padding: '1px 6px',
                borderRadius: 'var(--radius-sm)', color: 'var(--text-2)',
                fontFamily: 'monospace', fontSize: '11px',
              }}>
                projects/{projectId}
              </code>
            </p>
          )}

          {/* 错误提示 */}
          {error && (
            <p style={{
              fontSize: '12px', color: 'var(--red)',
              background: 'var(--red-soft)',
              border: '1px solid var(--red-line)',
              borderRadius: 'var(--radius)',
              padding: '8px 12px', margin: 0,
            }}>
              {error}
            </p>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '20px' }}>
          <button
            onClick={onClose}
            disabled={loading}
            style={{
              padding: '7px 16px', fontSize: '12px', fontWeight: 500,
              fontFamily: 'var(--font-body)',
              borderRadius: 'var(--radius)', border: '1px solid var(--border)',
              background: 'transparent', color: 'var(--text-2)',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => { if (!loading) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-warm)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{
              padding: '7px 16px', fontSize: '12px', fontWeight: 500,
              fontFamily: 'var(--font-body)',
              borderRadius: 'var(--radius)', border: 'none',
              background: canSubmit ? 'var(--green)' : 'var(--bg-warm)',
              color: canSubmit ? '#fff' : 'var(--text-4)',
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', gap: '6px',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => { if (canSubmit) (e.currentTarget as HTMLButtonElement).style.background = 'var(--green-hover)'; }}
            onMouseLeave={e => { if (canSubmit) (e.currentTarget as HTMLButtonElement).style.background = 'var(--green)'; }}
          >
            {loading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                创建中...
              </>
            ) : (
              <>
                <Plus size={14} />
                创建
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
