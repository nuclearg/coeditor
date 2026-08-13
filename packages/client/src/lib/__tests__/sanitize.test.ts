import { describe, it, expect } from 'vitest'
import { sanitizeHtml, isUnsafeUrl, decodeHtmlEntities, isAllowedUrl } from '../sanitize'

describe('sanitizeHtml — whitelist tag filtering', () => {
  it('removes plain script blocks', () => {
    expect(sanitizeHtml('<p>ok</p><script>alert(1)</script>')).toBe('<p>ok</p>')
  })

  it('neutralizes the nested <scr<script></script>ipt> rebuild trick', () => {
    const input = '<scr<script></script>ipt src=//evil>x</scr<script></script>ipt>'
    const out = sanitizeHtml(input)
    // Whitelist semantics: the bogus `scr<script` tag is parsed exactly like
    // a browser would, dropped whole, and nothing tag-like survives — the
    // residue is inert escaped text with no literal '<' at all.
    expect(out).not.toContain('<')
    expect(out.toLowerCase()).not.toContain('<script')
  })

  it('removes unclosed/self-closing dangerous tags', () => {
    expect(sanitizeHtml('<iframe src="//evil"/>text')).not.toContain('iframe')
    expect(sanitizeHtml('<embed src="x">after')).not.toContain('embed')
  })

  it('strips on* event attributes', () => {
    expect(sanitizeHtml('<img src="x" onerror="alert(1)">')).not.toContain('onerror')
    expect(sanitizeHtml(`<div onclick='x()'>hi</div>`)).not.toContain('onclick')
  })

  it('keeps normal markdown-ish html intact', () => {
    const html = '<p><a href="https://example.com">link</a> <strong>b</strong></p>'
    expect(sanitizeHtml(html)).toBe(html)
  })

  it('keeps non-whitelisted tags text content', () => {
    expect(sanitizeHtml('<div>hello <span>world</span></div>')).toBe('hello world')
    expect(sanitizeHtml('<section><font color="red">x</font></section>')).toBe('x')
  })

  it('drops style blocks including their content', () => {
    expect(sanitizeHtml('<style>p{background:url(javascript:x)}</style><p>y</p>')).toBe('<p>y</p>')
  })

  it('drops comments and doctypes', () => {
    expect(sanitizeHtml('<!--[if IE]><script>x</script><![endif]-->ok')).toBe('ok')
    expect(sanitizeHtml('<!DOCTYPE html><p>x</p>')).toBe('<p>x</p>')
  })

  it('handles tag and attribute names case-insensitively', () => {
    expect(sanitizeHtml('<SCRIPT>x</SCRIPT>')).toBe('')
    expect(sanitizeHtml('<A HREF="JAVASCRIPT:alert(1)">x</A>')).toBe('<a>x</a>')
    expect(sanitizeHtml('<IMG SRC="https://a.com/i.png" ALT="p">')).toBe('<img src="https://a.com/i.png" alt="p">')
  })
})

describe('sanitizeHtml — attribute whitelist', () => {
  it('regression: quote-closed attribute directly followed by on* (no space)', () => {
    expect(sanitizeHtml('<img foo="x"onerror="alert(1)" src=x>')).toBe('')
    expect(sanitizeHtml('<img src="https://a.com/x.png"onerror="alert(1)">'))
      .toBe('<img src="https://a.com/x.png">')
  })

  it('regression: slash used as attribute separator', () => {
    expect(sanitizeHtml('<img/onerror=alert(1) src=x>')).toBe('')
    expect(sanitizeHtml('<a/onmouseover=alert(1) href="https://a.com">x</a>'))
      .toBe('<a href="https://a.com">x</a>')
  })

  it('regression: formaction and other unlisted URL attributes never survive', () => {
    expect(sanitizeHtml('<button formaction="javascript:alert(1)">go</button>')).toBe('go')
    expect(sanitizeHtml('<form action="javascript:alert(1)"><input type="submit" formaction="javascript:alert(2)"></form>'))
      .toBe('')
  })

  it('handles unquoted attribute values', () => {
    expect(sanitizeHtml('<img src=https://a.com/i.png alt=hi onerror=alert(1)>'))
      .toBe('<img src="https://a.com/i.png" alt="hi">')
    expect(sanitizeHtml('<a href=/relative>x</a>')).toBe('<a href="/relative">x</a>')
  })

  it('keeps the first occurrence of duplicate attributes (browser parity)', () => {
    expect(sanitizeHtml('<a href="https://a.com"href="javascript:x">dup</a>'))
      .toBe('<a href="https://a.com">dup</a>')
    expect(sanitizeHtml('<a href="javascript:x"href="https://a.com">dup</a>')).toBe('<a>dup</a>')
    expect(sanitizeHtml('<a href>x</a>')).toBe('<a href="">x</a>')
  })

  it('drops style/class/data-*/target and any other non-whitelisted attributes', () => {
    expect(sanitizeHtml('<p class="c" style="color:red" data-x="1">t</p>')).toBe('<p>t</p>')
    expect(sanitizeHtml('<a href="https://a.com" title="T" target="_blank" onclick="x()">y</a>'))
      .toBe('<a href="https://a.com" title="T">y</a>')
    expect(sanitizeHtml('<code class="language-js">c</code>')).toBe('<code>c</code>')
    expect(sanitizeHtml('<th align="left">h</th>')).toBe('<th>h</th>')
  })

  it('keeps only http/https img src and drops the whole img otherwise', () => {
    expect(sanitizeHtml('<img src="data:image/png;base64,xx" alt="a">')).toBe('')
    expect(sanitizeHtml('<img src="javascript:x">')).toBe('')
    expect(sanitizeHtml('<img alt="no-src">')).toBe('')
    expect(sanitizeHtml('<img src="/relative.png">')).toBe('')
  })

  it('allows http/https/mailto and relative hrefs, rejects other schemes', () => {
    expect(sanitizeHtml('<a href="mailto:x@y.com">m</a>')).toBe('<a href="mailto:x@y.com">m</a>')
    expect(sanitizeHtml('<a href="ftp://a.com">f</a>')).toBe('<a>f</a>')
  })

  it('preserves valid entity references in text and attribute values', () => {
    expect(sanitizeHtml('<p>a &amp; b &lt; c</p>')).toBe('<p>a &amp; b &lt; c</p>')
    expect(sanitizeHtml('<a href="https://a.com/?a=1&amp;b=2">x</a>'))
      .toBe('<a href="https://a.com/?a=1&amp;b=2">x</a>')
  })

  it('escapes bare ampersands and angle brackets in text', () => {
    expect(sanitizeHtml('<p>a & b</p>')).toBe('<p>a &amp; b</p>')
    expect(sanitizeHtml('1 < 2')).toBe('1 &lt; 2')
  })

  it('stays inert on truncated input (streaming robustness)', () => {
    // Unterminated tags never emit a live tag: '<' is escaped, rest is text.
    expect(sanitizeHtml('<a href="javascript:alert(1)')).not.toContain('<')
    expect(sanitizeHtml('<img src="https://a.com/x.png"')).not.toContain('<')
    expect(sanitizeHtml('<scr')).toBe('&lt;scr')
    expect(sanitizeHtml('')).toBe('')
  })
})

