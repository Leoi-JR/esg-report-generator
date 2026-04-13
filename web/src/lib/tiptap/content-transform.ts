/**
 * Content Transform Utilities
 *
 * Bidirectional conversion between Markdown content (with [来源X] and [待补充:xxx] markers)
 * and Tiptap-compatible HTML.
 *
 * Data format (saved in SQLite/JSON):
 *   - Markdown with custom markers: **bold**, *italic*, [来源1,2], [待补充:xxx]
 *
 * Tiptap format (rendered in editor):
 *   - HTML with custom nodes: <strong>, <em>, <sup data-type="source-tag">, <div data-type="pending-block">
 *
 * Flow:
 *   Load:  Markdown → marked → HTML → Tiptap
 *   Save:  Tiptap → HTML → turndown → Markdown
 */

import { marked } from 'marked';
import TurndownService from 'turndown';
import {
  SOURCE_TAG_CAPTURE,
  parseSourceIds,
} from '../source-patterns';

// =============================================================================
// Constants & Patterns
// =============================================================================

// Placeholder patterns for custom markers (used during conversion)
const SOURCE_PLACEHOLDER_PREFIX = '\x00SOURCE:';
const SOURCE_PLACEHOLDER_SUFFIX = '\x00';
const PENDING_PLACEHOLDER_PREFIX = '\x00PENDING:';
const PENDING_PLACEHOLDER_SUFFIX = '\x00';

// 来源标签正则 — 引用 source-patterns.ts 中的统一定义
const SOURCE_TAG_PATTERN = SOURCE_TAG_CAPTURE;
const PENDING_BLOCK_PATTERN = /\[待补充[：:]([^\]]+)\]/g;

// =============================================================================
// Source Tag Helpers
// =============================================================================

// parseSourceIds — 从 source-patterns.ts 统一导入，不再在此重复定义

/**
 * Generate HTML for source tags. Each source ID becomes a separate <sup> element.
 */
function sourceIdsToHTML(ids: number[]): string {
  return ids.map(id =>
    `<sup data-type="source-tag" data-sources="${id}" class="source-tag">${id}</sup>`
  ).join('');
}

// =============================================================================
// Markdown → HTML (for loading into Tiptap)
// =============================================================================

/**
 * Configure marked for our use case
 */
function configureMarked() {
  // Use synchronous mode and disable features we don't need
  marked.setOptions({
    async: false,
    gfm: true,        // GitHub Flavored Markdown
    breaks: false,    // Don't convert \n to <br> (we handle paragraphs)
  });
}

/**
 * Convert Markdown content to Tiptap-compatible HTML.
 *
 * Process:
 * 1. Protect custom markers ([来源X], [待补充:xxx]) with placeholders
 * 2. Convert Markdown → HTML using marked
 * 3. Restore custom markers as Tiptap custom nodes
 */
export function contentToTiptapHTML(content: string): string {
  if (!content) return '<p></p>';

  configureMarked();

  let text = content;

  // Step 1: Protect [来源X] markers with placeholders (before markdown parsing)
  // Store the parsed IDs in the placeholder
  const sourceMap = new Map<string, number[]>();
  let sourceCounter = 0;
  text = text.replace(SOURCE_TAG_PATTERN, (_match, raw: string) => {
    const ids = parseSourceIds(raw);
    if (ids.length === 0) return _match;
    const key = `${SOURCE_PLACEHOLDER_PREFIX}${sourceCounter}${SOURCE_PLACEHOLDER_SUFFIX}`;
    sourceMap.set(key, ids);
    sourceCounter++;
    return key;
  });

  // Step 2: Protect [待补充:xxx] markers
  const pendingMap = new Map<string, string>();
  let pendingCounter = 0;
  text = text.replace(PENDING_BLOCK_PATTERN, (_match, desc: string) => {
    const key = `${PENDING_PLACEHOLDER_PREFIX}${pendingCounter}${PENDING_PLACEHOLDER_SUFFIX}`;
    pendingMap.set(key, desc);
    pendingCounter++;
    return key;
  });

  // Step 3: Convert Markdown to HTML
  let html = marked.parse(text) as string;

  // Step 4: Restore source tags as custom Tiptap nodes
  sourceMap.forEach((ids, placeholder) => {
    html = html.replace(placeholder, sourceIdsToHTML(ids));
  });

  // Step 5: Restore pending blocks as custom Tiptap nodes
  pendingMap.forEach((desc, placeholder) => {
    const pendingHTML = `<div data-type="pending-block" data-description="${escapeHTML(desc)}" class="pending-content">⚠️ 待补充：${escapeHTML(desc)}</div>`;
    html = html.replace(placeholder, pendingHTML);
  });

  // Step 6: Clean up empty paragraphs and ensure valid HTML
  html = html.trim();
  if (!html) return '<p></p>';

  return html;
}

