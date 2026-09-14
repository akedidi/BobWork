import { afterEach, describe, expect, it } from 'vitest'
import { getActiveLocale, setTestLocale } from '../i18n'
import { translate } from '../i18n/translate'
import { localizeActivityTitle } from './activityLabels'

const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
  translate(getActiveLocale(), key, params)

afterEach(() => setTestLocale('fr'))

describe('localizeActivityTitle', () => {
  it('maps english backend titles to french labels', () => {
    setTestLocale('fr')
    expect(localizeActivityTitle(t, {
      eventType: 'tool_finished',
      title: 'Tool finished',
    })).toBe('Outil terminé')
    expect(localizeActivityTitle(t, {
      eventType: 'tool_started',
      title: 'Updating plan',
      toolName: 'update_todo_list',
    })).toBe('Mise à jour du plan')
    expect(localizeActivityTitle(t, {
      eventType: 'tool_finished',
      title: 'Plan updated',
      toolName: 'update_todo_list',
    })).toBe('Plan mis à jour')
    expect(localizeActivityTitle(t, {
      eventType: 'analysis',
      title: 'Analysis in progress',
    })).toBe('Analyse en cours')
  })

  it('keeps english labels when locale is en', () => {
    setTestLocale('en')
    expect(localizeActivityTitle(t, {
      eventType: 'tool_finished',
      title: 'Tool finished',
    })).toBe('Tool finished')
    expect(localizeActivityTitle(t, {
      eventType: 'tool_started',
      title: 'Reading rapport.md',
      toolName: 'read_file',
    })).toBe('Reading rapport.md')
    expect(localizeActivityTitle(t, {
      eventType: 'analysis',
      title: 'Analysis in progress',
    })).toBe('Analysis in progress')
  })

  it('translates legacy french persisted titles for english locale', () => {
    setTestLocale('en')
    expect(localizeActivityTitle(t, {
      eventType: 'tool_finished',
      title: 'Outil terminé',
    })).toBe('Tool finished')
    expect(localizeActivityTitle(t, {
      eventType: 'tool_started',
      title: 'Mise à jour du plan',
      toolName: 'update_todo_list',
    })).toBe('Updating plan')
  })
})
