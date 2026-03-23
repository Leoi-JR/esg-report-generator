/**
 * Content Transform Utilities
 *
 * Bidirectional conversion between raw draft content (with [来源X] and [待补充:xxx] markers)
 * and Tiptap-compatible HTML.
 *
 * Source tag patterns in the data:
 *   [来源3]         — single source
 *   [来源1,4]       — comma-separated (no spaces)
 *   [来源1, 8]      — comma-separated (with spaces)
 *   [来源5-6]       — range
 *   [来源2-5, 7]    — mixed range and list
 *   [来源5,6,10]    — multi-digit IDs
 */

/**
 * Normalize source tag inner text to a canonical comma-separated list of individual IDs.
 * Examples:
 *   "3"       → "3"
 *   "1,4"     → "1,4"
 *   "1, 8"    → "1,8"
 *   "5-6"     → "5,6"
 *   "2-5, 7"  → "2,3,4,5,7"
 */
function normalizeSourceIds(raw: string): string {
  // Split by comma (possibly with spaces)
  const parts = raw.split(/[,，]/).map(s => s.trim()).filter(Boolean);
  const ids: number[] = [];

  for (const part of parts) {
    const rangeMatch = part.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      for (let i = start; i <= end; i++) {
        ids.push(i);
      }
    } else {
      const num = parseInt(part, 10);
      if (!isNaN(num)) {
        ids.push(num);
      }
    }
  }

  return ids.join(',');
}

/**
 * Convert raw content (from draft_results.json) to Tiptap-compatible HTML.
 *
 * Transformations:
 * - [来源X] / [来源X,Y] / [来源X-Y] → <sup data-type="source-tag" ...>
 * - [待补充：xxx] → <div data-type="pending-block" ...>
 * - \n\n → paragraph boundaries
 * - \n → <br>
 */
export function contentToTiptapHTML(content: string): string {
  if (!content) return '<p></p>';

  // Escape HTML entities first
  let text = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Replace ALL [来源...] patterns — match digits, commas, hyphens, spaces inside
  text = text.replace(
    /\[来源([\d,，\s\-–]+)\]/g,
    (_match, raw: string) => {
      const normalized = normalizeSourceIds(raw);
      if (!normalized) return _match; // fallback: leave as-is if parsing fails
      return `<sup data-type="source-tag" data-sources="${normalized}" class="source-tag">${normalized}</sup>`;
    }
  );

  // Replace [待补充：xxx] or [待补充:xxx] with pending block nodes
  // These are block-level, so we close the current <p> and reopen after
  text = text.replace(
    /\[待补充[：:]([^\]]+)\]/g,
    (_match, desc: string) => {
      return `\x00PENDING_START\x00${desc}\x00PENDING_END\x00`;
    }
  );

  // Split into paragraphs by double newline
  const paragraphs = text.split('\n\n');
  const htmlParts: string[] = [];

  for (const rawPara of paragraphs) {
    const trimmed = rawPara.trim();
    if (!trimmed) continue;

    // Check if this paragraph contains pending blocks
    if (trimmed.includes('\x00PENDING_START\x00')) {
      // Split around pending block markers
      const segments = trimmed.split(/\x00PENDING_START\x00([^\x00]*)\x00PENDING_END\x00/);
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i].trim();
        if (!seg) continue;
        if (i % 2 === 1) {
          // This is a pending block description (odd indices from the split)
          htmlParts.push(
            `<div data-type="pending-block" data-description="${seg}" class="pending-content">⚠️ 待补充：${seg}</div>`
          );
        } else {
          // Normal text segment
          htmlParts.push(`<p>${seg.replace(/\n/g, '<br>')}</p>`);
        }
      }
    } else {
      // Normal paragraph
      htmlParts.push(`<p>${trimmed.replace(/\n/g, '<br>')}</p>`);
    }
  }

  return htmlParts.join('') || '<p></p>';
}

/**
 * Convert Tiptap HTML back to raw content format (for saving).
 *
 * Reverse transformations:
 * - <sup ...source-tag... data-sources="X,Y"...>...</sup> → [来源X,Y]
 * - <div ...pending-block... data-description="xxx"...>...</div> → [待补充：xxx]
 * - <p>...</p> → text + \n\n
 * - <br> → \n
 * - Strip remaining HTML tags
 */
export function tiptapHTMLToContent(html: string): string {
  if (!html) return '';

  let text = html;

  // Replace source tags back to markers.
  // Strategy: match any <sup> that is a source-tag (has data-type or data-sources or class="source-tag").
  // Extract source IDs from: (1) data-sources attribute, or (2) text content.
  // This is robust against attribute reordering and edge cases where data-sources might be empty.
  text = text.replace(
    /<sup[^>]*(?:data-type="source-tag"|class="source-tag"|data-sources="[^"]*")[^>]*>([^<]*)<\/sup>/g,
    (_match, textContent: string) => {
      // Try to extract from data-sources attribute first
      const dsMatch = _match.match(/data-sources="([^"]*)"/);
      const fromAttr = dsMatch ? dsMatch[1].trim() : '';

      // Fall back to text content if data-sources is empty
      const sourceIds = fromAttr || textContent.trim();

      // Validate: must contain at least one digit
      if (!sourceIds || !/\d/.test(sourceIds)) {
        // Cannot recover source IDs — preserve as plain text to avoid data loss
        return textContent || '';
      }

      return `[来源${sourceIds}]`;
    }
  );

  // Replace pending blocks back to markers — flexible attribute order
  text = text.replace(
    /<div[^>]*data-description="([^"]*)"[^>]*data-type="pending-block"[^>]*>[^<]*<\/div>/g,
    (_match, desc: string) => `[待补充：${desc}]`
  );
  text = text.replace(
    /<div[^>]*data-type="pending-block"[^>]*data-description="([^"]*)"[^>]*>[^<]*<\/div>/g,
    (_match, desc: string) => `[待补充：${desc}]`
  );

  // Replace <br> and <br/> with newline
  text = text.replace(/<br\s*\/?>/g, '\n');

  // Replace block-level elements with double newlines
  text = text.replace(/<\/p>\s*<p[^>]*>/g, '\n\n');
  text = text.replace(/<\/h[1-6]>\s*/g, '\n\n');
  text = text.replace(/<h[1-6][^>]*>/g, '');
  text = text.replace(/<\/blockquote>\s*/g, '\n\n');
  text = text.replace(/<blockquote[^>]*>/g, '');
  text = text.replace(/<\/li>\s*/g, '\n');
  text = text.replace(/<li[^>]*>/g, '');
  text = text.replace(/<\/?[uo]l[^>]*>/g, '\n');

  // Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Clean up excessive newlines
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  return text;
}
