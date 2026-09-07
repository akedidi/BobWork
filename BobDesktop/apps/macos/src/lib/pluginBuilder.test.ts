import { describe, expect, it } from 'vitest'
import {
  EMPTY_PLUGIN_DRAFT,
  PLUGIN_CONVERSATION_PROMPT,
  buildPluginGenerationPrompt,
  canAdvancePluginBuilder,
  pluginBuilderPreview,
} from './pluginBuilder'

describe('pluginBuilder', () => {
  it('fournit un prompt conversationnel sans verrouiller l’entretien', () => {
    expect(PLUGIN_CONVERSATION_PROMPT).toContain('sans formulaire')
    expect(PLUGIN_CONVERSATION_PROMPT).toContain('Pose-moi seulement les questions utiles')
    expect(PLUGIN_CONVERSATION_PROMPT).toContain('favicon web selon le métier')
    expect(PLUGIN_CONVERSATION_PROMPT).toContain('open source')
    expect(PLUGIN_CONVERSATION_PROMPT).toContain('GitHub')
    expect(PLUGIN_CONVERSATION_PROMPT).toContain('jdbc:db2')
    expect(PLUGIN_CONVERSATION_PROMPT).not.toContain('Ne relance pas l’entretien')
  })

  it('bloque l’étape objectif tant que nom et bénéfice manquent', () => {
    expect(canAdvancePluginBuilder('objectif', EMPTY_PLUGIN_DRAFT)).toBe(false)
    expect(canAdvancePluginBuilder('objectif', {
      ...EMPTY_PLUGIN_DRAFT,
      name: 'Brief AXA',
      description: 'Prépare un brief client.',
    })).toBe(true)
  })

  it('produit un brief de génération sans relancer l’entretien', () => {
    const prompt = buildPluginGenerationPrompt({
      ...EMPTY_PLUGIN_DRAFT,
      name: 'Brief AXA',
      description: 'Prépare un brief client et liste les risques.',
      tools: ['mcp', 'web'],
      permissions: ['mcp.connect', 'file.write'],
      outputs: 'PPTX',
    })
    expect(prompt).toContain('Ne relance pas l’entretien')
    expect(prompt).toContain('Brief AXA')
    expect(prompt).toContain('Recherche web Bob')
    expect(prompt).toContain('binaires embarqués')
    expect(prompt).toContain('vendor/<outil>/<version>/bin/')
    expect(prompt).toContain('pas Homebrew')
    expect(prompt).toContain('favicon')
    expect(prompt).toContain('Créer / modifier des fichiers')
    const preview = pluginBuilderPreview({
      ...EMPTY_PLUGIN_DRAFT,
      name: 'Brief AXA',
      description: 'Prépare un brief.',
      trigger: 'schedule',
      schedule: 'lundi 9h',
    })
    expect(preview.trigger).toContain('lundi 9h')
  })

  it('décrit CLI, shell et binaire embarqué dans le brief', () => {
    const prompt = buildPluginGenerationPrompt({
      ...EMPTY_PLUGIN_DRAFT,
      name: 'Diagrammes',
      description: 'Rend un schéma architecture hors ligne.',
      tools: ['cli', 'shell', 'bundled-bin'],
      permissions: ['command.execute'],
    })
    expect(prompt).toContain('CLI locale')
    expect(prompt).toContain('Script shell')
    expect(prompt).toContain('Binaire embarqué')
    expect(prompt).toContain('Commandes locales (avec accord)')
  })
})