describe('sanitizeHtml — dangerous URL schemes', () => {
  it('neutralizes literal javascript: hrefs', () => {
    // Whitelist semantics: the href attribute is dropped entirely.
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>')
  })

  it('neutralizes entity-encoded javascript: (numeric)', () => {
    expect(sanitizeHtml('<a href="javas&#99;ript:alert(1)">x</a>')).toBe('<a>x</a>')
    expect(sanitizeHtml('<a href="&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;x">x</a>')).toBe('<a>x</a>')
  })

  it('neutralizes entity-encoded javascript: (named entities)', () => {
    expect(sanitizeHtml('<a href="javascript&colon;alert(1)">x</a>')).toBe('<a>x</a>')
    expect(sanitizeHtml('<a href="javas&#99;ript&colon;alert(1)">x</a>')).toBe('<a>x</a>')
  })

  it('neutralizes schemes hiding control chars/whitespace', () => {
    expect(sanitizeHtml('<a href="java\tscript:alert(1)">x</a>')).toBe('<a>x</a>')
    expect(sanitizeHtml('<a href=" javascript:alert(1)">x</a>')).toBe('<a>x</a>')
    expect(sanitizeHtml('<img src="javas&#99;ript:x">')).toBe('')
  })

  it('neutralizes vbscript: and data: in src/href/action', () => {
    expect(sanitizeHtml('<img src="vbscript:x">')).toBe('')
    expect(sanitizeHtml('<img src="data:text/html;base64,xx">')).toBe('')
    expect(sanitizeHtml('<form action="javascript:x"></form>')).not.toContain('javascript:')
  })

  it('does not touch safe schemes or lookalikes', () => {
    expect(sanitizeHtml('<a href="https://a.com/javascript:x">y</a>')).toContain('https://a.com/javascript:x')
    expect(sanitizeHtml('<a href="/relative/data:noop">y</a>')).toContain('/relative/data:noop')
  })

  it('neutralizes double-encoded entities', () => {
    // &amp;#58; decodes to &#58; then to ':'
    expect(sanitizeHtml('<a href="javascript&amp;#58;alert(1)">x</a>')).toBe('<a>x</a>')
  })
})

describe('isUnsafeUrl / isAllowedUrl / decodeHtmlEntities', () => {
  it('flags dangerous schemes after decoding', () => {
    expect(isUnsafeUrl('"javascript:alert(1)"')).toBe(true)
    expect(isUnsafeUrl("'JAVASCRIPT:alert(1)'")).toBe(true)
    expect(isUnsafeUrl('vbscript:run')).toBe(true)
    expect(isUnsafeUrl('data:text/html,x')).toBe(true)
  })

  it('allows normal urls', () => {
    expect(isUnsafeUrl('https://example.com')).toBe(false)
    expect(isUnsafeUrl('#anchor')).toBe(false)
    expect(isUnsafeUrl('/path/to/x')).toBe(false)
  })

  it('isAllowedUrl enforces a positive protocol allowlist', () => {
    expect(isAllowedUrl('https://a.com', ['http', 'https'], true)).toBe(true)
    expect(isAllowedUrl('mailto:x@y.com', ['http', 'https', 'mailto'], true)).toBe(true)
    expect(isAllowedUrl('/relative', ['http', 'https'], true)).toBe(true)
    expect(isAllowedUrl('/relative', ['http', 'https'], false)).toBe(false)
    expect(isAllowedUrl('javascript&colon;x', ['http', 'https'], true)).toBe(false)
    expect(isAllowedUrl('FTP://a.com', ['http', 'https'], true)).toBe(false)
  })

  it('decodes numeric and named entities', () => {
    expect(decodeHtmlEntities('&#x3a;')).toBe(':')
    expect(decodeHtmlEntities('&#58;')).toBe(':')
    expect(decodeHtmlEntities('&colon;')).toBe(':')
  })
})
