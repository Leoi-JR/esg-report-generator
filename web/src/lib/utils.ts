import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Parse chapter full_path into tree structure
 * e.g., "走进企业 > 公司简介" -> ["走进企业", "公司简介"]
 */
export function parseChapterPath(fullPath: string): string[] {
  return fullPath.split(' > ').map(s => s.trim());
}

/**
 * Extract source tags from content like [来源1], [来源2,3], [来源5-6], etc.
 */
export function extractSourceTags(content: string): string[] {
  const regex = /\[来源([\d,，\s\-–]+)\]/g;
  const matches = content.match(regex) || [];
  const sources: Set<string> = new Set();

  matches.forEach(match => {
    const inner = match.replace(/\[来源|\]/g, '');
    // Split by comma (with optional spaces)
    const parts = inner.split(/[,，]/).map(s => s.trim()).filter(Boolean);
    for (const part of parts) {
      const rangeMatch = part.match(/^(\d+)\s*[-–]\s*(\d+)$/);
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1], 10);
        const end = parseInt(rangeMatch[2], 10);
        for (let i = start; i <= end; i++) {
          sources.add(String(i));
        }
      } else {
        sources.add(part.trim());
      }
    }
  });

  return Array.from(sources).sort((a, b) => Number(a) - Number(b));
}

/**
 * Extract [待补充: xxx] blocks from content
 */
export function extractPendingBlocks(content: string): string[] {
  const regex = /\[待补充[：:][^\]]+\]/g;
  return content.match(regex) || [];
}

/**
 * Convert content to HTML with source tags rendered as clickable elements
 */
export function renderContentWithSourceTags(content: string): string {
  // Replace [来源X] with clickable spans
  let html = content.replace(
    /\[来源([\d,]+)\]/g,
    (match, nums) => {
      const sourceIds = nums.split(',').map((n: string) => n.trim());
      return `<span class="source-tag" data-sources="${sourceIds.join(',')}">[来源${nums}]</span>`;
    }
  );

  // Replace [待补充: xxx] with highlighted blocks
  html = html.replace(
    /\[待补充[：:]([^\]]+)\]/g,
    (match, text) => {
      return `<div class="pending-content">⚠️ [待补充：${text}]</div>`;
    }
  );

  // Convert newlines to paragraphs
  html = html
    .split('\n\n')
    .map(p => p.trim())
    .filter(p => p)
    .map(p => {
      if (p.startsWith('<div class="pending-content">')) {
        return p;
      }
      return `<p>${p.replace(/\n/g, '<br>')}</p>`;
    })
    .join('');

  return html;
}

/**
 * Format score as percentage with progress bar width
 */
export function formatScore(score: number): { percentage: string; width: number } {
  const percentage = (score * 100).toFixed(0);
  const width = Math.min(Math.max(score * 100, 5), 100);
  return { percentage: `${percentage}%`, width };
}

/**
 * Get status icon and color
 */
export function getStatusDisplay(status: string): { icon: string; color: string; label: string } {
  switch (status) {
    case 'generated':
      return { icon: '✅', color: 'text-green-500', label: '已生成' };
    case 'skipped':
      return { icon: '⏭️', color: 'text-gray-400', label: '已跳过' };
    case 'reviewed':
      return { icon: '✓', color: 'text-blue-500', label: '已审核' };
    case 'approved':
      return { icon: '✔', color: 'text-blue-600', label: '已批准' };
    default:
      return { icon: '○', color: 'text-gray-300', label: '未知' };
  }
}

/**
 * Truncate text to specified length
 */
export function truncateText(text: string, maxLength: number = 200): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}
