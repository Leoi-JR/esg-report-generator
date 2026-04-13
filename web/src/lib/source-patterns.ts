/**
 * source-patterns.ts
 * ==================
 * 来源标签 [来源X] 的正则表达式集中定义。
 *
 * 全局唯一的来源标签模式定义，避免在多个文件中硬编码不一致的正则。
 *
 * 支持的格式：
 *   [来源1]         — 单个来源
 *   [来源1,3]       — 逗号分隔（半角）
 *   [来源1，3]      — 逗号分隔（全角）
 *   [来源1-3]       — 范围格式
 *   [来源1,3-5]     — 混合格式
 */

// ── 正则模式（每次使用前需 reset lastIndex 或用 matchAll/replace 而非 exec 循环） ──

/**
 * 匹配 [来源X] 标签并捕获内部内容 — 需要 `.source` 创建新实例以安全循环使用。
 *
 * 捕获组 $1 为标签内部内容（如 "1,3-5"）。
 * 使用 `parseSourceIds()` 解析捕获组为 number[]。
 */
export const SOURCE_TAG_CAPTURE = /\[来源([\d,，\s\-–]+)\]/g;

/**
 * 分割文本中的 [来源X] 标签 — 保留分隔符。
 * 用于 `text.split(SOURCE_TAG_SPLIT)` 得到交替的文本和标签数组。
 */
export const SOURCE_TAG_SPLIT = /(\[来源[\d,，\s\-–]+\])/g;

/**
 * 匹配 [来源X] 标签（不捕获内容）— 用于清理 / 删除。
 * 用于 `text.replace(SOURCE_TAG_STRIP, '')` 移除所有来源标签。
 */
export const SOURCE_TAG_STRIP = /\[来源[\d,，\s\-–]+\]/g;

// ── 解析函数 ──

/**
 * 解析来源标签内容为数字数组。
 *
 * 处理四种格式：
 *   "3"       → [3]
 *   "1,4"     → [1, 4]
 *   "5-6"     → [5, 6]
 *   "2-5, 7"  → [2, 3, 4, 5, 7]
 */
export function parseSourceIds(raw: string): number[] {
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
  return ids;
}
