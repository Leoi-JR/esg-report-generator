'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  FileText,
  ArrowRight,
  BarChart3,
  Calendar,
  Activity,
  Loader2,
  FolderOpen,
  Plus,
  Download,
  Upload as UploadIcon,
  Trash2,
  AlertTriangle,
  X,
} from 'lucide-react';
import { CreateProjectModal } from '@/components/create-project-modal';
import { UploadZipButton } from '@/components/upload-zip-button';
import { ThemeToggle } from '@/components/theme-toggle';

type ProjectStatus = 'no_data' | 'data_uploaded' | 'draft_generated';

interface ProjectInfo {
  id: string;
  name: string;
  companyName: string;
  year: string;
  description: string;
  status: ProjectStatus;
  uploadedFileCount: number;
  stats: {
    total: number;
    generated: number;
    skipped: number;
    error: number;
  } | null;
  generatedAt: string | null;
  hasData: boolean;
}

// 按钮基础样式
const btnBase: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '5px',
  padding: '5px 12px',
  fontSize: '12px',
  fontWeight: 500,
  borderRadius: 'var(--radius)',
  cursor: 'pointer',
  fontFamily: 'var(--font-body)',
  textDecoration: 'none',
  border: 'none',
  transition: 'background 0.15s',
  whiteSpace: 'nowrap' as const,
};

const btnPrimaryStyle: React.CSSProperties = { ...btnBase, background: 'var(--green)', color: '#fff' };
const btnIndigoStyle: React.CSSProperties = { ...btnBase, background: 'var(--indigo)', color: '#fff' };
const btnSoftStyle: React.CSSProperties = { ...btnBase, background: 'var(--green-soft)', color: 'var(--green)', border: '1px solid var(--green-mid)' };
const btnDangerStyle: React.CSSProperties = { ...btnBase, background: 'transparent', color: 'var(--red)', border: '1px solid var(--red-line)' };

export default function HomePage() {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const fetchProjects = useCallback(() => {
    setLoading(true);
    fetch('/api/projects')
      .then((r) => r.json())
      .then((data) => setProjects(data.projects ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', fontFamily: 'var(--font-body)' }}>
      {/* Header — 52px，暖白，墨绿 Logo */}
      <header style={{
        height: '52px',
        background: 'var(--bg-card)',
        borderBottom: '2px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 24px',
        gap: '10px',
      }}>
        {/* Logo 方块 */}
        <div style={{
          width: '22px', height: '22px',
          border: '2px solid var(--green)',
          borderRadius: '3px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <FileText size={12} style={{ color: 'var(--green)' }} />
        </div>
        {/* 品牌名 */}
        <span style={{
          fontFamily: 'var(--font-head)',
          fontSize: '14px', fontWeight: 700,
          color: 'var(--text-1)', letterSpacing: '0.01em',
        }}>
          ESG 报告编辑平台
        </span>

        {/* 右侧：主题切换 + 新建按钮 */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ThemeToggle />
          <button
            onClick={() => setShowCreateModal(true)}
            style={btnPrimaryStyle}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--green-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'var(--green)')}
          >
            <Plus size={13} />
            新建项目
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main style={{ maxWidth: '900px', margin: '0 auto', padding: '28px 24px' }}>
        <h2 style={{
          fontFamily: 'var(--font-head)',
          fontSize: '16px', fontWeight: 700,
          color: 'var(--text-1)', marginBottom: '16px',
        }}>
          项目列表
        </h2>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '48px 0' }}>
            <Loader2 size={28} style={{ color: 'var(--green)', margin: '0 auto 10px', display: 'block' }} className="animate-spin" />
            <p style={{ color: 'var(--text-3)', fontSize: '13px' }}>加载项目列表...</p>
          </div>
        ) : projects.length === 0 ? (
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: '48px 24px',
            textAlign: 'center',
            boxShadow: 'var(--shadow-sm)',
          }}>
            <FolderOpen size={40} style={{ color: 'var(--border)', margin: '0 auto 12px', display: 'block' }} />
            <p style={{ color: 'var(--text-3)', fontSize: '13px', marginBottom: '6px' }}>暂无项目</p>
            <p style={{ color: 'var(--text-4)', fontSize: '12px' }}>
              点击右上角「新建项目」按钮创建第一个 ESG 报告项目。
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} onRefresh={fetchProjects} />
            ))}
          </div>
        )}
      </main>

      <CreateProjectModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={fetchProjects}
      />
    </div>
  );
}

