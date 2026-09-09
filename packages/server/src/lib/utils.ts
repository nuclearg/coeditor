import type { DocumentTemplate } from '@coeditor/shared'

export const USER_ID = 'default_user'

export function maskApiKey(key: string): string {
  if (!key) return ''
  if (key.length <= 4) return '****'
  return `${'*'.repeat(key.length - 4)}${key.slice(-4)}`
}

/**
 * Resolve an attachment's display name from its template definition.
 * Shared by attachments.ensure and attachmentDrafts.create's implicit ensure
 * so both creation paths store the same name (multilingual names are stored
 * as the zh baseline; the client renders template names per current locale).
 */
export function resolveAttachmentName(
  template: DocumentTemplate | null,
  type: string,
  fallback: string,
): string {
  const def = template?.attachments.find((a) => a.type === type)
  if (!def) return fallback
  return def.name.zh ?? def.name.en ?? fallback
}
