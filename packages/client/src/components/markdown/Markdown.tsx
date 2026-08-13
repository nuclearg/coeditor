import { View } from '@tarojs/components'
import { memo } from 'react'
import { marked } from 'marked'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { sanitizeHtml } from '@/lib/sanitize'

marked.setOptions({
  gfm: true,
  breaks: true,
})

/**
 * Markdown 渲染 — 双端：
 * - H5：react-markdown（完整 GFM + 表格），样式见 .md-content
 * - 小程序：marked 转 HTML + 白名单重建净化（见 lib/sanitize.ts，只重建
 *   白名单内的标签/属性，其余结构性丢弃）后渲染
 *
 * memo：流式输出时每个 chunk 都会触发父级重渲染，已完成的回答内容不变，
 * 跳过重渲染可避免对整条消息重复解析 Markdown。
 */
export const Markdown = memo(function Markdown({ content }: { content: string }) {
  if (process.env.TARO_ENV === 'h5') {
    return (
      <View className="md-content">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </View>
    )
  }

  const html = sanitizeHtml(marked.parse(content, { async: false }) as string)
  return (
    <View className="md-content" dangerouslySetInnerHTML={{ __html: html }} />
  )
})
