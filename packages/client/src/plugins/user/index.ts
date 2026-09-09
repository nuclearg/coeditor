import type { CoEditorPlugin } from '@/plugin'

export const userPlugin: CoEditorPlugin = {
  id: 'user',
  user: {
    get: async () => ({ name: 'default-user' }),
  },
}
