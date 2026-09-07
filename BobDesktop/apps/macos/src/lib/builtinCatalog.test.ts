import { describe, expect, it } from 'vitest'
import { isBuiltinPlugin, isBuiltinSkill, sortPluginsForDisplay, sortSkillsForDisplay } from './builtinCatalog'

describe('builtinCatalog', () => {
  it('marks every skill except CTO Investissements as built-in', () => {
    expect(isBuiltinSkill({ slug: 'bob-work-computer-use' })).toBe(true)
    expect(isBuiltinSkill({ slug: 'bob-work-microsoft-word' })).toBe(true)
    expect(isBuiltinSkill({ slug: 'bob-work-docling' })).toBe(true)
    expect(isBuiltinSkill({ slug: 'bob-work-chrome-control' })).toBe(true)
    expect(isBuiltinSkill({ slug: 'bob-work-meeting-minutes' })).toBe(true)
    expect(isBuiltinSkill({ slug: 'ibm-agentic-product-manager' })).toBe(true)
    expect(isBuiltinSkill({ slug: 'excel-helper' })).toBe(true)
    expect(isBuiltinSkill({ slug: 'bob-work-ibm-pursuit' })).toBe(true)
    expect(isBuiltinSkill({ slug: 'cloud-architect-agent' })).toBe(true)
    expect(isBuiltinSkill({ slug: 'docling' })).toBe(true)
    expect(isBuiltinSkill({ slug: 'bob-rh-recruiting' })).toBe(true)
    expect(isBuiltinSkill({ slug: 'hr-recruiting' })).toBe(true)
    expect(isBuiltinSkill({ slug: 'redacteur-juridique' })).toBe(true)
    expect(isBuiltinSkill({ slug: 'my-personal-skill' })).toBe(true)
    expect(isBuiltinSkill({ slug: 'custom', builtin: true })).toBe(true)
  })

  it('keeps CTO Investissements personal and treats Brief Mission IBM as built-in', () => {
    expect(isBuiltinSkill({ slug: 'bob-work-cto-invest' })).toBe(false)
    expect(isBuiltinPlugin({ id: 'bob-work-cto-invest', manifest: { builtin: false, slug: 'bob-work-cto-invest' } as never })).toBe(false)
    expect(isBuiltinSkill({ slug: 'bob-work-ibm-pursuit' })).toBe(true)
    expect(isBuiltinPlugin({ id: 'bob-work-ibm-pursuit', manifest: { builtin: true, slug: 'bob-work-ibm-pursuit' } as never })).toBe(true)
  })

  it('marks builtin plugins as built-in', () => {
    expect(isBuiltinPlugin({ id: 'builtin-computer-use', manifest: {} as never })).toBe(true)
    expect(isBuiltinPlugin({ id: 'builtin-ibm-agentic-designer', manifest: {} as never })).toBe(true)
    expect(isBuiltinPlugin({
      id: 'agentic-copy',
      manifest: { builtin: true, slug: 'bob-work-computer-use' } as never,
    })).toBe(true)
    expect(isBuiltinPlugin({ id: 'cloud', manifest: { agentic: true } as never })).toBe(false)
  })

  it('lists newest-updated user plugins first and keeps builtins last', () => {
    const ordered = sortPluginsForDisplay([
      { id: 'builtin-word', name: 'Word', createdAt: '2026-08-11T12:00:00Z', updatedAt: '2026-08-11T12:00:00Z', manifest: { builtin: true } as never },
      { id: 'old-user', name: 'Old', createdAt: '2026-08-01T10:00:00Z', updatedAt: '2026-08-01T10:00:00Z', manifest: {} as never },
      { id: 'new-user', name: 'New', createdAt: '2026-08-02T10:00:00Z', updatedAt: '2026-08-10T10:00:00Z', manifest: {} as never },
      { id: 'builtin-excel', name: 'Excel', createdAt: '2026-08-11T11:00:00Z', updatedAt: '2026-08-11T11:00:00Z', manifest: { builtin: true } as never },
    ])
    expect(ordered.map(plugin => plugin.id)).toEqual([
      'new-user',
      'old-user',
      'builtin-word',
      'builtin-excel',
    ])
  })

  it('keeps the personal CTO skill first and sorts built-ins by update time', () => {
    const ordered = sortSkillsForDisplay([
      { slug: 'bob-work-computer-use', name: 'Computer Use', builtin: true, createdAt: '2026-08-11T12:00:00Z', updatedAt: '2026-08-11T12:00:00Z' },
      { slug: 'old-user', name: 'Old', createdAt: '2026-08-01T10:00:00Z', updatedAt: '2026-08-01T10:00:00Z' },
      { slug: 'new-user', name: 'New', createdAt: '2026-08-02T10:00:00Z', updatedAt: '2026-08-10T10:00:00Z' },
      { slug: 'bob-work-github', name: 'GitHub', createdAt: '2026-08-11T11:00:00Z', updatedAt: '2026-08-11T11:00:00Z' },
      { slug: 'bob-work-cto-invest', name: 'CTO', createdAt: '2026-07-01T10:00:00Z', updatedAt: '2026-07-01T10:00:00Z' },
    ])
    expect(ordered.map(skill => skill.slug)).toEqual([
      'bob-work-cto-invest',
      'bob-work-computer-use',
      'bob-work-github',
      'new-user',
      'old-user',
    ])
  })
})
