import { View } from '@tarojs/components'
import { useEffect, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { useT } from '@/lib/i18n'
import { api } from '@/api/client'
import { isDesktopRuntime, pickDataDirectory } from '@/lib/desktop'
import { useDataDirStore } from './store'

interface SettingsWithDataDir {
  dataDir: string
}

/**
 * 数据目录设置（开源版核心，随 data-dir 插件提供）：
 * - 展示当前数据保存目录（服务端 DATA_ROOT）
 * - 输入/选择新目录后调用 settings.update({ dataDir })：服务端立即切换存储根目录，
 *   并把偏好持久化（平台默认数据目录内的 data-dir.json，仅手工改成非默认目录时生成）
 * - 桌面壳（Tauri）内提供系统文件夹选择器
 */
export function DataDirDialog() {
  const t = useT()
  const { openDialog, close } = useDataDirStore()
  const [current, setCurrent] = useState('')
  const [path, setPath] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [desktop, setDesktop] = useState(false)

  useEffect(() => {
    if (!openDialog) return
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
  }, [openDialog, t])

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
    <Dialog
      open={openDialog}
      title={
        <>
          <Icon name="file" size={30} color="var(--muted-fg)" />
          <View>{t('settings.dataDir')}</View>
        </>
      }
      onClose={close}
    >
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
      {saved && (
        <View className="text-sm mt-3" style={{ color: '#56744d' }}>
          {t('settings.dataDirSaved')}
        </View>
      )}

      <View className="flex items-center gap-3 mt-3">
        <Button onClick={handleSave} disabled={saving || !path.trim()}>
          {saving ? t('common.loading') : t('settings.dataDirSave')}
        </Button>
      </View>
    </Dialog>
  )
}
