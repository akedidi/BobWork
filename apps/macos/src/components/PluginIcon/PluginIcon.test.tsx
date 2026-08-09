import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PluginIcon, resolveIntegrationIcon, resolvePluginIcon } from './PluginIcon'

describe('PluginIcon', () => {
  it('renders branded icons for built-in document plugins', () => {
    render(<PluginIcon icon="powerpoint" label="Microsoft PowerPoint" />)
    const icon = screen.getByRole('img', { name: 'Microsoft PowerPoint' })
    expect(icon).toHaveClass('plugin-icon--powerpoint')
    expect(icon.querySelector('img')).toHaveAttribute('src', expect.stringContaining('powerpoint'))
  })

  it('resolves built-in plugin ids when manifest icon is missing', () => {
    expect(resolvePluginIcon({ id: 'builtin-excel', manifest: { icon: 'excel' } as never })).toBe('excel')
    expect(resolvePluginIcon({ id: 'cloud', manifest: { agentic: true } as never })).toBe('agentic')
  })

  it('maps integration ids to branded icons', () => {
    expect(resolveIntegrationIcon('github')).toBe('github')
    expect(resolveIntegrationIcon('outlook-mail')).toBe('outlook')
  })
})
