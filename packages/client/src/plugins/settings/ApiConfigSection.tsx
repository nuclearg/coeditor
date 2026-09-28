import { ScrollView, View } from '@tarojs/components'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { useT } from '@/lib/i18n'
import { showErrorToast } from '@/lib/toast'
import { api } from '@/api/client'
import {
  DEFAULT_LLM_BASE_URL,
  DEFAULT_SETTINGS,
  LLM_PROVIDERS,
  findProviderForModel,
  type AppSettings,
  type LlmProvider,
} from '@coeditor/shared'
import { cn, isWebView } from '@/lib/utils'

/**
 * AI 接口配置区块（设置页内，BYOK）。
 *
 * 数据源是 `@coeditor/shared` 里的**静态预置表**（LLM_PROVIDERS），不再请求
 * 任何在线模型目录：离线/内网/桌面壳都能即时渲染，也不依赖第三方目录服务。
 * 交互仍是「先选提供商、再选该提供商的模型」：
 * - Base URL / API Key 始终是用户自己的（BYOK）；切换提供商时，若用户没手动
 *   改过 Base URL，自动带出该网关的默认地址（可再改）。
 * - 「自定义（OpenAI 兼容）」不带预置模型，全部手填（本地 ollama / 自建网关）。
 * - 已知提供商下也能选「手动输入模型 ID」：预置列表只是常见档位的快捷方式，
 *   厂商模型 ID 变动频繁，最终以厂商文档为准。
 */

/** 「自定义（OpenAI 兼容）」的哨兵 id，不是预置表里的条目 */
const CUSTOM_PROVIDER_ID = '__custom__'
/** 模型下拉里的「手动输入模型 ID」哨兵值 */
const MANUAL_MODEL_ID = '__manual__'

function providerById(id: string): LlmProvider | undefined {
  return LLM_PROVIDERS.find((p) => p.id === id)
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
        <Icon name="chevronDown" size={isWebView() ? 16 : 22} color="var(--muted-fg)" />
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
                  {o.value === value && <Icon name="✓" size={isWebView() ? 14 : 20} color="var(--accent-warm)" />}
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
  const [settings, setSettings] = useState<AppSettings>({ ...DEFAULT_SETTINGS })
  const [saved, setSaved] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [apiKeyDirty, setApiKeyDirty] = useState(false)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 用户显式选择过的提供商。null = 还没选：此时由已保存的 model **推导**（见
  // activeProviderId），而不是写回 state。这样无需「等 settings.get 回来再同步」，
  // 也不会出现「先把默认模型推导成提供商、用户已保存的模型再也映射不回去」的竞态。
  const [pickedProviderId, setPickedProviderId] = useState<string | null>(null)
  // 模型是否走手填（自定义提供商固定手填；预置提供商可切到「手动输入模型 ID」）
  const [modelManual, setModelManual] = useState(false)
  // Base URL 是否被用户手动改过：改过就不再自动跟随提供商预设
  const baseUrlTouchedRef = useRef(false)

  const activeProviderId = pickedProviderId ?? findProviderForModel(settings.model)?.id ?? CUSTOM_PROVIDER_ID
  const activeProvider = providerById(activeProviderId)

  useEffect(() => {
    api.rpc<AppSettings>('settings.get')
      .then((s) => { setSettings(s); setApiKeyDirty(false) })
      .catch((err) => { console.error('[loadSettings]', err); setLoadError(true) })
  }, [])

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    }
  }, [])

  const providerOptions = useMemo(
    () => [
      ...LLM_PROVIDERS.map((p) => ({ value: p.id, label: p.label })),
      { value: CUSTOM_PROVIDER_ID, label: t('apiConfig.providerCustom') },
    ],
    [t],
  )

  /** 切换提供商：同步 Base URL 与模型 */
  const handlePickProvider = (id: string) => {
    setPickedProviderId(id)
    setModelManual(false)

    if (id === CUSTOM_PROVIDER_ID) {
      // 自定义网关：只动 Base URL（若用户没手动改过），模型留给用户填
      if (!baseUrlTouchedRef.current) {
        setSettings((prev) => ({ ...prev, apiBaseUrl: DEFAULT_LLM_BASE_URL }))
      }
      return
    }

    const provider = providerById(id)
    if (!provider) return

    setSettings((prev) => {
      const next = { ...prev }
      // 模型：同族不打扰（含列表外的旧 ID / 手填 ID）；否则落到该族第一个预置模型
      const belongs = findProviderForModel(prev.model)?.id === provider.id
      if (!belongs && provider.models.length > 0) next.model = provider.models[0]

      // Base URL：用户没手动改过时才自动建议该网关默认地址
      if (!baseUrlTouchedRef.current) {
        next.apiBaseUrl = provider.defaultBaseUrl
      }
      return next
    })
  }

  const handlePickModel = (value: string) => {
    if (value === MANUAL_MODEL_ID) {
      setModelManual(true)
      return
    }
    setSettings((prev) => ({ ...prev, model: value }))
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
      showErrorToast(t('error.saveFailed'))
    }
  }

  const isCustom = activeProviderId === CUSTOM_PROVIDER_ID
  const presetModels = activeProvider?.models ?? []
  // 自定义提供商、或用户选了「手动输入模型 ID」、或该提供商暂无预置模型 → 手填
  const manualModel = isCustom || modelManual || presetModels.length === 0
  const modelOptions = [
    { value: MANUAL_MODEL_ID, label: t('apiConfig.modelManualOption') },
    ...presetModels.map((m) => ({ value: m, label: m })),
    // 已保存/手填的模型不在预置列表里时补进下拉，否则触发器会退回占位文案
    ...(settings.model && !presetModels.includes(settings.model)
      ? [{ value: settings.model, label: settings.model }]
      : []),
  ]

  return (
    <View className="settings-section">
      <View className="settings-section-title">{t('apiConfig.title')}</View>

      {/* 模型提供商 */}
      <View className="text-sm font-medium mb-1">{t('apiConfig.provider')}</View>
      <SelectBox
        value={activeProviderId}
        options={providerOptions}
        onSelect={handlePickProvider}
      />
      <View className="text-xs mt-1 text-muted">{t('apiConfig.providerHint')}</View>

      {/* 模型：预置提供商 → 下拉（含手填项）；自定义 → 直接手填 */}
      <View className="mt-3">
        <View className="text-sm font-medium mb-1">{t('apiConfig.model')}</View>
        {manualModel ? (
          <>
            <Input
              placeholder="deepseek-chat"
              value={settings.model}
              onChange={(v) => setSettings({ ...settings, model: v })}
            />
            <View className="text-xs mt-1 text-muted">
              {isCustom ? t('apiConfig.modelManualHint') : t('apiConfig.modelHint')}
            </View>
          </>
        ) : (
          <>
            <SelectBox
              value={settings.model}
              options={modelOptions}
              placeholder={t('apiConfig.chooseModel')}
              onSelect={handlePickModel}
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
