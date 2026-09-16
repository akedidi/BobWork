import test from 'node:test'
import assert from 'node:assert/strict'

import { formatMessageTimestamp } from './formatMessageTimestamp.ts'

test('shows Today for a message from the same local day', () => {
  const now = new Date(2026, 7, 30, 12, 0)
  const messageDate = new Date(2026, 7, 30, 7, 27)
  assert.equal(
    formatMessageTimestamp(messageDate.toISOString(), 'fr-FR', now),
    '07:27 · Aujourd’hui',
  )
})

test('shows weekday and date for an older message', () => {
  const now = new Date(2026, 7, 30, 12, 0)
  const messageDate = new Date(2026, 7, 29, 18, 5)
  assert.equal(
    formatMessageTimestamp(messageDate.toISOString(), 'fr-FR', now),
    '18:05 · Samedi 29 août',
  )
})

test('adds the year when the message is not from this year', () => {
  const now = new Date(2026, 7, 30, 12, 0)
  const messageDate = new Date(2025, 11, 24, 9, 3)
  assert.equal(
    formatMessageTimestamp(messageDate.toISOString(), 'fr-FR', now),
    '09:03 · Mercredi 24 décembre 2025',
  )
})
