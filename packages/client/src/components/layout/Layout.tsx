import { View } from '@tarojs/components'
import type { ReactNode } from 'react'
import { Header } from './Header'

interface LayoutProps {
  children: ReactNode
  onNavigateHome?: () => void
}

export function Layout({ children, onNavigateHome }: LayoutProps) {
  return (
    <View className="flex flex-col" style={{ height: '100vh' }}>
      <Header onNavigateHome={onNavigateHome} />
      <View className="flex-1 flex flex-col" style={{ minHeight: 0 }}>
        {children}
      </View>
    </View>
  )
}
