'use client';

import { useState, useRef, useCallback } from 'react';
import { Upload, Loader2, CheckCircle, AlertCircle } from 'lucide-react';

interface UploadZipButtonProps {
  projectId: string;
  label?: string;
  onSuccess?: () => void;
}

type UploadState =
  | { type: 'idle' }
  | { type: 'uploading'; progress: number }
  | { type: 'processing' }
  | { type: 'success'; message: string }
  | { type: 'error'; message: string };

export function UploadZipButton({
  projectId,
  label = '上传资料',
  onSuccess,
}: UploadZipButtonProps) {
  const [state, setState] = useState<UploadState>({ type: 'idle' });
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // 客户端校验
      if (!file.name.toLowerCase().endsWith('.zip')) {
        setState({ type: 'error', message: '请选择 .zip 文件' });
        setTimeout(() => setState({ type: 'idle' }), 4000);
        return;
      }

      const MAX_SIZE = 3 * 1024 * 1024 * 1024; // 3GB
      if (file.size > MAX_SIZE) {
        setState({ type: 'error', message: '文件大小超过 3GB 限制' });
        setTimeout(() => setState({ type: 'idle' }), 4000);
        return;
      }

      setState({ type: 'uploading', progress: 0 });

      try {
        // 使用 XMLHttpRequest 支持上传进度追踪（fetch 不支持）
        const result = await new Promise<{ message: string }>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          const formData = new FormData();
          formData.append('file', file);

          xhr.upload.addEventListener('progress', (event) => {
            if (event.lengthComputable) {
              // 上传进度映射到 0-90%，剩余 10% 留给服务端处理
              const progress = Math.round((event.loaded / event.total) * 90);
              setState({ type: 'uploading', progress });
            }
          });

          // 上传字节全部发送完毕，进入服务端处理阶段
          xhr.upload.addEventListener('load', () => {
            setState({ type: 'processing' });
          });

          xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                resolve(JSON.parse(xhr.responseText));
              } catch {
                resolve({ message: '上传完成' });
              }
            } else {
              try {
                const errData = JSON.parse(xhr.responseText);
                reject(new Error(errData.error ?? `上传失败 (${xhr.status})`));
              } catch {
                reject(new Error(`上传失败 (${xhr.status})`));
              }
            }
          });

          xhr.addEventListener('error', () => reject(new Error('网络错误')));
          xhr.addEventListener('abort', () => reject(new Error('上传已取消')));

          xhr.open(
            'POST',
            `/api/projects/${encodeURIComponent(projectId)}/upload`
          );
          xhr.send(formData);
        });

        setState({ type: 'success', message: result.message });
        onSuccess?.();

        // 3 秒后重置
        setTimeout(() => setState({ type: 'idle' }), 3000);
      } catch (err) {
        setState({
          type: 'error',
          message: err instanceof Error ? err.message : '上传失败',
        });
        setTimeout(() => setState({ type: 'idle' }), 5000);
      } finally {
        // 重置 file input 允许重复选择同一文件
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [projectId, onSuccess]
  );

  const isWorking = state.type === 'uploading' || state.type === 'processing';

  // 按状态决定按钮配色
  const btnColors = (() => {
    if (state.type === 'error')   return { bg: 'var(--red-soft)',   color: 'var(--red)',   border: 'var(--red-line)' };
    if (state.type === 'success') return { bg: 'var(--green-soft)', color: 'var(--green)', border: 'var(--green-mid)' };
    return { bg: 'var(--green-soft)', color: 'var(--green)', border: 'var(--green-mid)' };
  })();

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start' }}>
      <input
        ref={inputRef}
        type="file"
        accept=".zip"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />

      <button
        onClick={handleClick}
        disabled={isWorking}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          padding: '5px 12px',
          fontSize: '12px', fontWeight: 500,
          fontFamily: 'var(--font-body)',
          background: btnColors.bg,
          color: btnColors.color,
          border: `1px solid ${btnColors.border}`,
          borderRadius: 'var(--radius)',
          cursor: isWorking ? 'not-allowed' : 'pointer',
          opacity: isWorking ? 0.7 : 1,
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => { if (!isWorking) (e.currentTarget as HTMLButtonElement).style.background = 'var(--green-mid)'; }}
        onMouseLeave={e => { if (!isWorking) (e.currentTarget as HTMLButtonElement).style.background = btnColors.bg; }}
      >
        {state.type === 'uploading' ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            上传中 {state.progress}%
          </>
        ) : state.type === 'processing' ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            服务器处理中...
          </>
        ) : state.type === 'success' ? (
          <>
            <CheckCircle size={14} />
            {state.message}
          </>
        ) : state.type === 'error' ? (
          <>
            <AlertCircle size={14} />
            {state.message}
          </>
        ) : (
          <>
            <Upload size={14} />
            {label}
          </>
        )}
      </button>

      {/* 上传进度条 */}
      {state.type === 'uploading' && (
        <div style={{ width: '100%', marginTop: '5px', height: '4px', background: 'var(--green-soft)', borderRadius: '99px', overflow: 'hidden' }}>
          <div
            style={{
              height: '100%', background: 'var(--green)',
              borderRadius: '99px',
              width: `${state.progress}%`,
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      )}
      {state.type === 'processing' && (
        <div style={{ width: '100%', marginTop: '5px', height: '4px', background: 'var(--green-soft)', borderRadius: '99px', overflow: 'hidden' }}>
          <div
            className="animate-pulse"
            style={{ height: '100%', background: 'var(--green)', borderRadius: '99px', width: '100%' }}
          />
        </div>
      )}
    </div>
  );
}
