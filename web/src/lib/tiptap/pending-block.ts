import { Node, mergeAttributes } from '@tiptap/core';

export const PendingBlock = Node.create({
  name: 'pendingBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      description: {
        default: '',
        parseHTML: (element: HTMLElement) => {
          return element.getAttribute('data-description') || '';
        },
        renderHTML: (attributes: Record<string, string>) => {
          if (!attributes.description) return {};
          return { 'data-description': attributes.description };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="pending-block"]',
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const desc = node.attrs.description || HTMLAttributes['data-description'] || '';
    return ['div', mergeAttributes(HTMLAttributes, {
      'data-type': 'pending-block',
      'class': 'pending-content',
      'data-description': desc,
    }), `\u26A0\uFE0F \u5F85\u8865\u5145\uFF1A${desc}`];
  },
});
