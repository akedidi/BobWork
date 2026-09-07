/**
 * Canonical, renderer-independent representation used by the Bob Work
 * Designer built-in. It deliberately contains data only: previews and exports
 * are produced by trusted adapters, never by executing model-generated code.
 */
export const DESIGN_IR_VERSION = '1.0' as const

export type DesignNodeType =
  | 'Document' | 'Page' | 'Frame' | 'Section' | 'Group' | 'Component'
  | 'ComponentInstance' | 'Text' | 'Image' | 'Icon' | 'Vector' | 'Rectangle'
  | 'Ellipse' | 'Line' | 'Button' | 'Input' | 'Textarea' | 'Select' | 'Checkbox'
  | 'Radio' | 'Switch' | 'Tabs' | 'Navigation' | 'Menu' | 'Card' | 'Table'
  | 'List' | 'Modal' | 'Drawer' | 'Tooltip' | 'Badge' | 'Avatar' | 'Breadcrumb'
  | 'Pagination' | 'Chart' | 'Video' | 'Custom'

export type DesignLayoutMode = 'FREE' | 'HORIZONTAL' | 'VERTICAL' | 'GRID'

export interface DesignLayout {
  mode?: DesignLayoutMode
  width?: number | 'fill' | 'hug'
  height?: number | 'fill' | 'hug'
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
  padding?: number | [number, number] | [number, number, number, number]
  gap?: number
  columns?: number
  align?: 'start' | 'center' | 'end' | 'stretch'
  justify?: 'start' | 'center' | 'end' | 'between'
  wrap?: boolean
  aspectRatio?: number
}

export interface DesignResponsiveRule {
  visible?: boolean
  order?: number
  layout?: Partial<DesignLayout>
  typography?: { fontSize?: number; lineHeight?: number }
}

export interface DesignNode {
  id: string
  type: DesignNodeType
  name?: string
  role?: string
  text?: string
  accessibleName?: string
  componentId?: string
  tokenRefs?: Record<string, string>
  style?: Record<string, string | number | boolean | undefined>
  layout?: DesignLayout
  responsive?: {
    desktop?: DesignResponsiveRule
    tablet?: DesignResponsiveRule
    mobile?: DesignResponsiveRule
  }
  interactions?: Array<{ event: 'press' | 'navigate' | 'open' | 'close' | 'toggle'; targetId?: string }>
  children?: DesignNode[]
}

export interface DesignToken {
  value: string | number
  description?: string
}

export interface DesignDocument {
  version: typeof DESIGN_IR_VERSION
  document: {
    id: string
    name: string
    pages: DesignNode[]
  }
  tokens: Record<string, DesignToken>
  components: Record<string, DesignNode>
  assets: Record<string, { alt?: string; source?: string }>
  metadata?: {
    title?: string
    sourcePlugin?: string
    createdAt?: string
    updatedAt?: string
  }
}

export interface DesignPatch {
  nodeId: string
  changes: Partial<Omit<DesignNode, 'id' | 'children'>>
}

const ALLOWED_NODE_TYPES = new Set<DesignNodeType>([
  'Document', 'Page', 'Frame', 'Section', 'Group', 'Component', 'ComponentInstance', 'Text', 'Image', 'Icon', 'Vector',
  'Rectangle', 'Ellipse', 'Line', 'Button', 'Input', 'Textarea', 'Select', 'Checkbox', 'Radio', 'Switch', 'Tabs',
  'Navigation', 'Menu', 'Card', 'Table', 'List', 'Modal', 'Drawer', 'Tooltip', 'Badge', 'Avatar', 'Breadcrumb',
  'Pagination', 'Chart', 'Video', 'Custom',
])

/** Throws a human-readable error when a Design IR document is unsafe or malformed. */
export function validateDesignDocument(value: unknown): asserts value is DesignDocument {
  if (!value || typeof value !== 'object') throw new Error('Design IR must be an object')
  const document = value as Partial<DesignDocument>
  if (document.version !== DESIGN_IR_VERSION) throw new Error('Unsupported Design IR version')
  if (!document.document || typeof document.document !== 'object' || !Array.isArray(document.document.pages)) {
    throw new Error('Design IR requires document.pages')
  }
  const ids = new Set<string>()
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') throw new Error('Design node must be an object')
    const designNode = node as Partial<DesignNode>
    if (!designNode.id || typeof designNode.id !== 'string') throw new Error('Every design node requires an id')
    if (ids.has(designNode.id)) throw new Error(`Duplicate design node id: ${designNode.id}`)
    ids.add(designNode.id)
    if (!designNode.type || !ALLOWED_NODE_TYPES.has(designNode.type)) throw new Error(`Unsupported design node type: ${String(designNode.type)}`)
    assertDataOnly(designNode)
    if (designNode.children) {
      if (!Array.isArray(designNode.children)) throw new Error(`Children must be an array for ${designNode.id}`)
      designNode.children.forEach(visit)
    }
  }
  document.document.pages.forEach(visit)
  if (!document.tokens || typeof document.tokens !== 'object') throw new Error('Design IR requires tokens')
  if (!document.components || typeof document.components !== 'object') throw new Error('Design IR requires components')
  if (!document.assets || typeof document.assets !== 'object') throw new Error('Design IR requires assets')
}

export function patchDesignDocument(source: DesignDocument, patch: DesignPatch): DesignDocument {
  validateDesignDocument(source)
  const clone = structuredClone(source)
  let applied = false
  const visit = (node: DesignNode): void => {
    if (node.id === patch.nodeId) {
      Object.assign(node, patch.changes)
      applied = true
    }
    node.children?.forEach(visit)
  }
  clone.document.pages.forEach(visit)
  if (!applied) throw new Error(`Unknown design node: ${patch.nodeId}`)
  clone.metadata = { ...clone.metadata, updatedAt: new Date().toISOString() }
  validateDesignDocument(clone)
  return clone
}

function assertDataOnly(value: unknown, seen = new Set<object>()): void {
  if (typeof value === 'function') throw new Error('Design IR cannot contain executable functions')
  if (!value || typeof value !== 'object') return
  if (seen.has(value)) throw new Error('Design IR cannot contain cyclic values')
  seen.add(value)
  for (const child of Object.values(value)) assertDataOnly(child, seen)
  seen.delete(value)
}
