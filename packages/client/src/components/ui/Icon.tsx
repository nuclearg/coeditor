import { Text, View } from '@tarojs/components'
import { isH5 } from '@/lib/utils'

const ICONS: Record<string, string> = {
  menu: '☰',
  plus: '+',
  trash: '✕',
  more: '⋯',
  up: '↑',
  down: '↓',
  edit: '✎',
  chevronRight: '›',
  chevronDown: '⌄',
  chevronLeft: '‹',
  save: '✓',
  sparkles: '✦',
  send: '➤',
  stop: '■',
  refresh: '↻',
  download: '⇩',
  close: '✕',
  file: '📄',
  outline: '☰',
  book: '📖',
  warn: '⚠',
  gear: '⚙',
}

/** Material Design 标准齿轮（settings）图标 path，H5 用 mask 渲染：
 *  Unicode 齿轮（U+2699）在部分平台（macOS 等）默认呈现为 emoji，圆润带辐条像太阳；
 *  SVG 齿轮轮廓清晰，且 mask 背景取 currentColor 可跟随主题文字色。 */
const GEAR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
  '<path d="M19.14,12.94c0.04,-0.3 0.06,-0.61 0.06,-0.94c0,-0.32 -0.02,-0.64 -0.07,-0.94l2.03,-1.58c0.18,-0.14 0.23,-0.41 0.12,-0.61l-1.92,-3.32c-0.12,-0.22 -0.37,-0.29 -0.59,-0.22l-2.39,0.96c-0.5,-0.38 -1.03,-0.7 -1.62,-0.94L14.4,2.81c-0.04,-0.24 -0.24,-0.41 -0.48,-0.41h-3.84c-0.24,0 -0.43,0.17 -0.47,0.41L9.25,5.35C8.66,5.59 8.12,5.92 7.63,6.29L5.24,5.33c-0.22,-0.08 -0.47,0 -0.59,0.22L2.74,8.87C2.62,9.08 2.66,9.34 2.86,9.48l2.03,1.58C4.84,11.36 4.8,11.69 4.8,12s0.02,0.64 0.07,0.94l-2.03,1.58c-0.18,0.14 -0.23,0.41 -0.12,0.61l1.92,3.32c0.12,0.22 0.37,0.29 0.59,0.22l2.39,-0.96c0.5,0.38 1.03,0.7 1.62,0.94l0.36,2.54c0.05,0.24 0.24,0.41 0.48,0.41h3.84c0.24,0 0.44,-0.17 0.47,-0.41l0.36,-2.54c0.59,-0.24 1.13,-0.56 1.62,-0.94l2.39,0.96c0.22,0.08 0.47,0 0.59,-0.22l1.92,-3.32c0.12,-0.22 0.07,-0.47 -0.12,-0.61L19.14,12.94zM12,15.6c-1.98,0 -3.6,-1.62 -3.6,-3.6s1.62,-3.6 3.6,-3.6s3.6,1.62 3.6,3.6S13.98,15.6 12,15.6z"/>' +
  '</svg>'

interface IconProps {
  name: keyof typeof ICONS | string
  size?: number
  color?: string
}

export function Icon({ name, size = 28, color }: IconProps) {
  // H5：齿轮用标准 SVG mask 渲染（跟随 currentColor/传入色）；weapp 微信字体下 U+2699 本就是文本齿轮，保持字符
  if (name === 'gear' && isH5()) {
    const mask = `url("data:image/svg+xml,${encodeURIComponent(GEAR_SVG)}")`
    return (
      <View
        style={{
          width: size,
          height: size,
          background: color || 'currentColor',
          WebkitMaskImage: mask,
          WebkitMaskRepeat: 'no-repeat',
          WebkitMaskPosition: 'center',
          WebkitMaskSize: 'contain',
          maskImage: mask,
          maskRepeat: 'no-repeat',
          maskPosition: 'center',
          maskSize: 'contain',
        }}
      />
    )
  }
  return (
    <Text className="icon" style={{ fontSize: `${size}px`, lineHeight: 1, color: color || 'inherit' }}>
      {ICONS[name] || name}
    </Text>
  )
}
