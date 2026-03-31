import fs from 'fs';
import path from 'path';

/**
 * Prompt 模板加载与渲染工具
 *
 * 模板语法（简化版 Handlebars）：
 *   {{variable}}              - 变量替换
 *   {{#if variable}}...{{/if}} - 条件渲染（变量存在且非空时渲染）
 *   {{#if variable}}...{{else}}...{{/if}} - 条件分支
 */

const PROMPTS_DIR = path.join(process.cwd(), 'src/prompts');

// 缓存已加载的模板（仅生产环境缓存，开发环境每次都重新读取便于调试）
const templateCache = new Map<string, string>();
const isDev = process.env.NODE_ENV === 'development';

/**
 * 加载 prompt 模板文件
 */
export function loadPromptTemplate(name: string): string {
  // 生产环境检查缓存，开发环境跳过缓存
  if (!isDev && templateCache.has(name)) {
    return templateCache.get(name)!;
  }

  const filePath = path.join(PROMPTS_DIR, `${name}.txt`);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Prompt template not found: ${filePath}`);
  }

  const template = fs.readFileSync(filePath, 'utf-8');
  templateCache.set(name, template);

  return template;
}

/**
 * 渲染 prompt 模板
 *
 * @param template - 模板字符串
 * @param variables - 变量对象
 * @returns 渲染后的字符串
 */
export function renderPrompt(template: string, variables: Record<string, string | undefined>): string {
  let result = template;

  // 处理 {{#if variable}}...{{else}}...{{/if}} 条件块
  result = result.replace(
    /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{else\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_match, varName: string, ifContent: string, elseContent: string) => {
      const value = variables[varName];
      return (value && value.trim()) ? ifContent : elseContent;
    }
  );

  // 处理 {{#if variable}}...{{/if}} 条件块（无 else）
  result = result.replace(
    /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_match, varName: string, content: string) => {
      const value = variables[varName];
      return (value && value.trim()) ? content : '';
    }
  );

  // 处理 {{variable}} 变量替换
  result = result.replace(
    /\{\{(\w+)\}\}/g,
    (_match, varName: string) => {
      return variables[varName] || '';
    }
  );

  // 清理多余的空行（条件块移除后可能留下）
  result = result.replace(/\n{3,}/g, '\n\n').trim();

  return result;
}

/**
 * 加载并渲染 prompt
 *
 * @param name - 模板名称（不含 .txt 后缀）
 * @param variables - 变量对象
 * @returns 渲染后的 prompt 字符串
 */
export function buildPrompt(name: string, variables: Record<string, string | undefined>): string {
  const template = loadPromptTemplate(name);
  return renderPrompt(template, variables);
}
