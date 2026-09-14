import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContextMeter } from './ContextMeter'
import { setTestLocale, type AppLocale } from '../../i18n'
import { useContextDraftStore } from '../../stores/contextDraftStore'
import { useAppStore } from '../../stores/appStore'

const events = vi.hoisted(() => ({ receive: null as null | ((event: { payload: { conversationId: string; tokens: number; window: number } }) => void) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async (_name, callback) => { events.receive = callback; return () => {} }) }))

beforeEach(() => {
  setTestLocale('fr')
  useContextDraftStore.setState({ text: '' })
  useAppStore.setState({ conversations: [] })
})

afterEach(() => setTestLocale('fr'))

describe('ContextMeter', () => {
  it('updates as the current draft changes and clears', () => {
    render(<MemoryRouter><ContextMeter /></MemoryRouter>)
    expect(screen.getByText('0 / 128 000')).toBeVisible()
    act(() => useContextDraftStore.setState({ text: 'Bonjour Bob!' }))
    expect(screen.getByText('3 / 128 000')).toBeVisible()
    act(() => useContextDraftStore.setState({ text: '' }))
    expect(screen.getByText('0 / 128 000')).toBeVisible()
  })

  it('uses live measurements only for the displayed conversation', () => {
    render(<MemoryRouter initialEntries={['/chat/current']}><ContextMeter /></MemoryRouter>)
    act(() => events.receive?.({ payload: { conversationId: 'other', tokens: 900, window: 200000 } }))
    expect(screen.getByText('0 / 128 000')).toBeVisible()
    act(() => events.receive?.({ payload: { conversationId: 'current', tokens: 1200, window: 200000 } }))
    expect(screen.getByText('1 200 / 200 000')).toBeVisible()
    act(() => useContextDraftStore.setState({ text: 'test' }))
    expect(screen.getByText('1 201 / 200 000')).toBeVisible()
  })

  it.each([
    ['en', 'Context', 'Context size', '0 / 128,000', 'Context in tokens.'],
    ['fr', 'Contexte', 'Taille du contexte', '0 / 128 000', 'Contexte en tokens.'],
    ['es', 'Contexto', 'Tamaño del contexto', '0 / 128.000', 'Contexto en tokens.'],
  ] as const)('localizes the complete meter in %s', (locale, label, accessibleName, formattedValue, tooltipStart) => {
    setTestLocale(locale as AppLocale)
    render(<MemoryRouter><ContextMeter /></MemoryRouter>)

    const meter = screen.getByLabelText(accessibleName)
    expect(meter).toHaveTextContent(label)
    expect(meter.textContent).toContain(formattedValue)
    expect(meter).toHaveAttribute('title', expect.stringContaining(tooltipStart))
  })
})