function ProjectCard({ project, onRefresh }: { project: ProjectInfo; onRefresh: () => void }) {
  const { stats, generatedAt, status } = project;
  const total = stats?.total ?? 0;
  const generated = stats?.generated ?? 0;
  const skipped = stats?.skipped ?? 0;
  const percent = total > 0 ? Math.round((generated / total) * 100) : 0;
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const dateStr = generatedAt
    ? new Date(generatedAt).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
    : null;

  const projectParam = encodeURIComponent(project.id);

  const handleDownloadTemplate = () => {
    window.location.href = `/api/projects/${projectParam}/template`;
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const res = await fetch('/api/projects', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || '删除失败');
        return;
      }
      setShowDeleteConfirm(false);
      onRefresh();
    } catch {
      alert('删除失败，请重试');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      padding: '18px 20px',
      boxShadow: 'var(--shadow-sm)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px' }}>
        {/* 左侧：项目信息 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
            <h3 style={{
              fontFamily: 'var(--font-head)',
              fontSize: '15px', fontWeight: 700,
              color: 'var(--text-1)', margin: 0,
            }}>
              {project.name}
            </h3>
            <StatusBadge status={status} uploadedFileCount={project.uploadedFileCount} />
          </div>
          <p style={{ color: 'var(--text-3)', fontSize: '12px', marginBottom: '10px' }}>
            {project.description}
          </p>

          {/* Meta 信息 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '11px', color: 'var(--text-4)' }}>
            {total > 0 && (
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <BarChart3 size={12} /> {total} 个章节
              </span>
            )}
            {dateStr && (
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Calendar size={12} /> 生成于 {dateStr}
              </span>
            )}
            {project.uploadedFileCount > 0 && status !== 'draft_generated' && (
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <UploadIcon size={12} /> {project.uploadedFileCount} 个资料文件
              </span>
            )}
          </div>

          {/* 进度条 */}
          {stats && total > 0 && (
            <div style={{ marginTop: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-3)', marginBottom: '5px' }}>
                <span>完成进度</span>
                <span style={{ fontWeight: 500, color: 'var(--text-2)' }}>{percent}%</span>
              </div>
              <div style={{ height: '4px', background: 'var(--border)', borderRadius: '99px', overflow: 'hidden' }}>
                <div style={{ height: '100%', background: 'var(--green)', borderRadius: '99px', width: `${percent}%` }} />
              </div>
              <div style={{ display: 'flex', gap: '12px', marginTop: '6px', fontSize: '11px', color: 'var(--text-4)' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '99px', background: 'var(--green)', display: 'inline-block' }} />
                  {generated} 已生成
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '99px', background: 'var(--border)', display: 'inline-block' }} />
                  {skipped} 已跳过
                </span>
                {(stats.error ?? 0) > 0 && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '99px', background: 'var(--red)', display: 'inline-block' }} />
                    {stats.error} 错误
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 右侧操作按钮 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0 }}>
          {status === 'no_data' && (
            <>
              <button
                onClick={handleDownloadTemplate}
                style={btnSoftStyle}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--green-mid)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'var(--green-soft)')}
              >
                <Download size={13} /> 下载模板
              </button>
              <UploadZipButton projectId={project.id} onSuccess={onRefresh} />
            </>
          )}

          {status === 'data_uploaded' && (
            <>
              <Link href={`/pipeline?project=${projectParam}`} style={btnIndigoStyle}>
                <Activity size={12} /> 运行 Pipeline
              </Link>
              <UploadZipButton projectId={project.id} label="重新上传" onSuccess={onRefresh} />
            </>
          )}

          {status === 'draft_generated' && (
            <>
              <Link href={`/editor?project=${projectParam}`} style={btnPrimaryStyle}>
                <span>进入编辑</span><ArrowRight size={13} />
              </Link>
              <Link href={`/pipeline?project=${projectParam}`} style={btnIndigoStyle}>
                <Activity size={12} /> Pipeline
              </Link>
              <UploadZipButton projectId={project.id} label="重新上传" onSuccess={onRefresh} />
            </>
          )}

          <button
            onClick={() => setShowDeleteConfirm(true)}
            style={btnDangerStyle}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--red-soft)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <Trash2 size={12} /> 删除项目
          </button>
        </div>
      </div>

      {showDeleteConfirm && (
        <DeleteConfirmModal
          projectName={project.companyName}
          fullName={project.name}
          isDeleting={isDeleting}
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </div>
  );
}

