/**
 * HTML sanitization for the weapp Markdown path (rich-text has no DOM APIs).
 *
 * Defense strategy: whitelist RECONSTRUCTION instead of blacklist stripping.
 * The input is scanned with a tokenizer that follows the WHATWG HTML
 * tokenizer's splitting rules (tag names, attribute names, quoted/unquoted
 * values), so we always see exactly the attributes a browser would see.
 * Only whitelisted tags are re-emitted — rebuilt from scratch with
 * whitelisted, re-escaped attributes — and everything else is structurally
 * dropped (its plain text content is kept, entity-safe). Because output is
 * only ever produced by our own serializer, attribute-injection tricks
 * (`"x"onerror=...`, `/onerror=...`, unlisted URL attributes like
 * `formaction`) cannot survive: they are simply never rebuilt.
 */

const ALLOWED_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'blockquote',
  'ul', 'ol', 'li', 'a', 'code', 'pre', 'strong', 'b', 'em', 'i', 'del', 's',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img',
])

/** Raw-text elements: their content is not HTML and must be dropped whole. */
const RAW_TEXT_TAGS = new Set(['script', 'style'])

/** Void elements: serialized without a closing tag. */
const VOID_TAGS = new Set(['br', 'hr', 'img'])

interface AttrRule {
  /** URL attributes: decoded scheme must be in this list (positive allowlist). */
  protocols?: string[]
  /** Allow URLs without a scheme (relative paths). */
  allowRelative?: boolean
}

/** Per-tag attribute allowlist; any attribute not listed here is dropped. */
const ATTR_SPECS: Record<string, Record<string, AttrRule>> = {
  a: {
    href: { protocols: ['http', 'https', 'mailto'], allowRelative: true },
    title: {},
  },
  img: {
    src: { protocols: ['http', 'https'], allowRelative: false },
    alt: {},
  },
}

const isSpace = (ch: string | undefined) => ch !== undefined && /^[\t\n\f\r ]$/.test(ch)

/** Minimal entity decode for scheme sniffing: numeric + the handful of named
 * entities attackers use to hide ':', whitespace or letters. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  colon: ':', semi: ';', tab: '\t', newline: '\n', num: '#',
}

export function decodeHtmlEntities(value: string): string {
  let out = value
  // Decode repeatedly (bounded) to catch double-encoded payloads like
  // `&amp;#58;` → `&#58;` → `:`.
  for (let i = 0; i < 3; i++) {
    const next = out
      .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => safeFromCode(parseInt(hex, 16)))
      .replace(/&#(\d+);?/g, (_, dec: string) => safeFromCode(parseInt(dec, 10)))
      .replace(/&([a-z]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
    if (next === out) break
    out = next
  }
  return out
}

function safeFromCode(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return ''
  try {
    return String.fromCodePoint(code)
  } catch {
    return ''
  }
}

/** Control chars, whitespace and zero-width chars are ignored by URL parsers
 * inside scheme prefixes (`java\tscript:`), so strip them before checking. */
function stripInvisible(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0020\u007f\u00ad\u200b-\u200f\u2028\u2029\ufeff]/g, '')
}

