/**
 * 内置「模型提供商」预置表（BYOK 设置页的数据源）。
 *
 * 定位：纯静态、离线可用，不依赖任何第三方目录服务（此前是 opencode zen
 * 的在线模型目录，现已移除）。用户仍可自填 Base URL / API Key / 模型 ID。
 *
 * 约定：所有网关都必须兼容 OpenAI 的 `POST {baseUrl}/chat/completions`
 * （服务端 ai.chat 只会按这个形状发请求），因此：
 * - Anthropic / Gemini 用的是官方「OpenAI 兼容层」地址，不是原生 API；
 * - `defaultBaseUrl` 不要再带 `/chat/completions` 后缀。
 *
 * 维护提示：模型 ID 由各厂商高频变更（增删、改名、下线），这里的列表只求
 * 「开箱可选中常见档位」，不追求穷尽。用户可在设置页手动填入任意模型 ID，
 * 厂商控制台 / 官方文档才是最终依据。
 */

/** 模型提供商预置（全部走 OpenAI 兼容网关） */
export interface LlmProvider {
  /** 稳定标识，落库不进 settings，仅前端使用 */
  id: string
  /** 展示名（厂商名，不翻译） */
  label: string
  /** OpenAI 兼容网关地址，已含版本段，但不含 /chat/completions */
  defaultBaseUrl: string
  /** 常见模型 ID（按「强 → 快」大致排序，第一个为选中该提供商时的默认值） */
  models: string[]
  /** 申请 Key 的控制台，设置页给出链接 */
  consoleUrl?: string
}

/**
 * 预置提供商（国内外常见网关）。
 *
 * 想裁剪：直接删条目即可，前端只按本数组渲染；
 * 想新增：加一条，id 唯一、base URL 兼容 OpenAI 即可。
 */
export const LLM_PROVIDERS: LlmProvider[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    consoleUrl: 'https://platform.openai.com/api-keys',
    models: ['gpt-5.2', 'gpt-5.2-pro', 'gpt-5.2-mini', 'gpt-5.2-nano'],
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    // 官方 OpenAI 兼容层（原生 /v1/messages 与这里的请求体不同，不要用）
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    consoleUrl: 'https://platform.claude.com/settings/keys',
    models: ['claude-opus-4-8', 'claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    // 官方 OpenAI 兼容层；原生 generateContent 不兼容
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    consoleUrl: 'https://aistudio.google.com/apikey',
    models: ['gemini-3.1-pro-preview', 'gemini-3.1-flash-live-preview', 'gemini-2.5-pro', 'gemini-2.5-flash'],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    consoleUrl: 'https://platform.deepseek.com/api_keys',
    models: ['deepseek-v4-pro', 'deepseek-flash'],
  },
  {
    id: 'qwen',
    label: '通义千问 Qwen',
    // 阿里云百炼 OpenAI 兼容模式（北京地域）
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    consoleUrl: 'https://bailian.console.aliyun.com/',
    models: ['qwen3.8-max', 'qwen3.7-plus', 'qwen3.8-flash'],
  },
  {
    id: 'kimi',
    label: '月之暗面 Kimi',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    consoleUrl: 'https://platform.kimi.com/console/api-keys',
    models: ['kimi-k3', 'kimi-k2.7-code', 'kimi-k2.7-code-highspeed', 'kimi-k2.6'],
  },
  {
    id: 'glm',
    label: '智谱 GLM',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    consoleUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
    models: ['glm-5.3', 'glm-5.2', 'glm-4.6'],
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    defaultBaseUrl: 'https://api.minimaxi.com/v1',
    consoleUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    models: ['MiniMax-M3.1-Flash-Preview', 'MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-M2.7-highspeed'],
  },
  {
    id: 'xai',
    label: 'xAI Grok',
    defaultBaseUrl: 'https://api.x.ai/v1',
    consoleUrl: 'https://console.x.ai/',
    models: ['grok-4.20-reasoning', 'grok-4.20-non-reasoning', 'grok-4-1-fast-reasoning', 'grok-code-fast-1'],
  },
  {
    id: 'mistral',
    label: 'Mistral AI',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    consoleUrl: 'https://console.mistral.ai/api-keys',
    models: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest'],
  },
  {
    id: 'groq',
    label: 'Groq',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    consoleUrl: 'https://console.groq.com/keys',
    models: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'moonshotai/kimi-k2-instruct'],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    // 聚合网关：模型 ID 形如 vendor/model，填别家条目里的全名
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    consoleUrl: 'https://openrouter.ai/settings/keys',
    models: [
      'anthropic/claude-sonnet-4.6',
      'openai/gpt-5.2',
      'google/gemini-3.1-pro-preview',
      'deepseek/deepseek-chat',
    ],
  },
  {
    id: 'siliconflow',
    label: '硅基流动 SiliconFlow',
    defaultBaseUrl: 'https://api.siliconflow.cn/v1',
    consoleUrl: 'https://cloud.siliconflow.cn/account/ak',
    models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen3-235B-A22B-Instruct-2507', 'moonshotai/Kimi-K2-Instruct'],
  },
  {
    id: 'volcengine',
    label: '火山方舟 豆包',
    // 方舟的 OpenAI 兼容路径固定带 /api/v3
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    consoleUrl: 'https://console.volcengine.com/ark',
    models: ['doubao-seed-1-6', 'doubao-1-5-pro-32k'],
  },
  {
    id: 'ollama',
    label: 'Ollama（本地）',
    defaultBaseUrl: 'http://localhost:11434/v1',
    models: ['qwen3:8b', 'llama3.2:3b', 'deepseek-r1:7b'],
  },
  {
    id: 'vllm',
    label: 'vLLM / LM Studio（本地）',
    defaultBaseUrl: 'http://localhost:8000/v1',
    models: [],
  },
]

/**
 * 兜底网关（「自定义（OpenAI 兼容）」+ 迁移期无预设的旧模型 ID 推导用）。
 * 千问 / Kimi / GLM / MiniMax 与 DeepSeek 同族前缀（qwen…/kimi…/glm…/MiniMax…），
 * 按前缀能命中各自条目；这里只覆盖真正无归属的旧 ID。
 */
export const DEFAULT_LLM_BASE_URL = 'https://api.openai.com/v1'

/**
 * 按模型 ID 前缀推导所属预置提供商（大小写不敏感）。
 * 用于把「已保存的 model」映射回提供商下拉：先精确匹配模型列表，再退化为前缀匹配。
 */
export function findProviderForModel(modelId: string): LlmProvider | undefined {
  const id = modelId.trim()
  if (!id) return undefined
  const exact = LLM_PROVIDERS.find((p) => p.models.includes(id))
  if (exact) return exact
  const lower = id.toLowerCase()
  // 前缀表按「最长前缀优先」排，避免 MiniMax 之类被更短的前缀抢走
  const prefixes: Array<[string, string]> = [
    ['claude', 'anthropic'],
    ['gemini', 'gemini'],
    ['deepseek', 'deepseek'],
    ['qwen', 'qwen'],
    ['kimi', 'kimi'],
    ['moonshot', 'kimi'],
    ['glm', 'glm'],
    ['minimax', 'minimax'],
    ['grok', 'xai'],
    ['mistral', 'mistral'],
    ['llama', 'groq'],
    ['gpt', 'openai'],
    ['o1', 'openai'],
    ['o3', 'openai'],
    ['o4', 'openai'],
  ]
  for (const [prefix, providerId] of prefixes) {
    if (lower.startsWith(prefix)) return LLM_PROVIDERS.find((p) => p.id === providerId)
  }
  return undefined
}
