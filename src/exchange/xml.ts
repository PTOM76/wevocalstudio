// 小さな XML の読み取り（要素、属性、子。文字は Title などの短いものだけ）。DAWproject の読み込み用で、ブラウザとテスト（Node）の両方で動く
export interface XmlNode {
  tag: string
  attrs: Record<string, string>
  children: XmlNode[]
  text: string
}

const unescape = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()]!
  })

export function parseXml(src: string): XmlNode {
  const root: XmlNode = { tag: '', attrs: {}, children: [], text: '' }
  const stack = [root]
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!(?:[^>]*)>|<(\/?)([^\s/>]+)((?:\s+[^\s=]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g
  for (const m of src.matchAll(re)) {
    const top = stack[stack.length - 1]
    if (m[1] !== undefined) top.text += m[1]
    else if (m[6] !== undefined) top.text += unescape(m[6])
    else if (m[3]) {
      if (m[2]) {
        if (stack.length > 1) stack.pop()
        continue
      }
      const attrs: Record<string, string> = {}
      for (const a of (m[4] ?? '').matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = unescape(a[2] ?? a[3] ?? '')
      const node: XmlNode = { tag: m[3], attrs, children: [], text: '' }
      top.children.push(node)
      if (!m[5]) stack.push(node)
    }
  }
  return root
}

/** 子のうち tag の最初のもの */
export const child = (n: XmlNode | undefined, tag: string) => n?.children.find((c) => c.tag === tag)
/** 子のうち tag のものすべて */
export const childrenOf = (n: XmlNode | undefined, tag: string) => n?.children.filter((c) => c.tag === tag) ?? []
/** 属性の数（無ければ def） */
export const numAttr = (n: XmlNode | undefined, key: string, def = 0) => {
  const v = n ? parseFloat(n.attrs[key]) : NaN
  return Number.isFinite(v) ? v : def
}
