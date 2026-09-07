import type { DesignDocument, DesignLayout, DesignNode } from '@bob-work/shared-types'
import { validateDesignDocument } from '@bob-work/shared-types'

const cssValue = (value: string | number | boolean | undefined): string | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return `${value}px`
  if (typeof value === 'string' && !/[;{}<>]/.test(value)) return value
  return undefined
}

const escapeHtml = (value: string | undefined): string => (value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

function padding(value: DesignLayout['padding']): string | undefined {
  if (typeof value === 'number') return `${value}px`
  if (Array.isArray(value)) return value.map(item => `${item}px`).join(' ')
  return undefined
}

function nodeStyle(node: DesignNode): string {
  const layout = node.layout ?? {}
  const style = node.style ?? {}
  const declarations: Array<[string, string | undefined]> = [
    ['display', layout.mode === 'HORIZONTAL' || layout.mode === 'VERTICAL' ? 'flex' : layout.mode === 'GRID' ? 'grid' : undefined],
    ['flex-direction', layout.mode === 'HORIZONTAL' ? 'row' : layout.mode === 'VERTICAL' ? 'column' : undefined],
    ['grid-template-columns', layout.mode === 'GRID' && layout.columns ? `repeat(${layout.columns}, minmax(0, 1fr))` : undefined],
    ['width', layout.width === 'fill' ? '100%' : layout.width === 'hug' ? 'fit-content' : cssValue(layout.width)],
    ['height', layout.height === 'fill' ? '100%' : layout.height === 'hug' ? 'fit-content' : cssValue(layout.height)],
    ['min-width', cssValue(layout.minWidth)], ['max-width', cssValue(layout.maxWidth)],
    ['min-height', cssValue(layout.minHeight)], ['max-height', cssValue(layout.maxHeight)],
    ['padding', padding(layout.padding)], ['gap', cssValue(layout.gap)],
    ['align-items', layout.align === 'start' ? 'flex-start' : layout.align === 'end' ? 'flex-end' : layout.align],
    ['justify-content', layout.justify === 'start' ? 'flex-start' : layout.justify === 'end' ? 'flex-end' : layout.justify === 'between' ? 'space-between' : layout.justify],
    ['flex-wrap', layout.wrap ? 'wrap' : undefined], ['aspect-ratio', cssValue(layout.aspectRatio)],
    ['background', cssValue(style.background ?? style.backgroundColor)], ['color', cssValue(style.color)],
    ['border', cssValue(style.border)], ['border-radius', cssValue(style.radius ?? style.borderRadius)],
    ['box-shadow', cssValue(style.shadow ?? style.boxShadow)], ['opacity', typeof style.opacity === 'number' ? String(style.opacity) : undefined],
    ['font-size', cssValue(style.fontSize)], ['font-weight', cssValue(style.fontWeight)], ['line-height', cssValue(style.lineHeight)],
    ['text-align', cssValue(style.textAlign)], ['overflow', cssValue(style.overflow)],
  ]
  return declarations.filter((entry): entry is [string, string] => Boolean(entry[1])).map(([key, value]) => `${key}:${value}`).join(';')
}

function tagFor(node: DesignNode): string {
  switch (node.type) {
    case 'Button': return 'button'
    case 'Navigation': return 'nav'
    case 'Section': return 'section'
    case 'Table': return 'table'
    case 'Input': return 'input'
    case 'Textarea': return 'textarea'
    case 'Image': return 'img'
    default: return 'div'
  }
}

function renderNode(node: DesignNode): string {
  const tag = tagFor(node)
  const attrs = [`data-design-node="${escapeHtml(node.id)}"`, `data-design-type="${node.type}"`, `style="${nodeStyle(node)}"`]
  if (node.role) attrs.push(`role="${escapeHtml(node.role)}"`)
  if (node.accessibleName) attrs.push(`aria-label="${escapeHtml(node.accessibleName)}"`)
  if (tag === 'input') return `<input ${attrs.join(' ')} value="${escapeHtml(node.text)}" readonly />`
  if (tag === 'textarea') return `<textarea ${attrs.join(' ')} readonly>${escapeHtml(node.text)}</textarea>`
  if (tag === 'img') return `<img ${attrs.join(' ')} alt="${escapeHtml(node.accessibleName ?? node.name)}" />`
  return `<${tag} ${attrs.join(' ')}>${escapeHtml(node.text)}${node.children?.map(renderNode).join('') ?? ''}</${tag}>`
}

/** Trusted Design IR -> self-contained preview used by the desktop iframe and mobile WebView. */
export function renderDesignPreview(document: DesignDocument): string {
  validateDesignDocument(document)
  const title = escapeHtml(document.metadata?.title ?? document.document.name)
  const nodes = document.document.pages.map(renderNode).join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>
    :root{color-scheme:light;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f7f8fb;color:#161616}
    *{box-sizing:border-box}body{margin:0;padding:16px;min-width:320px}button,input,textarea{font:inherit}button{cursor:pointer} [data-design-node]{position:relative}
    [data-design-node]:focus-visible{outline:3px solid #0f62fe;outline-offset:2px}
    @media(max-width:600px){body{padding:10px}[data-design-node]{max-width:100%}}
  </style></head><body>${nodes}</body></html>`
}

/** A deliberately small, deterministic SVG fallback for sharing and low-capability clients. */
export function renderDesignSvg(document: DesignDocument, width = 1440, height = 900): string {
  validateDesignDocument(document)
  const label = escapeHtml(document.metadata?.title ?? document.document.name)
  const visibleNames: string[] = []
  const visit = (node: DesignNode) => { visibleNames.push(node.text ?? node.name ?? node.type); node.children?.forEach(visit) }
  document.document.pages.forEach(visit)
  const rows = visibleNames.slice(0, 12).map((name, index) => `<text x="48" y="${118 + index * 42}" font-size="24" fill="#161616">${escapeHtml(name)}</text>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}"><rect width="100%" height="100%" fill="#f7f8fb"/><text x="48" y="64" font-size="32" font-weight="700" fill="#161616">${label}</text>${rows}</svg>`
}
