import Taro from '@tarojs/taro'

export function getStorage(key: string): string | null {
  try {
    return Taro.getStorageSync(key) || null
  } catch {
    return null
  }
}

export function setStorage(key: string, value: unknown): void {
  try {
    Taro.setStorageSync(key, value)
  } catch {
    // ignore
  }
}
