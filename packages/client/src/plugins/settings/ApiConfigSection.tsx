import { ScrollView, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { useT } from '@/lib/i18n'
import { api, buildHeaders } from '@/api/client'
import type { AppSettings } from '@coeditor/shared'
import { cn, isH5 } from '@/lib/utils'

/**
 * AI 接口配置区块（设置页内，BYOK）。
 *
 * 照搬 opencode 的连接逻辑：从 opencode zen 模型目录（服务端代理 /api/models）
 * 按模型前缀归组成“模型提供商”，先选提供商、再选该提供商的模型。
 * - Base URL / API Key 仍是用户自己的（BYOK）；选择带默认网关的提供商时，
 *   若用户未手动改过 Base URL，会自动带出其默认地址（可再改）。
 * - 支持“自定义（OpenAI 兼容）”：手动填任意模型 ID（本地 ollama 等）。
 */
interface ZenCatalog {
  /** 按 zen /models 前缀归组后的提供商列表（含“其他”兜底桶，不含自定义项） */
  groups: ZenProvider[]
  /** 目录里没有前缀映射（无法归组）时，该族落在哪个组 id（可能为 null） */
}
interface ZenProvider {
  id: string
  label: string
  models: string[]
}

const CUSTOM_PROVIDER_ID = '__custom__'
const MISC_PROVIDER_ID = '__zen_misc__'

/** 已知厂商族 → 展示名（zen /models 前缀，按 id 首段匹配） */
const FAMILY_LABELS: Record<string, string> = {
  deepseek: 'DeepSeek',
  gpt: 'OpenAI',
  claude: 'Anthropic Claude',
  gemini: 'Google Gemini',
  grok: 'xAI Grok',
  glm: '智谱 GLM',
  kimi: '月之暗面 Kimi',
  minimax: 'MiniMax',
  qwen3: '通义千问 Qwen',
  nemotron: 'NVIDIA Nemotron',
  muse: 'Muse',
  big: 'Big',
  ling: 'Ling',
  mimo: 'Mimo',
  laguna: 'Laguna',
}

/** 常见 OpenAI 兼容网关的默认 Base URL（仅作自动建议，用户可改）。
 *  键与 zen /models 的族前缀一致（= 提供商下拉的 id），如 openai→gpt、anthropic→claude。 */
const BASE_PRESETS: Record<string, string> = {
  deepseek: 'https://api.deepseek.com/v1',
  gpt: 'https://api.openai.com/v1',
  grok: 'https://api.x.ai/v1',
  glm: 'https://open.bigmodel.cn/api/paas/v4',
  kimi: 'https://api.moonshot.cn/v1',
  minimax: 'https://api.minimaxi.com/v1',
  qwen3: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
}

/** zen /models 的 OpenAI 兼容网关地址（未映射厂商/兜底桶走它） */
const ZEN_BASE_URL = 'https://opencode.ai/zen/v1'

function familyOf(modelId: string): string {
  const m = /^([a-zA-Z0-9]+)[.\-]/.exec(modelId.trim())
  return (m?.[1] ?? modelId.trim()).toLowerCase()
}

function groupZenModels(ids: string[], miscLabel: string): ZenProvider[] {
  const buckets = new Map<string, string[]>()
  const order: string[] = []
  for (const id of ids) {
    const fam = familyOf(id)
    if (!buckets.has(fam)) {
      buckets.set(fam, [])
      order.push(fam)
    }
    buckets.get(fam)!.push(id)
  }
  const groups: ZenProvider[] = []
  for (const fam of order) {
    const models = buckets.get(fam)!
    const label = FAMILY_LABELS[fam]
    if (label) {
      groups.push({ id: fam, label, models })
    } else {
      const misc = groups.find((g) => g.id === MISC_PROVIDER_ID)
      if (misc) misc.models.push(...models)
      else groups.push({ id: MISC_PROVIDER_ID, label: miscLabel, models: [...models] })
    }
  }
  return groups
}

async function fetchZenModels(): Promise<string[]> {
  const res = await Taro.request<{ success: boolean; data?: { models?: string[] }; error?: string }>({
    url: `${API_BASE_URL}/api/models`,
    method: 'GET',
    header: await buildHeaders(),
    timeout: 15_000,
  })
  if (res.statusCode !== 200 || !res.data?.success || !Array.isArray(res.data.data?.models)) {
    throw new Error(res.data?.error || `HTTP ${res.statusCode}`)
  }
  return res.data.data!.models!
}

interface SelectBoxProps {
  value: string
  options: Array<{ value: string; label: string }>
  placeholder?: string
  disabled?: boolean
  onSelect: (value: string) => void
}

/** 设置页内的小下拉（跨端自绘，样式对齐 .input） */
function SelectBox({ value, options, placeholder, disabled, onSelect }: SelectBoxProps) {
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)

  return (
    <View className="sel" style={{ position: 'relative' }}>
      <View
        className={cn('sel-trigger', disabled && 'sel-disabled')}
        onClick={() => !disabled && setOpen((v) => !v)}
      >
        <View className="flex-1" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {current?.label ?? placeholder ?? ''}
        </View>
        <Icon name="chevronDown" size={isH5() ? 16 : 22} color="var(--muted-fg)" />
      </View>

      {open && (
        <>
          {/* 点击外部关闭 */}
          <View
            className="sel-mask"
            onClick={() => setOpen(false)}
          />
          <View className="sel-pop">
            <ScrollView scrollY className="sel-pop-scroll">
              {options.map((o) => (
                <View
                  key={o.value}
                  className={cn('sel-opt', o.value === value && 'sel-opt-on')}
                  onClick={() => {
                    onSelect(o.value)
                    setOpen(false)
                  }}
                >
                  <View className="flex-1" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {o.label}
                  </View>
                  {o.value === value && <Icon name="✓" size={isH5() ? 14 : 20} color="var(--accent-warm)" />}
                </View>
              ))}
            </ScrollView>
          </View>
        </>
      )}
    </View>
  )
}

