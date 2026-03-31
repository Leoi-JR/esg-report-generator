import { Node, mergeAttributes } from '@tiptap/core';

/**
 * SourceTag - Tiptap 自定义节点
 *
 * 每个 SourceTag 节点代表单个来源引用，渲染为可点击的角标。
 * 多个来源（如 [来源1,2,3]）会被拆分为多个独立的 SourceTag 节点。
 *
 * 属性:
 *   - sources: 单个来源 ID（如 "1", "2", "10"）
 *
 * 渲染:
 *   <sup data-type="source-tag" data-sources="1" class="source-tag">1</sup>
 */
export const SourceTag = Node.create({
  name: 'sourceTag',
  group: 'inline',
  inline: true,
  atom: true, // 原子节点，不可编辑内部内容

  addAttributes() {
    return {
      sources: {
        default: '',
        parseHTML: (element: HTMLElement) => {
          // 优先从 data-sources 属性读取，回退到文本内容
          return element.getAttribute('data-sources') || element.textContent || '';
        },
        renderHTML: (attributes: Record<string, string>) => {
          return { 'data-sources': attributes.sources || '' };
        },
      },
    };
  },

  parseHTML() {
    return [
      { tag: 'sup[data-type="source-tag"]' },
      { tag: 'sup[data-sources]' },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const sourceId = node.attrs.sources || HTMLAttributes['data-sources'] || '';
    return ['sup', mergeAttributes(HTMLAttributes, {
      'data-type': 'source-tag',
      'data-sources': sourceId,
      'class': 'source-tag',
    }), sourceId];
  },
});
