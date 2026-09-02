import { View } from '@tarojs/components'
import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { useT } from '@/lib/i18n'
import { api } from '@/api/client'
import { isDesktopRuntime, pickDataDirectory } from '@/lib/desktop'

interface SettingsWithDataDir {
  dataDir: string
}

/**
 * 数据目录配置区块（设置页内，开源版专属）：
 * 展示/切换服务端数据保存目录（DATA_ROOT）。SaaS 托管版无此概念，不渲染。
 */
export function DataDirSection() {
  const t = useT()
  const [current, setCurrent] = useState('')
  const [path, setPath] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [desktop, setDesktop] = useState(false)

  useEffect(() => {
    setSaved(false)
    setError('')
    setPath('')
    isDesktopRuntime().then(setDesktop).catch(() => setDesktop(false))
    api.rpc<SettingsWithDataDir>('settings.get')
      .then((s) => setCurrent(s.dataDir || ''))
      .catch((err) => {
        console.error('[loadDataDir]', err)
        setError(t('error.loadFailed'))
      })
  }, [t])

  const handlePick = async () => {
    const dir = await pickDataDirectory()
    if (dir) {
      setPath(dir)
      setError('')
    }
  }

  const handleSave = async () => {
    const target = path.trim()
    if (!target) {
      setError(t('settings.dataDirEmpty'))
      return
    }
    setSaving(true)
    setError('')
    try {
      const updated = await api.rpc<SettingsWithDataDir>('settings.update', { dataDir: target })
      setCurrent(updated.dataDir)
      setPath('')
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError((err as Error)?.message || t('error.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <View className="settings-section">
      <View className="settings-section-title">{t('settings.dataDir')}</View>

      <View className="text-sm text-muted" style={{ lineHeight: 1.6 }}>
        {t('settings.dataDirHint')}
      </View>

      <View className="mt-2">
        <View className="text-sm font-medium mb-1">{t('settings.dataDirCurrent')}</View>
        <View
          className="text-xs"
          style={{
            wordBreak: 'break-all',
            padding: '8px 12px',
            background: 'var(--muted)',
            borderRadius: 8,
          }}
        >
          {current || '—'}
        </View>
      </View>

      <View className="mt-3">
        <View className="text-sm font-medium mb-1">{t('settings.dataDirNew')}</View>
        <View className="flex gap-2">
          <View className="flex-1">
            <Input
              placeholder="/path/to/your/data"
              value={path}
              onChange={setPath}
              onEnter={handleSave}
            />
          </View>
          {desktop && (
            <Button variant="outline" size="sm" onClick={handlePick}>
              {t('settings.dataDirPick')}
            </Button>
          )}
        </View>
        <View className="text-xs mt-1 text-muted">{t('settings.dataDirPersistHint')}</View>
      </View>

      {error && <View className="text-sm text-destructive mt-3">{error}</View>}
      {saved && <View className="text-sm mt-3" style={{ color: '#56744d' }}>{t('settings.dataDirSaved')}</View>}

      <View className="flex items-center gap-3 mt-3">
        <Button onClick={handleSave} disabled={saving || !path.trim()}>
          {saving ? t('common.loading') : t('settings.dataDirSave')}
        </Button>
      </View>
    </View>
  )
}
