import { describe, expect, it } from 'vitest'
import { isBuiltinPlugin, isBuiltinSkill, sortPluginsForDisplay, sortSkillsForDisplay } from './builtinCatalog'

describe('builtinCatalog', () => {
  it('marks Computer Use and Office skills as built-in', () => {
    expect(isBuiltinSkill({ slug: 'bob-work-computer-use' })).toBe(true)
    expect(isBuiltinSkill({ slug: 'bob-work-microsoft-word' })).toBe(true)
    expect(isBuiltinSkill({ slug: 'bob-work-chrome-control' })).toBe(true)
    expect(isBuiltinSkill({ slug: 'my-personal-skill' })).toBe(false)
    expect(isBuiltinSkill({ slug: 'custom', builtin: true })).toBe(true)
  })

  it('does not treat CTO Investissements or Brief Mission IBM as a built-in skill', () => {
    expect(isBuiltinSkill({ slug: 'bob-work-cto-invest' })).toBe(false)
    expect(isBuiltinPlugin({ id: 'bob-work-cto-invest', manifest: { builtin: false, slug: 'bob-work-cto-invest' } as never })).toBe(false)
    expect(isBuiltinSkill({ slug: 'bob-work-ibm-pursuit' })).toBe(false)
    expect(isBuiltinPlugin({ id: 'bob-work-ibm-pursuit', manifest: { builtin: false, slug: 'bob-work-ibm-pursuit' } as never })).toBe(false)
  })

  it('marks builtin plugins as built-in', () => {
    expect(isBuiltinPlugin({ id: 'builtin-computer-use', manifest: {} as never })).toBe(true)
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

  it('lists newest-updated user skills first and keeps builtins last', () => {
    const ordered = sortSkillsForDisplay([
      { slug: 'bob-work-computer-use', name: 'Computer Use', builtin: true, createdAt: '2026-08-11T12:00:00Z', updatedAt: '2026-08-11T12:00:00Z' },
      { slug: 'old-user', name: 'Old', createdAt: '2026-08-01T10:00:00Z', updatedAt: '2026-08-01T10:00:00Z' },
      { slug: 'new-user', name: 'New', createdAt: '2026-08-02T10:00:00Z', updatedAt: '2026-08-10T10:00:00Z' },
      { slug: 'bob-work-github', name: 'GitHub', createdAt: '2026-08-11T11:00:00Z', updatedAt: '2026-08-11T11:00:00Z' },
    ])
    expect(ordered.map(skill => skill.slug)).toEqual([
      'new-user',
      'old-user',
      'bob-work-computer-use',
      'bob-work-github',
    ])
  })
})
