import { Text } from '@tarojs/components'

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
  close: '✕',
  file: '📄',
  outline: '☰',
  book: '📖',
  warn: '⚠',
  gear: '⚙',
}

interface IconProps {
  name: keyof typeof ICONS | string
  size?: number
  color?: string
}

export function Icon({ name, size = 28, color }: IconProps) {
  return (
    <Text className="icon" style={{ fontSize: `${size}px`, lineHeight: 1, color: color || 'inherit' }}>
      {ICONS[name] || name}
    </Text>
  )
}
