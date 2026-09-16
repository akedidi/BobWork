import { describe, expect, it } from 'vitest'
import { localizePluginResourceMessage, localizePluginResourceSetupHint } from './pluginResourceMessages'

const t = (key: string) => key

describe('pluginResourceMessages', () => {
  it('maps legacy French stdio-cli status to i18n key', () => {
    expect(
      localizePluginResourceMessage(
        { kind: 'stdio-cli', state: 'ready', message: 'CLI locale détectée.' },
        t,
      ),
    ).toBe('plugins.resourceStatus.stdioCliReady')
  })

  it('maps canonical English bundled-python setup hint', () => {
    expect(
      localizePluginResourceSetupHint(
        'Install Python 3 (python.org or `brew install python`).',
        t,
      ),
    ).toBe('plugins.resourceHint.installPython')
  })

  it('keeps author-provided bundled-python notes', () => {
    const notes =
      'Script Python embarqué — valide le modèle d’architecture JSON/YAML avant toute génération.'
    expect(
      localizePluginResourceMessage(
        { kind: 'bundled-python', state: 'ready', message: notes },
        t,
      ),
    ).toBe(notes)
  })
})
