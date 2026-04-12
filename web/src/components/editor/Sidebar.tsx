'use client';

import React, { useMemo } from 'react';
import { useEditorStore } from '@/lib/store';
import { TreeNode } from '@/lib/types';
import { ChevronRight, ChevronDown, Folder, FolderOpen, Search } from 'lucide-react';

interface TreeNodeProps {
  node: TreeNode;
  level: number;
}

const TreeNodeComponent: React.FC<TreeNodeProps> = ({ node, level }) => {
  const {
    selectedChapterId,
    expandedNodes,
    toggleNode,
    selectChapter,
  } = useEditorStore();

  const isExpanded = expandedNodes.has(node.id);
  const isSelected = node.isLeaf && selectedChapterId === node.id;

  const handleClick = () => {
    if (node.isLeaf) {
      selectChapter(node.id);
    } else {
      toggleNode(node.id);
    }
  };

  // pip 颜色
  const pipColor = node.status === 'generated' ? 'var(--green)' :
                   node.status === 'reviewed' ? 'var(--blue)' :
                   node.status === 'approved' ? 'var(--indigo)' :
                   'var(--text-4)';

  return (
    <div>
      <div
        onClick={handleClick}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '5px',
          paddingTop: '5px',
          paddingBottom: '5px',
          paddingRight: '10px',
          paddingLeft: `${level * 14 + 10}px`,
          cursor: 'pointer',
          borderLeft: isSelected ? '2px solid var(--green)' : '2px solid transparent',
          background: isSelected ? 'var(--green-soft)' : 'transparent',
          transition: 'background 0.12s',
          opacity: node.status === 'skipped' ? 0.55 : 1,
        }}
        onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = 'var(--green-soft)'; }}
        onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
      >
        {/* 展开/收起箭头 */}
        {!node.isLeaf && (
          <span style={{ flexShrink: 0, color: 'var(--text-4)', width: '13px', display: 'flex', alignItems: 'center' }}>
            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
        )}

        {/* 非叶节点：文件夹图标；叶节点：竖向 pip 状态指示器 */}
        {!node.isLeaf ? (
          <span style={{ flexShrink: 0, color: 'var(--amber-warm)', display: 'flex', alignItems: 'center' }}>
            {isExpanded ? <FolderOpen size={13} /> : <Folder size={13} />}
          </span>
        ) : (
          <span style={{
            flexShrink: 0,
            display: 'inline-block',
            width: '3px',
            height: '12px',
            borderRadius: '99px',
            background: pipColor,
            opacity: node.status === 'skipped' ? 0.4 : 1,
            marginLeft: '1px',
          }} />
        )}

        {/* 标签文字 */}
        <span style={{
          flex: 1,
          fontSize: '12px',
          color: isSelected ? 'var(--green)' :
                 !node.isLeaf ? 'var(--text-2)' :
                 node.status === 'skipped' ? 'var(--text-4)' : 'var(--text-2)',
          fontWeight: isSelected ? 500 : (!node.isLeaf ? 600 : 400),
          fontFamily: !node.isLeaf ? 'var(--font-head)' : 'var(--font-body)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          lineHeight: 1.4,
        }}>
          {node.label}
        </span>
      </div>

      {!node.isLeaf && isExpanded && (
        <div>
          {node.children.map(child => (
            <TreeNodeComponent key={child.id} node={child} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

type FilterType = 'all' | 'generated' | 'skipped' | 'reviewed';

const filterButtons: { value: FilterType; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'generated', label: '待审核' },
  { value: 'skipped', label: '已跳过' },
];

export const Sidebar: React.FC = () => {
  const {
    treeData,
    draftResults,
    searchQuery,
    statusFilter,
    setSearchQuery,
    setStatusFilter,
    expandAll,
    collapseAll,
  } = useEditorStore();

  const filteredTree = useMemo(() => {
    if (!searchQuery && statusFilter === 'all') return treeData;
    const filterNode = (node: TreeNode): TreeNode | null => {
      if (node.isLeaf) {
        if (statusFilter !== 'all' && node.status !== statusFilter) return null;
        if (searchQuery && !node.label.toLowerCase().includes(searchQuery.toLowerCase())) return null;
        return node;
      }
      const filteredChildren = node.children.map(filterNode).filter((n): n is TreeNode => n !== null);
      if (filteredChildren.length === 0) return null;
      return { ...node, children: filteredChildren };
    };
    return treeData.map(filterNode).filter((n): n is TreeNode => n !== null);
  }, [treeData, searchQuery, statusFilter]);

  const stats = useMemo(() => {
    if (!draftResults) return { generated: 0, skipped: 0, reviewed: 0, approved: 0, total: 0 };
    const results = draftResults.results;
    return {
      generated: results.filter(r => r.status === 'generated').length,
      skipped: results.filter(r => r.status === 'skipped').length,
      reviewed: results.filter(r => r.status === 'reviewed').length,
      approved: results.filter(r => r.status === 'approved').length,
      total: draftResults.summary.total,
    };
  }, [draftResults]);

  const progressPercentage = stats.total > 0 ? Math.round((stats.generated / stats.total) * 100) : 0;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: 'var(--bg-sidebar)',
      borderRight: '1px solid var(--border)',
    }}>
      {/* 搜索框 */}
      <div style={{ padding: '10px 10px 8px', borderBottom: '1px solid var(--border-light)' }}>
        <div style={{ position: 'relative' }}>
          <Search size={13} style={{ position: 'absolute', left: '9px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-4)' }} />
          <input
            type="text"
            placeholder="搜索章节..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              paddingLeft: '28px', paddingRight: '8px',
              paddingTop: '6px', paddingBottom: '6px',
              fontSize: '12px',
              fontFamily: 'var(--font-body)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-card)',
              color: 'var(--text-1)',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
      </div>

      {/* 筛选按钮 */}
      <div style={{ padding: '7px 10px 6px', borderBottom: '1px solid var(--border-light)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '5px' }}>
          {filterButtons.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setStatusFilter(value)}
              style={{
                padding: '2px 9px',
                fontSize: '11px', fontWeight: 500,
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                fontFamily: 'var(--font-body)',
                border: statusFilter === value ? '1px solid var(--green-mid)' : '1px solid var(--border)',
                background: statusFilter === value ? 'var(--green-soft)' : 'transparent',
                color: statusFilter === value ? 'var(--green)' : 'var(--text-3)',
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: 'var(--text-4)' }}>
          <button
            onClick={expandAll}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '11px', color: 'var(--text-4)', fontFamily: 'var(--font-body)', padding: 0, transition: 'color 0.15s' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--green)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-4)')}
          >
            展开全部
          </button>
          <span style={{ color: 'var(--border)' }}>|</span>
          <button
            onClick={collapseAll}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '11px', color: 'var(--text-4)', fontFamily: 'var(--font-body)', padding: 0, transition: 'color 0.15s' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--green)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-4)')}
          >
            收起全部
          </button>
        </div>
      </div>

      {/* 章节树 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
        {filteredTree.map(node => (
          <TreeNodeComponent key={node.id} node={node} level={0} />
        ))}
        {filteredTree.length === 0 && (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-4)', fontSize: '12px' }}>
            没有匹配的章节
          </div>
        )}
      </div>

      {/* 底部统计区 */}
      <div style={{
        padding: '10px 12px',
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-warm)',
      }}>
        {/* 进度条 */}
        <div style={{ marginBottom: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-3)', marginBottom: '4px' }}>
            <span>进度</span>
            <span style={{ fontWeight: 500, color: 'var(--text-2)' }}>{progressPercentage}%</span>
          </div>
          <div style={{ height: '4px', background: 'var(--border)', borderRadius: '99px', overflow: 'hidden' }}>
            <div style={{ height: '100%', background: 'var(--green)', borderRadius: '99px', width: `${progressPercentage}%`, transition: 'width 0.3s' }} />
          </div>
        </div>

        {/* 统计列表（竖条 pip 指示器） */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <StatRow pip="var(--green)" count={stats.generated} label="已生成" />
          <StatRow pip="var(--text-4)" count={stats.skipped} label="已跳过" opacity={0.5} />
          <StatRow pip="var(--blue)" count={stats.reviewed} label="已审核" />
          {stats.approved > 0 && <StatRow pip="var(--indigo)" count={stats.approved} label="已批准" />}
        </div>
      </div>
    </div>
  );
};

function StatRow({ pip, count, label, opacity = 1 }: { pip: string; count: number; label: string; opacity?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
      <span style={{ display: 'inline-block', width: '3px', height: '12px', borderRadius: '99px', background: pip, opacity, flexShrink: 0 }} />
      <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>{count} {label}</span>
    </div>
  );
}
