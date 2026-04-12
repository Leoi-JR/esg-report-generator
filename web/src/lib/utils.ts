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
 * Extract [待补充: xxx] blocks from content
 */
export function extractPendingBlocks(content: string): string[] {
  const regex = /\[待补充[：:][^\]]+\]/g;
  return content.match(regex) || [];
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
 * Get status display info (no emoji — uses CSS pip class names)
 * pipClass: CSS class for the 3×12px vertical pip indicator
 */
export function getStatusDisplay(status: string): { icon: string; color: string; label: string; pipClass: string } {
  switch (status) {
    case 'generated':
      return { icon: '', color: 'text-green-700', label: '已生成', pipClass: 'status-pip pip-green' };
    case 'skipped':
      return { icon: '', color: 'text-warm-4', label: '已跳过', pipClass: 'status-pip pip-gray' };
    case 'reviewed':
      return { icon: '', color: 'text-blue-700', label: '已审核', pipClass: 'status-pip pip-blue' };
    case 'approved':
      return { icon: '', color: 'text-indigo-700', label: '已批准', pipClass: 'status-pip pip-indigo' };
    default:
      return { icon: '', color: 'text-warm-4', label: '未知', pipClass: 'status-pip pip-gray' };
  }
}

/**
 * Truncate text to specified length
 */
export function truncateText(text: string, maxLength: number = 200): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}
