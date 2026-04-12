'use client';

import React from 'react';
import { Editor } from '@tiptap/react';
import {
  Bold,
  Italic,
  Underline,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Undo2,
  Redo2,
} from 'lucide-react';

interface EditorToolbarProps {
  editor: Editor | null;
}

interface ToolButtonProps {
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}

const ToolButton: React.FC<ToolButtonProps> = ({ onClick, isActive, disabled, title, children }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={title}
    style={{
      padding: '5px',
      borderRadius: 'var(--radius)',
      border: 'none',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.4 : 1,
      background: isActive ? 'var(--indigo-soft)' : 'transparent',
      color: isActive ? 'var(--indigo)' : 'var(--text-3)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'background 0.15s, color 0.15s',
      flexShrink: 0,
    }}
    onMouseEnter={e => {
      if (!disabled && !isActive) {
        (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-warm)';
        (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-1)';
      }
    }}
    onMouseLeave={e => {
      if (!disabled && !isActive) {
        (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
        (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-3)';
      }
    }}
  >
    {children}
  </button>
);

const Separator: React.FC = () => (
  <div style={{ width: '1px', height: '18px', background: 'var(--border-light)', margin: '0 4px', flexShrink: 0 }} />
);

export const EditorToolbar: React.FC<EditorToolbarProps> = ({ editor }) => {
  if (!editor) return null;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '2px',
      padding: '6px 16px',
      borderBottom: '1px solid var(--border)',
      background: 'var(--bg-warm)',
      flexWrap: 'wrap',
      flexShrink: 0,
    }}>
      {/* Bold / Italic / Underline */}
      <ToolButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editor.isActive('bold')}
        title="粗体 (Ctrl+B)"
      >
        <Bold size={15} />
      </ToolButton>
      <ToolButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor.isActive('italic')}
        title="斜体 (Ctrl+I)"
      >
        <Italic size={15} />
      </ToolButton>
      <ToolButton
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        isActive={editor.isActive('underline')}
        title="下划线 (Ctrl+U)"
      >
        <Underline size={15} />
      </ToolButton>

      <Separator />

      {/* Headings */}
      <ToolButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        isActive={editor.isActive('heading', { level: 1 })}
        title="一级标题"
      >
        <Heading1 size={15} />
      </ToolButton>
      <ToolButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        isActive={editor.isActive('heading', { level: 2 })}
        title="二级标题"
      >
        <Heading2 size={15} />
      </ToolButton>
      <ToolButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        isActive={editor.isActive('heading', { level: 3 })}
        title="三级标题"
      >
        <Heading3 size={15} />
      </ToolButton>

      <Separator />

      {/* Lists */}
      <ToolButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        isActive={editor.isActive('bulletList')}
        title="无序列表"
      >
        <List size={15} />
      </ToolButton>
      <ToolButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        isActive={editor.isActive('orderedList')}
        title="有序列表"
      >
        <ListOrdered size={15} />
      </ToolButton>

      <Separator />

      {/* Blockquote */}
      <ToolButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        isActive={editor.isActive('blockquote')}
        title="引用"
      >
        <Quote size={15} />
      </ToolButton>

      <Separator />

      {/* Undo / Redo */}
      <ToolButton
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        title="撤销 (Ctrl+Z)"
      >
        <Undo2 size={15} />
      </ToolButton>
      <ToolButton
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        title="重做 (Ctrl+Y)"
      >
        <Redo2 size={15} />
      </ToolButton>
    </div>
  );
};
