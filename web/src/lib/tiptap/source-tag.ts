import { Node, mergeAttributes } from '@tiptap/core';

export const SourceTag = Node.create({
  name: 'sourceTag',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      sources: {
        default: '',
        parseHTML: (element: HTMLElement) => {
          return element.getAttribute('data-sources') || element.textContent || '';
        },
        renderHTML: (attributes: Record<string, string>) => {
          // Always output data-sources, even if empty — this ensures the attribute
          // is never silently dropped, which would make debugging easier and prevents
          // edge cases where the attribute disappears entirely.
          return { 'data-sources': attributes.sources || '' };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'sup[data-type="source-tag"]',
      },
      {
        // Fallback: match any <sup> with data-sources attribute
        tag: 'sup[data-sources]',
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const sources = node.attrs.sources || HTMLAttributes['data-sources'] || '';
    return ['sup', mergeAttributes(HTMLAttributes, {
      'data-type': 'source-tag',
      'data-sources': sources,
      'class': 'source-tag',
    }), sources];
  },
});
