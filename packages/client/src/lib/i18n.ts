import zh from '@/locales/zh'
import en from '@/locales/en'
import { useI18nStore, type Language } from '@/stores/i18nStore'
import type { LocalizedText } from '@coeditor/shared'

type Dict = Record<string, string>

const dictionaries: Record<Language, Dict> = { zh, en }

/** 合并一组插件的语言字典（插件 key 以 plugin.<id>. 为前缀） */
export function mergeDictionaries(zhDict: Dict, enDict: Dict): void {
  Object.assign(dictionaries.zh, zhDict)
  Object.assign(dictionaries.en, enDict)
}

/** 合并插件列表的 i18n 字典（含 plugin.<id>. 前缀） */
export function mergePluginI18n(pluginList: Array<{ id: string; i18n?: { zh: Dict; en: Dict } }>): void {
  for (const plugin of pluginList) {
    if (!plugin.i18n) continue
    const prefix = `plugin.${plugin.id}.`
    const zh: Dict = {}
    const en: Dict = {}
    for (const [key, value] of Object.entries(plugin.i18n.zh)) zh[prefix + key] = value
    for (const [key, value] of Object.entries(plugin.i18n.en)) en[prefix + key] = value
    mergeDictionaries(zh, en)
  }
}

export function getDictionaries(): Record<Language, Dict> {
  return dictionaries
}

/** 翻译：key 查找当前语言字典，缺失回退中文，再缺失返回 key 本身 */
export function t(key: string, params?: Record<string, string | number>): string {
  const lang = useI18nStore.getState().language
  let str = dictionaries[lang][key] ?? dictionaries.zh[key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.split(`{${k}}`).join(String(v))
    }
  }
  return str
}

/** 组件内使用：订阅语言变化，切换时自动重渲染 */
export function useT(): typeof t {
  useI18nStore((s) => s.language)
  return t
}

/** 模板多语言字段取值：string 原样返回（兼容旧调用），LocalizedText 按当前语言取，缺失回退中文/英文 */
export function localize(value: string | LocalizedText | null | undefined, lang?: Language): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  const current = lang ?? useI18nStore.getState().language
  return value[current] ?? value.zh ?? value.en ?? ''
}
