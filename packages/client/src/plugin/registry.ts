import { apiConfigPlugin } from '@/plugins/api-config'
import { dataDirPlugin } from '@/plugins/data-dir'
import { userPlugin } from '@/plugins/user'
import type { CoEditorPlugin } from './types'

export const plugins: CoEditorPlugin[] = [apiConfigPlugin, dataDirPlugin, userPlugin]
