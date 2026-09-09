import { settingsPlugin } from '@/plugins/settings'
import { userPlugin } from '@/plugins/user'
import type { CoEditorPlugin } from './types'

export const plugins: CoEditorPlugin[] = [settingsPlugin, userPlugin]
