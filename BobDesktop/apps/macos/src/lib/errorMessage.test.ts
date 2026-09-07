import { describe, expect, it } from 'vitest'
import { errorMessage } from './errorMessage'

describe('errorMessage', () => {
  it('extracts messages from serialized Tauri enum errors', () => {
    expect(errorMessage({ BobAuthFailed: 'Connexion IBM indisponible.' })).toBe('Connexion IBM indisponible.')
  })

  it('never exposes object Object', () => {
    expect(errorMessage({ nested: { message: 'Erreur détaillée.' } })).toBe('Erreur détaillée.')
    expect(errorMessage({})).toBe('Une erreur inconnue est survenue.')
  })
})
