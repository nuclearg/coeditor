import type { CoEditorPlugin } from '@/plugin'
import { t } from '@/lib/i18n'
import { useDataDirStore } from './store'
import { DataDirDialog } from './DataDirDialog'

/**
 * 数据目录设置插件（开源版专属）。
 *
 * SaaS 托管版没有"本地数据目录"概念，不注册本插件即可在设置菜单中裁剪掉该入口
 * （服务端的 settings.dataDir RPC 支持也由各自 server 决定）。
 * 仅 H5/桌面端有意义；小程序端选择目录按钮自动隐藏。
 */
export const dataDirPlugin: CoEditorPlugin = {
  id: 'data-dir',
  settings: {
    menuItems: [
      {
        type: 'action',
        label: () => t('settings.dataDir'),
        onClick: () => useDataDirStore.getState().open(),
      },
    ],
  },
  ui: {
    slots: {
      'root': () => <DataDirDialog />,
    },
  },
}
