'use client';

import React from 'react';
import { Editor } from '@tiptap/react';
import { cn } from '@/lib/utils';
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
    className={cn(
      'p-1.5 rounded transition-colors',
      isActive
        ? 'bg-blue-100 text-blue-700'
        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100',
      disabled && 'opacity-40 cursor-not-allowed'
    )}
  >
    {children}
  </button>
);

const Separator: React.FC = () => (
  <div className="w-px h-5 bg-gray-200 mx-1" />
);

export const EditorToolbar: React.FC<EditorToolbarProps> = ({ editor }) => {
  if (!editor) return null;

  return (
    <div className="flex items-center gap-0.5 px-4 py-1.5 border-b border-gray-200 bg-gray-50 flex-wrap">
      {/* Bold / Italic / Underline */}
      <ToolButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editor.isActive('bold')}
        title="粗体 (Ctrl+B)"
      >
        <Bold size={16} />
      </ToolButton>
      <ToolButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor.isActive('italic')}
        title="斜体 (Ctrl+I)"
      >
        <Italic size={16} />
      </ToolButton>
      <ToolButton
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        isActive={editor.isActive('underline')}
        title="下划线 (Ctrl+U)"
      >
        <Underline size={16} />
      </ToolButton>

      <Separator />

      {/* Headings */}
      <ToolButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        isActive={editor.isActive('heading', { level: 1 })}
        title="一级标题"
      >
        <Heading1 size={16} />
      </ToolButton>
      <ToolButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        isActive={editor.isActive('heading', { level: 2 })}
        title="二级标题"
      >
        <Heading2 size={16} />
      </ToolButton>
      <ToolButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        isActive={editor.isActive('heading', { level: 3 })}
        title="三级标题"
      >
        <Heading3 size={16} />
      </ToolButton>

      <Separator />

      {/* Lists */}
      <ToolButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        isActive={editor.isActive('bulletList')}
        title="无序列表"
      >
        <List size={16} />
      </ToolButton>
      <ToolButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        isActive={editor.isActive('orderedList')}
        title="有序列表"
      >
        <ListOrdered size={16} />
      </ToolButton>

      <Separator />

      {/* Blockquote */}
      <ToolButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        isActive={editor.isActive('blockquote')}
        title="引用"
      >
        <Quote size={16} />
      </ToolButton>

      <Separator />

      {/* Undo / Redo */}
      <ToolButton
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        title="撤销 (Ctrl+Z)"
      >
        <Undo2 size={16} />
      </ToolButton>
      <ToolButton
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        title="重做 (Ctrl+Y)"
      >
        <Redo2 size={16} />
      </ToolButton>
    </div>
  );
};
