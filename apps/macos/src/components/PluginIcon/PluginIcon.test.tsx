import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  PluginIcon,
  faviconUrlForDomain,
  iconForFileName,
  inferPluginIcon,
  resolveIntegrationIcon,
  resolvePluginIcon,
  resolveSkillIcon,
} from './PluginIcon'

describe('PluginIcon', () => {
  it('renders branded icons for built-in document plugins', () => {
    render(<PluginIcon icon="powerpoint" label="Microsoft PowerPoint" />)
    const icon = screen.getByRole('img', { name: 'Microsoft PowerPoint' })
    expect(icon).toHaveClass('plugin-icon--powerpoint')
    expect(icon.querySelector('img')).toHaveAttribute('src', expect.stringMatching(/^data:image\/svg\+xml,/))
  })

  it('resolves built-in plugin ids when manifest icon is missing', () => {
    expect(resolvePluginIcon({ id: 'builtin-excel', manifest: { icon: 'excel' } as never })).toBe('excel')
    expect(resolvePluginIcon({ id: 'bob-work-cto-invest', manifest: {} as never })).toBe('invest')
    expect(resolvePluginIcon({ id: 'bob-work-ibm-pursuit', manifest: {} as never })).toBe('plugin')
    expect(resolvePluginIcon({ id: 'builtin-computer-use', manifest: {} as never })).toBe('computer')
    expect(resolvePluginIcon({ id: 'builtin-chrome-control', manifest: {} as never })).toBe('chrome')
    expect(resolvePluginIcon({ id: 'builtin-ibm-agentic-consultant', manifest: {} as never })).toBe('consultant')
    expect(resolvePluginIcon({ id: 'builtin-ibm-agentic-designer', manifest: {} as never })).toBe('designer')
    expect(resolvePluginIcon({ id: 'builtin-ibm-agentic-rfp', manifest: {} as never })).toBe('rfp')
    expect(resolvePluginIcon({ id: 'builtin-ibm-agentic-product-manager', manifest: {} as never })).toBe('product')
    expect(resolvePluginIcon({ id: 'builtin-ibm-agentic-delivery-manager', manifest: {} as never })).toBe('delivery')
    expect(resolvePluginIcon({ id: 'builtin-ibm-agentic-change-manager', manifest: {} as never })).toBe('change')
    expect(resolvePluginIcon({ id: 'builtin-ibm-agentic-solution-architect', manifest: {} as never })).toBe('architecture')
    expect(resolvePluginIcon({ id: 'cloud', manifest: { agentic: true } as never })).toBe('agentic')
    expect(resolvePluginIcon({ id: 'agentic-senior-cloud-architect', manifest: { icon: 'cloud' } as never })).toBe('cloud')
  })

  it('infers icons from slug/name and remote favicons for unknown brands', () => {
    expect(inferPluginIcon('bob-work-meeting-minutes', 'Compte rendu professionnel')).toBe('meeting')
    expect(inferPluginIcon('ux-research', 'Recherche UX')).toBe('designer')
    expect(inferPluginIcon('rice', 'Priorisation RICE')).toBe('product')
    expect(inferPluginIcon('adkar', 'Diagnostic ADKAR')).toBe('change')
    expect(inferPluginIcon('avocat-contrats', 'Assistant avocat', 'Rédige des contrats juridiques.')).toBe(faviconUrlForDomain('legifrance.gouv.fr'))
    expect(resolveSkillIcon({ slug: 'custom', name: 'Custom', icon: faviconUrlForDomain('figma.com') })).toBe(faviconUrlForDomain('figma.com'))
    expect(inferPluginIcon('my-notion-brief', 'Notion Brief')).toBe(faviconUrlForDomain('notion.so'))
    expect(resolvePluginIcon({
      id: 'agentic-bob-work-microsoft-excel',
      name: 'Microsoft Excel',
      manifest: { slug: 'bob-work-microsoft-excel' } as never,
    })).toBe('excel')
  })

  it('renders remote https icons', () => {
    const url = faviconUrlForDomain('notion.so')
    render(<PluginIcon icon={url} label="Notion" />)
    const icon = screen.getByRole('img', { name: 'Notion' })
    expect(icon).toHaveClass('plugin-icon--remote')
    expect(icon.querySelector('img')).toHaveAttribute('src', url)
  })

  it('maps integration ids to branded icons', () => {
    expect(resolveIntegrationIcon('github')).toBe('github')
    expect(resolveIntegrationIcon('outlook-mail')).toBe('outlook')
    expect(resolveIntegrationIcon('teams')).toBe('teams')
    expect(resolveIntegrationIcon('outlook-calendar')).toBe('calendar')
    expect(resolveIntegrationIcon('onenote')).toBe('onenote')
  })

  it('renders Outlook and Teams icons from valid SVG assets', () => {
    const { rerender } = render(<PluginIcon icon="outlook" label="Outlook" />)
    const outlook = screen.getByRole('img', { name: 'Outlook' })
    expect(outlook).toHaveClass('plugin-icon--outlook')
    expect(outlook.querySelector('img')).toHaveAttribute('src', expect.stringMatching(/^data:image\/svg\+xml,/))
    rerender(<PluginIcon icon="teams" label="Microsoft Teams" />)
    const teams = screen.getByRole('img', { name: 'Microsoft Teams' })
    expect(teams).toHaveClass('plugin-icon--teams')
    expect(teams.querySelector('img')).toHaveAttribute('src', expect.stringMatching(/^data:image\/svg\+xml,/))
  })

  it('maps file extensions to type icons', () => {
    expect(iconForFileName('IBM_AXA_Brief_Mission.pptx')).toBe('powerpoint')
    expect(iconForFileName('/tmp/rapport.docx')).toBe('word')
    expect(iconForFileName('budget.xlsx')).toBe('excel')
    expect(iconForFileName('notes.pdf')).toBe('document')
  })
})
