export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

/** Count characters, excluding whitespace — the conventional "字数" measure. */
export function charCount(text: string): number {
  return text.replace(/\s/g, '').length
}

export function isH5(): boolean {
  return process.env.TARO_ENV === 'h5'
}

/**
 * Resolve the "current" draft of a draft list: the one pointed to by
 * currentDraftId, falling back to the newest (first) draft. Returns
 * undefined for an empty list.
 */
export function getCurrentDraft<T extends { id: string }>(
  drafts: T[],
  currentDraftId: string | null | undefined,
): T | undefined {
  return drafts.find((d) => d.id === currentDraftId) || drafts[0]
}