export function ApiConfigSection() {
  const t = useT()
  const [settings, setSettings] = useState<AppSettings>({
    apiKey: '',
    apiBaseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-flash',
    style: 'gentle',
    showThinking: true,
  })
  const [saved, setSaved] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [apiKeyDirty, setApiKeyDirty] = useState(false)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // opencode zen 模型目录
  const [catalogIds, setCatalogIds] = useState<string[]>([])
  const [catalogState, setCatalogState] = useState<'loading' | 'ok' | 'failed'>('loading')
  const baseUrlTouchedRef = useRef(false)

  // 提供商选项 = zen 归组 + 自定义（OpenAI 兼容）
  const groups = useMemo(
    () => groupZenModels(catalogIds, t('apiConfig.providerZenMisc')),
    [catalogIds, t],
  )
  const providerOptions = useMemo(
    () => [
      ...groups.map((g) => ({ value: g.id, label: g.label })),
      { value: CUSTOM_PROVIDER_ID, label: t('apiConfig.providerCustom') },
    ],
    [groups, t],
  )

  const loadCatalog = async () => {
    setCatalogState('loading')
    try {
      const ids = await fetchZenModels()
      setCatalogIds(ids)
      setCatalogState('ok')
    } catch (err) {
      console.warn('[zenModels] load failed:', err)
      setCatalogState('failed')
    }
  }

  // 当前选中的提供商。null = 尚未显式选择：由 settings.model 的族归属推导一次后固定。
  const [providerId, setProviderId] = useState<string | null>(null)

  useEffect(() => {
    if (catalogState === 'ok' && providerId === null) {
      const fam = familyOf(settings.model)
      const g = groups.find((x) => x.id === fam || x.models.includes(settings.model))
      setProviderId(g?.id ?? CUSTOM_PROVIDER_ID)
    }
  }, [catalogState, groups, settings.model, providerId])

  const activeProviderId = providerId ?? CUSTOM_PROVIDER_ID

  useEffect(() => {
    api.rpc<AppSettings>('settings.get')
      .then((s) => { setSettings(s); setApiKeyDirty(false) })
      .catch((err) => { console.error('[loadSettings]', err); setLoadError(true) })
    void loadCatalog()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    }
  }, [])

  const handlePickProvider = (id: string) => {
    setProviderId(id)
    if (id === CUSTOM_PROVIDER_ID) return
    const group = groups.find((g) => g.id === id)
    if (!group) return

    setSettings((prev) => {
      const next = { ...prev }
      // 模型：同族未换（含列表外旧 id）则不打扰；否则落到该族第一个模型
      const belongs = prev.model && (familyOf(prev.model) === id || group.models.includes(prev.model))
      if (!belongs && group.models.length > 0) next.model = group.models[0]

      // Base URL：用户没手动改过时才自动建议默认网关地址
      if (!baseUrlTouchedRef.current) {
        const preset = BASE_PRESETS[id] ?? ZEN_BASE_URL
        const prevPreset = BASE_PRESETS[familyOf(prev.model)]
        if (preset && (!prev.apiBaseUrl || prev.apiBaseUrl === prevPreset)) {
          next.apiBaseUrl = preset
        }
      }
      return next
    })
  }

  const saveSettings = async () => {
    try {
      // Only send apiKey if user actually modified it (avoid masked key round-trip)
      // 不提交 style/showThinking：它们由齿轮菜单的 settingsStore 负责持久化，
      // 这里若回传加载时的旧值会覆盖用户在菜单里的新选择。
      const payload: Partial<AppSettings> = {
        apiBaseUrl: settings.apiBaseUrl,
        model: settings.model,
      }
      if (apiKeyDirty) payload.apiKey = settings.apiKey
      const updated = await api.rpc<AppSettings>('settings.update', payload)
      setSettings(updated)
      setApiKeyDirty(false)
      setSaved(true)
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      console.error('[saveSettings]', err)
      Taro.showToast({ title: t('error.saveFailed'), icon: 'none' })
    }
  }

  const isCustom = activeProviderId === CUSTOM_PROVIDER_ID

  return (
    <View className="settings-section">
      <View className="settings-section-title">{t('apiConfig.title')}</View>

      {/* 模型提供商 */}
      <View className="text-sm font-medium mb-1">{t('apiConfig.provider')}</View>
      {catalogState === 'loading' ? (
        <View className="text-xs text-muted" style={{ padding: '10px 0' }}>{t('apiConfig.modelsLoading')}</View>
      ) : catalogState === 'failed' ? (
        <View className="flex items-center gap-3">
          <View className="text-xs text-muted flex-1">{t('apiConfig.modelsLoadFailed')}</View>
          <Button variant="outline" size="sm" onClick={loadCatalog}>{t('common.retry')}</Button>
        </View>
      ) : (
        <SelectBox
          value={activeProviderId}
          options={providerOptions}
          onSelect={handlePickProvider}
        />
      )}

      {/* 模型：已知提供商 → 下拉；自定义 → 手动输入 */}
      <View className="mt-3">
        <View className="text-sm font-medium mb-1">{t('apiConfig.model')}</View>
        {isCustom || catalogState !== 'ok' ? (
          <>
            <Input
              placeholder="deepseek-chat"
              value={settings.model}
              onChange={(v) => setSettings({ ...settings, model: v })}
            />
            <View className="text-xs mt-1 text-muted">{t('apiConfig.modelManualHint')}</View>
          </>
        ) : (
          <>
            <SelectBox
              value={settings.model}
              options={(groups.find((g) => g.id === activeProviderId)?.models ?? []).map((m) => ({ value: m, label: m }))}
              placeholder={t('apiConfig.chooseModel')}
              onSelect={(m) => setSettings({ ...settings, model: m })}
            />
            <View className="text-xs mt-1 text-muted">{t('apiConfig.modelHint')}</View>
          </>
        )}
      </View>

      <View className="mt-3">
        <View className="text-sm font-medium mb-1">{t('apiConfig.apiKey')}</View>
        <Input
          type="password"
          placeholder="sk-..."
          value={settings.apiKey}
          onChange={(v) => { setSettings({ ...settings, apiKey: v }); setApiKeyDirty(true) }}
        />
        <View className="text-xs mt-1 font-semibold text-muted">{t('apiConfig.keyHint')}</View>
      </View>

      <View className="mt-3">
        <View className="text-sm font-medium mb-1">{t('apiConfig.apiBaseUrl')}</View>
        <Input
          placeholder="https://api.deepseek.com/v1"
          value={settings.apiBaseUrl}
          onChange={(v) => { baseUrlTouchedRef.current = true; setSettings({ ...settings, apiBaseUrl: v }) }}
        />
        <View className="text-xs mt-1 text-muted">{t('apiConfig.baseUrlHint')}</View>
      </View>

      {loadError && <View className="text-sm text-destructive mt-3">{t('error.loadFailed')}</View>}

      <View className="flex items-center gap-3 mt-3">
        <Button onClick={saveSettings} disabled={loadError}>
          <View>{t('apiConfig.save')}</View>
        </Button>
        {saved && <View className="text-sm" style={{ color: '#56744d' }}>{t('apiConfig.saved')}</View>}
      </View>
    </View>
  )
}
