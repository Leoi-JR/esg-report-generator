'use client';

import React, { useState, useMemo } from 'react';
import { useEditorStore } from '@/lib/store';
import { TreeNode } from '@/lib/types';
import { cn, getStatusDisplay } from '@/lib/utils';
import { ChevronRight, ChevronDown, Folder, FolderOpen, Search, Filter } from 'lucide-react';

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
  const statusDisplay = node.status ? getStatusDisplay(node.status) : null;

  const handleClick = () => {
    if (node.isLeaf) {
      selectChapter(node.id);
    } else {
      toggleNode(node.id);
    }
  };

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1 py-1.5 px-2 cursor-pointer rounded-md transition-colors',
          'hover:bg-gray-100',
          isSelected && 'bg-blue-50 text-blue-700',
          node.status === 'skipped' && 'opacity-60'
        )}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={handleClick}
      >
        {!node.isLeaf && (
          <span className="flex-shrink-0 w-4 h-4 text-gray-400">
            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </span>
        )}

        {!node.isLeaf ? (
          <span className="flex-shrink-0 text-amber-500">
            {isExpanded ? <FolderOpen size={16} /> : <Folder size={16} />}
          </span>
        ) : (
          <span className={cn('flex-shrink-0 text-sm', statusDisplay?.color)}>
            {statusDisplay?.icon}
          </span>
        )}

        <span className={cn(
          'flex-1 text-sm truncate',
          node.isLeaf && node.status === 'skipped' && 'text-gray-400'
        )}>
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

  const [isFilterOpen, setIsFilterOpen] = useState(false);

  const filteredTree = useMemo(() => {
    if (!searchQuery && statusFilter === 'all') {
      return treeData;
    }

    const filterNode = (node: TreeNode): TreeNode | null => {
      if (node.isLeaf) {
        // Filter by status
        if (statusFilter !== 'all' && node.status !== statusFilter) {
          return null;
        }
        // Filter by search query
        if (searchQuery && !node.label.toLowerCase().includes(searchQuery.toLowerCase())) {
          return null;
        }
        return node;
      }

      // For non-leaf nodes, filter children
      const filteredChildren = node.children
        .map(filterNode)
        .filter((n): n is TreeNode => n !== null);

      if (filteredChildren.length === 0) {
        return null;
      }

      return { ...node, children: filteredChildren };
    };

    return treeData
      .map(filterNode)
      .filter((n): n is TreeNode => n !== null);
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

  const progressPercentage = stats.total > 0
    ? Math.round((stats.generated / stats.total) * 100)
    : 0;

  return (
    <div className="flex flex-col h-full bg-white border-r border-gray-200">
      {/* Search */}
      <div className="p-3 border-b border-gray-100">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input
            type="text"
            placeholder="搜索章节..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Filters */}
      <div className="px-3 py-2 border-b border-gray-100">
        <div className="flex items-center gap-1">
          {filterButtons.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setStatusFilter(value)}
              className={cn(
                'px-3 py-1 text-xs font-medium rounded-full transition-colors',
                statusFilter === value
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
          <button onClick={expandAll} className="hover:text-blue-600">展开全部</button>
          <span>|</span>
          <button onClick={collapseAll} className="hover:text-blue-600">收起全部</button>
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-2">
        {filteredTree.map(node => (
          <TreeNodeComponent key={node.id} node={node} level={0} />
        ))}
        {filteredTree.length === 0 && (
          <div className="px-4 py-8 text-center text-gray-400 text-sm">
            没有匹配的章节
          </div>
        )}
      </div>

      {/* Progress Stats */}
      <div className="p-3 border-t border-gray-200 bg-gray-50">
        <div className="mb-2">
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 transition-all duration-300"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
          <div className="text-right text-xs text-gray-500 mt-1">
            {progressPercentage}%
          </div>
        </div>
        <div className="flex flex-col gap-1 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-green-500">✅</span>
            <span className="text-gray-600">{stats.generated} 已生成</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-400">⏭️</span>
            <span className="text-gray-600">{stats.skipped} 已跳过</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-blue-500">✓</span>
            <span className="text-gray-600">{stats.reviewed} 已审核</span>
          </div>
          {stats.approved > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-purple-500">✔</span>
              <span className="text-gray-600">{stats.approved} 已批准</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
