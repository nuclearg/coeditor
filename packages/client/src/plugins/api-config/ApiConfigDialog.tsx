import { View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useState, useRef } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { useT } from '@/lib/i18n'
import { api } from '@/api/client'
import type { AppSettings } from '@coeditor/shared'
import { useApiConfigStore } from './store'
import { useSettingsStore } from '@/stores/settingsStore'

const FALLBACK_MODELS = ['deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner', 'gpt-4o', 'gpt-4o-mini']

interface ZenModel {
  id: string
  object: string
  created: number
  owned_by: string
}

export function ApiConfigDialog() {
  const t = useT()
  const { openDialog, close } = useApiConfigStore()
  const [settings, setSettings] = useState<AppSettings>({
    apiKey: '',
    apiBaseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-pro',
    style: 'gentle',
  })
  const [saved, setSaved] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [apiKeyDirty, setApiKeyDirty] = useState(false)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [zenModels, setZenModels] = useState<string[]>([])

  useEffect(() => {
    if (!openDialog) return
    setSaved(false)
    setLoadError(false)
    api.rpc<AppSettings>('settings.get')
      .then((s) => { setSettings(s); setApiKeyDirty(false) })
      .catch((err) => { console.error('[loadSettings]', err); setLoadError(true) })
  }, [openDialog])

  useEffect(() => {
    if (!openDialog) return
    if (process.env.TARO_ENV !== 'h5') return
    const controller = new AbortController()
    fetch('https://opencode.ai/zen/v1/models', { signal: controller.signal })
      .then((res) => res.json())
      .then((body: { data?: ZenModel[] }) => {
        if (body.data?.length) {
          setZenModels(body.data.map((m) => m.id))
        }
      })
      .catch((err) => {
        if (err.name !== 'AbortError') console.warn('[zenModels] fetch failed, using fallbacks', err)
      })
    return () => controller.abort()
  }, [openDialog])

  const modelSuggestions = zenModels.length > 0 ? zenModels : FALLBACK_MODELS

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    }
  }, [])

  const saveSettings = async () => {
    try {
      // Only send apiKey if user actually modified it (avoid masked key round-trip)
      const payload: Partial<AppSettings> = {
        apiBaseUrl: settings.apiBaseUrl,
        model: settings.model,
        style: settings.style,
      }
      if (apiKeyDirty) payload.apiKey = settings.apiKey
      const updated = await api.rpc<AppSettings>('settings.update', payload)
      setSettings(updated)
      setApiKeyDirty(false)
      setSaved(true)
      useSettingsStore.getState().applyStyle(updated.style)
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      console.error('[saveSettings]', err)
      Taro.showToast({ title: t('error.saveFailed'), icon: 'none' })
    }
  }

  return (
    <Dialog
      open={openDialog}
      title={
        <>
          <Icon name="sparkles" size={30} color="var(--muted-fg)" />
          <View>{t("apiConfig.title")}</View>
        </>
      }
      onClose={close}
    >
      <View>
        <View className="text-sm font-medium mb-1"> {t("apiConfig.model")} </View>
        <Input
          placeholder="deepseek-v4-pro"
          value={settings.model}
          onChange={(v) => setSettings({ ...settings, model: v })}
        />
        <View className="mt-1" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {modelSuggestions.slice(0, 6).map((m) => (
            <View
              key={m}
              className="text-xs text-muted"
              style={{ border: '1px solid var(--border)', borderRadius: 999, padding: '4px 12px' }}
              onClick={() => setSettings({ ...settings, model: m })}
            >
              {m}
            </View>
          ))}
        </View>
      </View>

      <View className="mt-3">
        <View className="text-sm font-medium mb-1"> {t("apiConfig.apiKey")} </View>
        <Input
          type="password"
          placeholder="sk-..."
          value={settings.apiKey}
          onChange={(v) => { setSettings({ ...settings, apiKey: v }); setApiKeyDirty(true) }}
        />
        <View className="text-xs mt-1 font-semibold text-muted">
          {t("apiConfig.keyHint")}
        </View>
      </View>

      <View className="mt-3">
        <View className="text-sm font-medium mb-1"> {t("apiConfig.apiBaseUrl")} </View>
        <Input
          placeholder="https://api.deepseek.com/v1"
          value={settings.apiBaseUrl}
          onChange={(v) => setSettings({ ...settings, apiBaseUrl: v })}
        />
      </View>

      {loadError && (
        <View className="text-sm text-destructive mt-3">{t('error.loadFailed')}</View>
      )}

      <View className="flex items-center gap-3 mt-3">
        <Button onClick={saveSettings} disabled={loadError}>
          <View> {t("apiConfig.save")} </View>
        </Button>
        {saved && (
          <View className="text-sm" style={{ color: '#56744d' }}> {t("apiConfig.saved")} </View>
        )}
      </View>
    </Dialog>
  )
}
