import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mergePluginI18n, t, localize, getDictionaries } from '../../lib/i18n'
import { useI18nStore } from '../../stores/i18nStore'

// Taro storage mock（i18nStore 初始化会读 localStorage）
vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: () => null,
    setStorageSync: () => {},
    removeStorageSync: () => {},
    request: () => Promise.reject(new Error('mocked')),
  },
}))

beforeEach(() => {
  useI18nStore.setState({ language: 'zh' })
})

describe('mergePluginI18n — 插件字典合并', () => {
  it('合并单个插件字典并加 plugin.<id>. 前缀', () => {
    mergePluginI18n([{ id: 'saas', i18n: { zh: { usage: '用量' }, en: { usage: 'Usage' } } }])
    expect(t('plugin.saas.usage')).toBe('用量')
  })

  it('多插件合并互不覆盖', () => {
    mergePluginI18n([
      { id: 'a', i18n: { zh: { x: 'A中' }, en: { x: 'Aen' } } },
      { id: 'b', i18n: { zh: { y: 'B中' }, en: { y: 'Ben' } } },
    ])
    expect(t('plugin.a.x')).toBe('A中')
    expect(t('plugin.b.y')).toBe('B中')
  })

  it('无 i18n 的插件跳过', () => {
    mergePluginI18n([{ id: 'plain' }])
    expect(t('plugin.plain.any')).toBe('plugin.plain.any')
  })
})

describe('t — 翻译与回退', () => {
  it('当前语言命中', () => {
    useI18nStore.setState({ language: 'en' })
    expect(t('common.save')).toBe('Save')
  })

  it('en 缺失回退 zh（插件 zh-only key）', () => {
    mergePluginI18n([{ id: 'zhonly', i18n: { zh: { k: '中文值' }, en: {} } }])
    useI18nStore.setState({ language: 'en' })
    expect(t('plugin.zhonly.k')).toBe('中文值')
  })

  it('两者都缺失返回 key 本身', () => {
    expect(t('no.such.key')).toBe('no.such.key')
  })

  it('参数替换', () => {
    expect(t('sidebar.wordCount', { n: 120 })).toBe('120字')
    expect(t('drafts.minutesAgo', { n: 5 })).toBe('5分钟前')
  })

  it('语言切换后取新语言', () => {
    useI18nStore.setState({ language: 'en' })
    expect(t('sidebar.wordCount', { n: 3 })).toBe('3 ch')
  })
})

describe('localize — 模板多语言字段', () => {
  it('string 原样返回', () => {
    expect(localize('outline')).toBe('outline')
  })

  it('对象按当前语言取值', () => {
    expect(localize({ zh: '大纲', en: 'Outline' })).toBe('大纲')
    useI18nStore.setState({ language: 'en' })
    expect(localize({ zh: '大纲', en: 'Outline' })).toBe('Outline')
  })

  it('指定语言优先于当前语言', () => {
    useI18nStore.setState({ language: 'zh' })
    expect(localize({ zh: '大纲', en: 'Outline' }, 'en')).toBe('Outline')
  })

  it('缺当前语言回退 zh，再缺回退 en', () => {
    expect(localize({ en: 'Outline' } as never, 'zh')).toBe('Outline')
  })
})

describe('getDictionaries — 字典可见性', () => {
  it('插件字典合并后可见', () => {
    mergePluginI18n([{ id: 'vis', i18n: { zh: { k: '可见' }, en: { k: 'visible' } } }])
    const dicts = getDictionaries()
    expect(dicts.zh['plugin.vis.k']).toBe('可见')
    expect(dicts.en['plugin.vis.k']).toBe('visible')
  })
})
