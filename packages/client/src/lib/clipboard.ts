/**
 * 复制文本到剪贴板 —— 双端适配，并顺手抹掉框架自带的**原生**提示。
 *
 * ## 为什么不能直接用 `Taro.setClipboardData`
 * 它两个端都会弹一个"我们管不着"的原生提示，与主题化提示冲突：
 * - **H5**：Taro 的实现里**内置**了一次 `showToast({ title: '内容已复制' })`
 *   （写死在 @tarojs/taro-h5 的 api/device/clipboard 里）。调用方再弹自己的主题化提示，
 *   就会出现**两层提示叠在一起**（实测：页面同时存在 `.taro__toast` 与我们自己的 `.toast-panel`）；
 * - **小程序**：走 `wx.setClipboardData`，微信自带系统提示"内容已复制"且**无法关闭**。
 *   这一条只能接受，所以小程序端不再叠我们的提示——否则同样是两层。
 *
 * 于是分工：H5 用浏览器剪贴板自己写、由我们弹主题化提示；小程序保留系统提示、不再自弹。
 */

import Taro from '@tarojs/taro'
import { showToast } from '@/lib/toast'
import { isWebView } from '@/lib/utils'

/**
 * 复制文本。
 *
 * @param text 要复制的文本
 * @param toastMessage 传入时，**H5 端**复制成功后弹这条主题化提示
 *   （小程序端忽略：微信的系统提示已经告诉用户了，见文件头注释）
 * @returns 是否复制成功；失败静默，调用方可自行决定要不要提示
 */
export async function copyText(text: string, toastMessage?: string): Promise<boolean> {
  if (!isWebView()) {
    try {
      await Taro.setClipboardData({ data: text })
      return true
    } catch {
      // 小程序 setClipboardData 极少失败；失败交给调用方（这里不弹提示，避免与系统提示混淆）
      return false
    }
  }

  const ok = await writeClipboard(text)
  if (ok && toastMessage) showToast(toastMessage)
  return ok
}

/**
 * H5 写剪贴板：优先异步 Clipboard API（需安全上下文 https / localhost），
 * 失败（老浏览器、无权限、非安全上下文）再回退 `execCommand('copy')`。
 */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 落到下面的 execCommand 兜底
  }

  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.readOnly = true
    // 必须真的挂进 DOM 才能 select()：`display: none` 的元素选不中，故挪到视口外
    textarea.style.position = 'fixed'
    textarea.style.top = '-1000px'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    textarea.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    textarea.remove()
    return ok
  } catch {
    return false
  }
}
