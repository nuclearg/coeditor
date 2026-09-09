import { describe, it, expect } from 'vitest'
import { getCurrentDraft, charCount, cn } from '../utils'

interface Draft {
  id: string
  content: string
}

const drafts: Draft[] = [
  { id: 'd3', content: 'newest' },
  { id: 'd2', content: 'middle' },
  { id: 'd1', content: 'oldest' },
]

describe('getCurrentDraft', () => {
  it('returns the draft pointed to by currentDraftId', () => {
    expect(getCurrentDraft(drafts, 'd2')).toEqual({ id: 'd2', content: 'middle' })
  })

  it('falls back to the first (newest) draft when currentDraftId is missing', () => {
    expect(getCurrentDraft(drafts, 'nope')?.id).toBe('d3')
  })

  it('falls back to the first draft for empty/null currentDraftId', () => {
    expect(getCurrentDraft(drafts, '')?.id).toBe('d3')
    expect(getCurrentDraft(drafts, null)?.id).toBe('d3')
    expect(getCurrentDraft(drafts, undefined)?.id).toBe('d3')
  })

  it('returns undefined for an empty draft list', () => {
    expect(getCurrentDraft([], 'd1')).toBeUndefined()
    expect(getCurrentDraft([], undefined)).toBeUndefined()
  })
})

describe('charCount', () => {
  it('counts non-whitespace characters', () => {
    expect(charCount('a b\nc\t')).toBe(3)
    expect(charCount('')).toBe(0)
  })
})

describe('cn', () => {
  it('joins truthy classes', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b')
  })
})
