import { describe, expect, it } from 'vitest'
import { formatMessageTimestamp } from './messageTimestamp'

describe('formatMessageTimestamp', () => {
  it('affiche Aujourd’hui pour un message du jour', () => {
    const now = new Date(2026, 7, 30, 12, 0)
    const messageDate = new Date(2026, 7, 30, 7, 27)

    expect(formatMessageTimestamp(messageDate.toISOString(), 'fr-FR', now))
      .toBe('07:27 · Aujourd’hui')
  })

  it('affiche le jour et la date pour un message plus ancien', () => {
    const now = new Date(2026, 7, 30, 12, 0)
    const messageDate = new Date(2026, 7, 29, 18, 5)

    expect(formatMessageTimestamp(messageDate.toISOString(), 'fr-FR', now))
      .toBe('18:05 · Samedi 29 août')
  })

  it('ajoute l’année lorsque le message ne date pas de cette année', () => {
    const now = new Date(2026, 7, 30, 12, 0)
    const messageDate = new Date(2025, 11, 24, 9, 3)

    expect(formatMessageTimestamp(messageDate.toISOString(), 'fr-FR', now))
      .toBe('09:03 · Mercredi 24 décembre 2025')
  })
})