/**
 * Convert raw text (e.g., AI response) to HTML for insertion.
 * Handles both Markdown formatting and custom markers.
 */
export function textToBlockHTML(text: string): string {
  if (!text) return '';
  return contentToTiptapHTML(text);
}

// =============================================================================
// HTML → Markdown (for saving from Tiptap)
// =============================================================================

/**
 * Create and configure Turndown service for HTML → Markdown conversion
 */
function createTurndownService(): TurndownService {
  const turndown = new TurndownService({
    headingStyle: 'atx',           // # style headings
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    fence: '```',
    emDelimiter: '*',
    strongDelimiter: '**',
  });

  // Custom rule for source tags: convert back to [来源X] format
  // Adjacent source tags will be merged into [来源1,2,3]
  turndown.addRule('sourceTag', {
    filter: (node): boolean => {
      return node.nodeName === 'SUP' && (
        node.getAttribute('data-type') === 'source-tag' ||
        node.classList?.contains('source-tag') ||
        node.hasAttribute('data-sources')
      );
    },
    replacement: (_content, node): string => {
      const element = node as HTMLElement;
      const sourceId = element.getAttribute('data-sources') || element.textContent || '';
      if (!sourceId || !/\d/.test(sourceId)) return '';
      // Use a special marker that we'll merge later
      return `§SOURCE:${sourceId}§`;
    },
  });

  // Custom rule for pending blocks: convert back to [待补充:xxx] format
  turndown.addRule('pendingBlock', {
    filter: (node): boolean => {
      return node.nodeName === 'DIV' && node.getAttribute('data-type') === 'pending-block';
    },
    replacement: (_content, node): string => {
      const element = node as HTMLElement;
      const desc = element.getAttribute('data-description') || '';
      return `[待补充：${desc}]`;
    },
  });

  // Keep line breaks in a sensible way
  turndown.addRule('lineBreak', {
    filter: 'br',
    replacement: (): string => '\n',
  });

  return turndown;
}

/**
 * Merge adjacent source markers into combined [来源X,Y,Z] format.
 */
function mergeSourceMarkers(text: string): string {
  return text.replace(
    /(§SOURCE:\d+§)+/g,
    (match) => {
      const ids = match.match(/§SOURCE:(\d+)§/g)?.map(m => {
        const idMatch = m.match(/§SOURCE:(\d+)§/);
        return idMatch ? idMatch[1] : '';
      }).filter(Boolean) || [];

      if (ids.length === 0) return match;
      return `[来源${ids.join(',')}]`;
    }
  );
}

/**
 * Convert Tiptap HTML back to Markdown format (for saving).
 *
 * Process:
 * 1. Use Turndown to convert HTML → Markdown
 * 2. Custom rules handle [来源X] and [待补充:xxx] markers
 * 3. Merge adjacent source tags into combined format
 */
export function tiptapHTMLToContent(html: string): string {
  if (!html) return '';

  const turndown = createTurndownService();

  // Convert HTML to Markdown
  let markdown = turndown.turndown(html);

  // Merge adjacent source markers
  markdown = mergeSourceMarkers(markdown);

  // Clean up excessive whitespace
  markdown = markdown
    .replace(/\n{3,}/g, '\n\n')  // Max 2 consecutive newlines
    .trim();

  return markdown;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Escape HTML special characters
 */
function escapeHTML(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
