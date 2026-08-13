import type { CoEditorPlugin } from '@/plugin'
import { t } from '@/lib/i18n'
import { useApiConfigStore } from './store'
import { ApiConfigDialog } from './ApiConfigDialog'

export const apiConfigPlugin: CoEditorPlugin = {
  id: 'api-config',
  settings: {
    menuItems: [
      {
        type: 'action',
        label: () => t('settings.apiConfig'),
        onClick: () => useApiConfigStore.getState().open(),
      },
    ],
  },
  ui: {
    slots: {
      'root': () => <ApiConfigDialog />,
    },
  },
}