function DeleteConfirmModal({
  projectName, fullName, isDeleting, onConfirm, onCancel,
}: {
  projectName: string; fullName: string; isDeleting: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  const [inputValue, setInputValue] = useState('');
  const canConfirm = inputValue.trim() === projectName;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'var(--overlay)' }} onClick={onCancel} />
      <div style={{
        position: 'relative',
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-md)',
        width: '100%', maxWidth: '420px',
        margin: '0 16px', padding: '22px 24px',
      }}>
        <button
          onClick={onCancel}
          style={{ position: 'absolute', top: '14px', right: '14px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-4)', padding: '2px' }}
        >
          <X size={18} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
          <div style={{ width: '34px', height: '34px', borderRadius: '99px', background: 'var(--red-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <AlertTriangle size={16} style={{ color: 'var(--red)' }} />
          </div>
          <h3 style={{ fontFamily: 'var(--font-head)', fontSize: '14px', fontWeight: 700, color: 'var(--text-1)', margin: 0 }}>
            确认删除项目
          </h3>
        </div>

        <p style={{ fontSize: '12px', color: 'var(--text-3)', marginBottom: '14px', lineHeight: 1.7 }}>
          此操作将永久删除项目「<strong style={{ color: 'var(--text-1)' }}>{fullName}</strong>」的所有数据，包括资料文件、初稿、编辑记录和 Pipeline 历史，且<span style={{ color: 'var(--red)', fontWeight: 500 }}>不可恢复</span>。
        </p>

        <div style={{ marginBottom: '18px' }}>
          <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-3)', marginBottom: '6px' }}>
            请输入公司名称 <code style={{ fontWeight: 600, color: 'var(--text-1)', background: 'var(--bg-warm)', padding: '1px 5px', borderRadius: 'var(--radius-sm)' }}>{projectName}</code> 以确认删除：
          </label>
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={projectName}
            style={{
              width: '100%', padding: '7px 10px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              fontSize: '13px', fontFamily: 'var(--font-body)',
              color: 'var(--text-1)', background: 'var(--bg-card)',
              outline: 'none', boxSizing: 'border-box',
            }}
            autoFocus
          />
        </div>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            disabled={isDeleting}
            style={{ ...btnBase, background: 'var(--bg-warm)', color: 'var(--text-2)', border: '1px solid var(--border)', opacity: isDeleting ? 0.5 : 1 }}
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            disabled={!canConfirm || isDeleting}
            style={{ ...btnBase, background: canConfirm && !isDeleting ? 'var(--red)' : 'var(--red-soft-hover)', color: '#fff', cursor: canConfirm && !isDeleting ? 'pointer' : 'not-allowed' }}
          >
            {isDeleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
            {isDeleting ? '删除中...' : '确认删除'}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status, uploadedFileCount }: { status: ProjectStatus; uploadedFileCount: number }) {
  const base: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center',
    fontSize: '11px', fontWeight: 500,
    padding: '2px 8px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid transparent',
    fontFamily: 'var(--font-body)',
  };
  switch (status) {
    case 'no_data':
      return <span style={{ ...base, background: 'var(--amber-soft)', color: 'var(--amber)', border: '1px solid var(--amber-border)' }}>未上传资料</span>;
    case 'data_uploaded':
      return <span style={{ ...base, background: 'var(--blue-soft)', color: 'var(--blue)', border: '1px solid var(--blue-mid)' }}>已上传 {uploadedFileCount} 个文件</span>;
    case 'draft_generated':
      return <span style={{ ...base, background: 'var(--green-soft)', color: 'var(--green)', border: '1px solid var(--green-mid)' }}>已生成初稿</span>;
  }
}
