/**
 * llm-config.ts
 * =============
 * Web 端 LLM API 的集中配置。
 *
 * 所有 API 路由（AI 助手、Playground 等）统一引用此模块，
 * 避免在各路由中重复硬编码环境变量读取和 URL 拼接逻辑。
 *
 * 环境变量：
 *   LLM_BASE_URL           — API 地址（默认 DashScope compatible-mode）
 *   LLM_API_KEY            — API 密钥（回退到 DASHSCOPE_API_KEY）
 *   LLM_MODEL              — 模型名（默认 deepseek-v3.2）
 *   LLM_ENABLE_THINKING    — 是否启用 thinking 模式（默认 true）
 *   LLM_TIMEOUT_MS         — 请求超时毫秒数（默认 300000 = 5 分钟）
 */

export interface LLMConfig {
  /** OpenAI 兼容 base URL（不含 /chat/completions） */
  baseUrl: string;
  /** 完整的 chat completions 端点 */
  chatUrl: string;
  /** API 密钥 */
  apiKey: string;
  /** 模型名称 */
  model: string;
  /** 是否启用 DeepSeek thinking 模式 */
  enableThinking: boolean;
  /** 请求超时（毫秒） */
  timeoutMs: number;
}

/**
 * 获取 LLM 配置。
 *
 * 使用函数而非模块顶层常量，确保在请求时动态读取环境变量，
 * 避免模块加载时 .env.local 尚未注入的问题。
 */
export function getLLMConfig(): LLMConfig {
  const rawBaseUrl = (process.env.LLM_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/, '');

  // 确保 chatUrl 总是 .../v1/chat/completions
  const chatUrl = rawBaseUrl.endsWith('/v1')
    ? `${rawBaseUrl}/chat/completions`
    : `${rawBaseUrl}/v1/chat/completions`;

  // baseUrl 去掉 /v1 后缀（供 OpenAI SDK 等需要纯 base 的场景使用）
  const baseUrl = rawBaseUrl.endsWith('/v1')
    ? rawBaseUrl.slice(0, -3)
    : rawBaseUrl;

  const apiKey = process.env.LLM_API_KEY || process.env.DASHSCOPE_API_KEY || '';
  const model = process.env.LLM_MODEL || 'deepseek-v3.2';

  const enableThinking = (process.env.LLM_ENABLE_THINKING || 'true').toLowerCase() !== 'false';
  const timeoutMs = parseInt(process.env.LLM_TIMEOUT_MS || '300000', 10);

  return { baseUrl, chatUrl, apiKey, model, enableThinking, timeoutMs };
}
