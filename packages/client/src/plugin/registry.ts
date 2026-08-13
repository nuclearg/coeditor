import { apiConfigPlugin } from '@/plugins/api-config'
import { userPlugin } from '@/plugins/user'
import type { CoEditorPlugin } from './types'

export const plugins: CoEditorPlugin[] = [apiConfigPlugin, userPlugin]
