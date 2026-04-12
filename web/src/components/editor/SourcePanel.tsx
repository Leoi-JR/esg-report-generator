'use client';

import React, { useState } from 'react';
import { useEditorStore } from '@/lib/store';
import { SourceWithText } from '@/lib/types';
import { formatScore, truncateText } from '@/lib/utils';
import { Paperclip, ChevronDown, ChevronUp, Copy, Check, FileText, Table2 } from 'lucide-react';

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

  // 竖条颜色：已引用=墨绿，高亮=墨绿加深，未引用=暖灰
  const leftBarColor = source.is_cited
    ? (isHighlighted ? 'var(--green-hover)' : 'var(--green)')
    : 'var(--border)';

  return (
    <div
      id={`source-${source.id}`}
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-light)',
        borderLeft: `3px solid ${leftBarColor}`,
        borderRadius: 'var(--radius)',
        opacity: source.is_cited ? 1 : 0.82,
        boxShadow: isHighlighted ? '0 0 0 2px var(--green-mid)' : 'none',
        transition: 'opacity 0.15s, border-left-color 0.15s',
      }}
      onMouseEnter={e => { if (!source.is_cited) (e.currentTarget as HTMLDivElement).style.opacity = '1'; }}
      onMouseLeave={e => { if (!source.is_cited) (e.currentTarget as HTMLDivElement).style.opacity = '0.82'; }}
    >
      {/* Header */}
      <div style={{ padding: '8px 10px 6px', borderBottom: '1px solid var(--border-light)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {showCheckbox && (
              <input
                type="checkbox"
                checked={isSelected}
                onChange={onToggleSelect}
                title="选择作为 AI 上下文"
                style={{ accentColor: 'var(--green)' }}
              />
            )}
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-2)', fontFamily: 'var(--font-body)' }}>
              [{source.id}]
            </span>
            {/* 引用状态徽章 */}
            {source.is_cited ? (
              <span style={{
                padding: '1px 6px', fontSize: '10px', fontWeight: 500,
                background: 'var(--green-soft)', color: 'var(--green)',
                border: '1px solid var(--green-mid)',
                borderRadius: 'var(--radius-sm)',
                display: 'inline-flex', alignItems: 'center', gap: '3px',
              }}>
                <span style={{ display: 'inline-block', width: '3px', height: '8px', borderRadius: '99px', background: 'var(--green)' }} />
                已引用
              </span>
            ) : (
              <span style={{
                padding: '1px 6px', fontSize: '10px', fontWeight: 500,
                background: 'var(--bg-warm)', color: 'var(--text-3)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
              }}>
                未引用
              </span>
            )}
            {source.is_table && (
              <span style={{
                padding: '1px 6px', fontSize: '10px', fontWeight: 500,
                background: 'var(--blue-soft)', color: 'var(--blue)',
                border: '1px solid var(--blue-mid)',
                borderRadius: 'var(--radius-sm)',
                display: 'inline-flex', alignItems: 'center', gap: '3px',
              }}>
                <Table2 size={9} />
                表格
              </span>
            )}
          </div>
        </div>

        {/* 文件名 */}
        <div style={{ fontSize: '11px', color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: '4px' }} title={source.file_name}>
          {source.file_name}
        </div>

        {/* 页码 + 相关度 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '11px', color: 'var(--text-4)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
            <FileText size={11} />
            第 {source.page} 页
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flex: 1 }}>
            <span>相关度</span>
            <div style={{ flex: 1, maxWidth: '64px', height: '3px', background: 'var(--border)', borderRadius: '99px', overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                borderRadius: '99px',
                background: source.is_cited ? 'var(--green)' : 'var(--text-4)',
                width: `${width}%`,
              }} />
            </div>
            <span style={{ color: 'var(--text-3)', minWidth: '28px' }}>{percentage}</span>
          </div>
        </div>
      </div>

      {/* 正文 */}
      <div style={{ padding: '7px 10px', overflow: 'hidden' }}>
        <p style={{
          fontSize: '12px', color: 'var(--text-2)',
          lineHeight: 1.7,
          wordBreak: 'break-all',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
          margin: 0,
          fontFamily: 'var(--font-body)',
        }}>
          {displayText}
        </p>
      </div>

      {/* 操作栏 */}
      <div style={{
        padding: '5px 10px',
        borderTop: '1px solid var(--border-light)',
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px',
      }}>
        {source.text.length > 150 && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            style={{
              display: 'flex', alignItems: 'center', gap: '3px',
              padding: '3px 8px', fontSize: '11px',
              color: 'var(--text-3)', background: 'none', border: 'none',
              borderRadius: 'var(--radius-sm)', cursor: 'pointer',
              fontFamily: 'var(--font-body)',
              transition: 'background 0.15s, color 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-warm)'; e.currentTarget.style.color = 'var(--text-1)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-3)'; }}
          >
            {isExpanded ? <><ChevronUp size={12} />收起</> : <><ChevronDown size={12} />展开</>}
          </button>
        )}
        <button
          onClick={handleCopy}
          style={{
            display: 'flex', alignItems: 'center', gap: '3px',
            padding: '3px 8px', fontSize: '11px',
            color: 'var(--text-3)', background: 'none', border: 'none',
            borderRadius: 'var(--radius-sm)', cursor: 'pointer',
            fontFamily: 'var(--font-body)',
            transition: 'background 0.15s, color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-warm)'; e.currentTarget.style.color = 'var(--text-1)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-3)'; }}
        >
          {isCopied
            ? <><Check size={12} style={{ color: 'var(--green)' }} />已复制</>
            : <><Copy size={12} />复制</>
          }
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
      <div style={{ height: '100%', background: 'var(--bg-sidebar)', display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: 'var(--green)', zIndex: 1 }} />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-4)' }}>
          <div style={{ textAlign: 'center' }}>
            <Paperclip size={28} style={{ margin: '0 auto 8px', display: 'block', opacity: 0.4 }} />
            <p style={{ fontSize: '12px', fontFamily: 'var(--font-body)' }}>选择章节查看来源资料</p>
          </div>
        </div>
      </div>
    );
  }

  if (currentSources.length === 0) {
    return (
      <div style={{ height: '100%', background: 'var(--bg-sidebar)', display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: 'var(--green)', zIndex: 1 }} />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-4)' }}>
          <div style={{ textAlign: 'center' }}>
            <Paperclip size={28} style={{ margin: '0 auto 8px', display: 'block', opacity: 0.4 }} />
            <p style={{ fontSize: '12px', fontFamily: 'var(--font-body)' }}>此章节暂无来源资料</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-sidebar)', position: 'relative' }}>
      {/* 顶部墨绿色条，与 AI 面板的靛蓝色条对应 */}
      <div style={{
        position: 'absolute',
        top: 0, left: 0, right: 0,
        height: '2px',
        background: 'var(--green)',
        zIndex: 1,
        flexShrink: 0,
      }} />
      {/* Header */}
      <div style={{
        height: '40px',
        padding: '0 12px',
        background: 'var(--bg-warm)',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: '6px',
        flexShrink: 0,
        boxSizing: 'border-box',
      }}>
        <Paperclip size={14} style={{ color: 'var(--green)' }} />
        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-1)', fontFamily: 'var(--font-head)' }}>来源资料</span>
        <span style={{
          padding: '1px 7px', fontSize: '10px', fontWeight: 500,
          background: 'var(--bg-warm)', color: 'var(--text-3)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          fontFamily: 'var(--font-body)',
        }}>
          {currentSources.length}
        </span>
      </div>

      {/* 来源列表 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
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