function normalizeUrl(rawUrl: string): string {
  const unquoted = rawUrl.replace(/^(['"])([\s\S]*)\1$/, '$2')
  return stripInvisible(decodeHtmlEntities(unquoted)).toLowerCase()
}

export function isUnsafeUrl(rawUrl: string): boolean {
  const normalized = normalizeUrl(rawUrl)
  return (
    normalized.startsWith('javascript:') ||
    normalized.startsWith('vbscript:') ||
    normalized.startsWith('data:')
  )
}

const SCHEME_RE = /^([a-z][a-z0-9+.-]*):/

/** Whitelist URL check: after entity decoding + invisible-char stripping the
 * value must either have a scheme in `protocols`, or (if `allowRelative`)
 * have no scheme at all. Anything else is rejected — no blacklist involved. */
export function isAllowedUrl(
  rawUrl: string,
  protocols: string[],
  allowRelative: boolean,
): boolean {
  const m = SCHEME_RE.exec(normalizeUrl(rawUrl))
  if (!m) return allowRelative
  return protocols.includes(m[1])
}

/** Escape text while preserving well-formed entity references (marked emits
 * `&amp;`/`&lt;` etc. for markdown content; double-escaping them would break
 * rendering equivalence with the H5 path). */
function escapeText(text: string): string {
  return text
    .replace(/&(?!(?:#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);)/gi, '&amp;')
    .replace(/</g, '&lt;')
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;')
}

type ParsedConstruct =
  | { kind: 'open'; name: string; attrs: Map<string, string>; end: number }
  | { kind: 'close'; name: string; end: number }
  | { kind: 'junk'; end: number } // comments / doctype / PIs: dropped whole

/**
 * Parse one construct starting at html[pos] (which must be '<'), following
 * the WHATWG tokenizer's splitting decisions:
 * - tag name consumes everything until whitespace / '/' / '>' (so
 *   `<scr<script>` is ONE bogus tag named `scr<script`, like browsers do);
 * - '/' before '>' is a self-close, otherwise just an attribute separator
 *   (so `<img/onerror=x>` exposes the `onerror` attribute, like browsers do);
 * - quoted values run to the matching quote, unquoted to whitespace / '>'.
 * Returns null when no complete construct can be parsed — the caller then
 * emits the '<' as literal (escaped) text. An unterminated quoted value
 * consumes to EOF (tag never emitted), matching browser behavior.
 */
function parseConstruct(html: string, pos: number): ParsedConstruct | null {
  const n = html.length
  if (html.startsWith('<!--', pos)) {
    const end = html.indexOf('-->', pos + 4)
    return { kind: 'junk', end: end === -1 ? n : end + 3 }
  }
  if (html.startsWith('<!', pos) || html.startsWith('<?', pos)) {
    const end = html.indexOf('>', pos + 2)
    return { kind: 'junk', end: end === -1 ? n : end + 1 }
  }
  const closing = html.startsWith('</', pos)
  const nameStart = closing ? pos + 2 : pos + 1
  const first = html[nameStart]
  if (first === undefined || !/[a-zA-Z]/.test(first)) return null
  let j = nameStart + 1
  while (j < n && !/^[\t\n\f\r />]$/.test(html[j])) j++
  const name = html.slice(nameStart, j).toLowerCase()
  if (closing) {
    const end = html.indexOf('>', j)
    if (end === -1) return null
    return { kind: 'close', name, end: end + 1 }
  }
  const attrs = new Map<string, string>()
  let i = j
  while (i <= n) {
    // "Before attribute name": skip whitespace; '/' self-closes only when
    // immediately followed by '>', otherwise it separates attributes.
    while (i < n) {
      const ch = html[i]
      if (isSpace(ch)) { i++; continue }
      if (ch === '/') {
        if (html[i + 1] === '>') return { kind: 'open', name, attrs, end: i + 2 }
        i++
        continue
      }
      break
    }
    if (i >= n) return null
    if (html[i] === '>') return { kind: 'open', name, attrs, end: i + 1 }
    // Attribute name (first occurrence wins, like browsers).
    const nameFrom = i
    while (i < n && !/^[\t\n\f\r />=]$/.test(html[i])) i++
    const attrName = html.slice(nameFrom, i).toLowerCase()
    if (attrName === '') { i++; continue }
    // Optional '=' + value (whitespace allowed around '=').
    let k = i
    while (isSpace(html[k])) k++
    if (html[k] !== '=') {
      if (!attrs.has(attrName)) attrs.set(attrName, '')
      i = k
      continue
    }
    k++
    while (isSpace(html[k])) k++
    const q = html[k]
    let value = ''
    if (q === '"' || q === "'") {
      const close = html.indexOf(q, k + 1)
      if (close === -1) return null // unterminated: browser never emits the tag
      value = html.slice(k + 1, close)
      i = close + 1
    } else if (q === undefined || q === '>') {
      i = k
    } else {
      const vFrom = k
      while (k < n && !/^[\t\n\f\r >]$/.test(html[k])) k++
      value = html.slice(vFrom, k)
      i = k
    }
    // Browsers keep the FIRST occurrence of a duplicate attribute.
    if (!attrs.has(attrName)) attrs.set(attrName, value)
  }
  return null
}

/** Serialize an allowed tag from scratch, keeping only allowed attributes. */
function renderTag(name: string, attrs: Map<string, string>): string {
  if (name === 'img') {
    const src = attrs.get('src')
    if (src === undefined || !isAllowedUrl(src, ['http', 'https'], false)) return ''
  }
  let out = `<${name}`
  const spec = ATTR_SPECS[name]
  if (spec) {
    for (const [attrName, rule] of Object.entries(spec)) {
      const value = attrs.get(attrName)
      if (value === undefined) continue
      if (rule.protocols && !isAllowedUrl(value, rule.protocols, rule.allowRelative ?? false)) continue
      out += ` ${attrName}="${escapeAttr(value)}"`
    }
  }
  return VOID_TAGS.has(name) ? `${out}>` : `${out}>`
}

/** Position just past the closing tag of a raw-text element, or EOF. */
function skipRawText(html: string, from: number, tag: string): number {
  const re = new RegExp(`</${tag}(?=[\\t\\n\\f\\r />])`, 'i')
  const m = re.exec(html.slice(from))
  if (!m) return html.length
  const gt = html.indexOf('>', from + m.index)
  return gt === -1 ? html.length : gt + 1
}

/**
 * Sanitize an HTML fragment by whitelist reconstruction. Disallowed tags are
 * dropped (their plain text survives, escaped); script/style content is
 * dropped whole; only explicitly allowed tags/attributes are rebuilt.
 */
export function sanitizeHtml(html: string): string {
  let out = ''
  let i = 0
  const n = html.length
  while (i < n) {
    const lt = html.indexOf('<', i)
    if (lt === -1) { out += escapeText(html.slice(i)); break }
    if (lt > i) out += escapeText(html.slice(i, lt))
    const parsed = parseConstruct(html, lt)
    if (!parsed) {
      out += '&lt;'
      i = lt + 1
      continue
    }
    i = parsed.end
    if (parsed.kind === 'open') {
      if (RAW_TEXT_TAGS.has(parsed.name)) {
        i = skipRawText(html, i, parsed.name) // drop content whole
      } else if (ALLOWED_TAGS.has(parsed.name)) {
        out += renderTag(parsed.name, parsed.attrs)
      }
      // Non-whitelisted tags: dropped; their content keeps flowing through
      // the main loop and is sanitized recursively.
    } else if (parsed.kind === 'close') {
      if (ALLOWED_TAGS.has(parsed.name)) out += `</${parsed.name}>`
    }
    // 'junk' (comments, doctype, PIs) is dropped entirely.
  }
  return out
}
