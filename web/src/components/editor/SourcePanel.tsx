'use client';

import React, { useState } from 'react';
import { useEditorStore } from '@/lib/store';
import { SourceWithText } from '@/lib/types';
import { cn, formatScore, truncateText } from '@/lib/utils';
import { Paperclip, ChevronDown, ChevronUp, Copy, Check, FileText } from 'lucide-react';

interface SourceCardProps {
  source: SourceWithText;
  isHighlighted: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
  showCheckbox: boolean;
}

const SourceCard: React.FC<SourceCardProps> = ({
  source,
  isHighlighted,
  isSelected,
  onToggleSelect,
  showCheckbox,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  const { percentage, width } = formatScore(source.score);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(source.text);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const displayText = isExpanded ? source.text : truncateText(source.text, 150);

  return (
    <div
      id={`source-${source.id}`}
      className={cn(
        'bg-white rounded-lg border transition-all duration-200',
        isHighlighted ? 'border-blue-400 ring-2 ring-blue-100' : 'border-gray-200',
        source.is_cited ? 'border-l-4 border-l-green-500' : 'border-l-4 border-l-gray-300'
      )}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-100">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            {showCheckbox && (
              <input
                type="checkbox"
                checked={isSelected}
                onChange={onToggleSelect}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                title="选择作为 AI 上下文"
              />
            )}
            <span className="text-sm font-medium text-gray-700">[{source.id}]</span>
            {source.is_cited ? (
              <span className="px-1.5 py-0.5 text-xs bg-green-50 text-green-700 rounded">
                ✓ 被引用
              </span>
            ) : (
              <span className="px-1.5 py-0.5 text-xs bg-gray-100 text-gray-500 rounded">
                未引用
              </span>
            )}
          </div>
        </div>
        <div className="text-xs text-gray-600 truncate" title={source.file_name}>
          {source.file_name}
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <FileText size={12} />
            第 {source.page} 页
          </span>
          <div className="flex items-center gap-2 flex-1">
            <span>相关度</span>
            <div className="flex-1 max-w-[80px] h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  source.score >= 0.3 ? 'bg-green-500' :
                    source.score >= 0.1 ? 'bg-amber-500' : 'bg-red-400'
                )}
                style={{ width: `${width}%` }}
              />
            </div>
            <span className="text-gray-600 min-w-[32px]">{percentage}</span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-3 py-2 overflow-hidden">
        <p className="text-sm text-gray-700 leading-relaxed break-all whitespace-pre-wrap overflow-wrap-anywhere">
          {displayText}
        </p>
      </div>

      {/* Actions */}
      <div className="px-3 py-2 border-t border-gray-100 flex items-center justify-end gap-2">
        {source.text.length > 150 && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
          >
            {isExpanded ? (
              <>
                <ChevronUp size={14} />
                收起
              </>
            ) : (
              <>
                <ChevronDown size={14} />
                展开
              </>
            )}
          </button>
        )}
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
        >
          {isCopied ? (
            <>
              <Check size={14} className="text-green-500" />
              已复制
            </>
          ) : (
            <>
              <Copy size={14} />
              复制
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export const SourcePanel: React.FC = () => {
  const {
    currentSources,
    currentChapter,
    highlightedSourceId,
    selectedSourceIds,
    toggleSourceSelection,
    showAIPanel,
  } = useEditorStore();

  if (!currentChapter) {
    return (
      <div className="h-full bg-gray-50 flex items-center justify-center text-gray-400">
        <div className="text-center">
          <Paperclip size={32} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm">选择章节查看来源资料</p>
        </div>
      </div>
    );
  }

  if (currentChapter.status === 'skipped' || currentSources.length === 0) {
    return (
      <div className="h-full bg-gray-50 flex items-center justify-center text-gray-400">
        <div className="text-center">
          <Paperclip size={32} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm">此章节暂无来源资料</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="px-4 py-3 bg-white border-b border-gray-200">
        <div className="flex items-center gap-2">
          <Paperclip size={18} className="text-gray-500" />
          <h3 className="font-medium text-gray-700">来源资料</h3>
          <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full">
            {currentSources.length}
          </span>
        </div>
      </div>

      {/* Source List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {currentSources.map(source => (
          <SourceCard
            key={source.id}
            source={source}
            isHighlighted={highlightedSourceId === source.id}
            isSelected={selectedSourceIds.has(source.id)}
            onToggleSelect={() => toggleSourceSelection(source.id)}
            showCheckbox={showAIPanel}
          />
        ))}
      </div>
    </div>
  );
};
