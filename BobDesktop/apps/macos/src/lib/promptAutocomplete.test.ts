import { describe, expect, it } from 'vitest'
import type { BobSlashCommand } from '@bob-work/shared-types'
import {
  applyAutocompleteInsert,
  cycleAutocompleteIndex,
  detectAutocompleteQuery,
  filterSlashCommands,
  isNativeCondenseCommand,
  slashCommandsToItems,
} from './promptAutocomplete'

const COMMANDS: BobSlashCommand[] = [
  { name: 'ask', description: 'Ask Bob a question', source: 'fallback' },
  { name: 'code', description: 'Switch to coding mode', source: 'fallback' },
  { name: 'compact', description: 'Compact conversation context', source: 'fallback' },
  { name: 'condense', description: 'Condense conversation context', source: 'fallback' },
  { name: 'copy', description: 'Copy an item from conversation history', source: 'fallback' },
  { name: 'create-pr', description: 'Create a pull request', source: 'fallback' },
  { name: 'init', description: 'Initialize project context', source: 'fallback' },
]

describe('prompt autocomplete', () => {
  it('opens slash commands when the user types /', () => {
    const query = detectAutocompleteQuery('/')
    expect(query).toEqual({ trigger: '/', query: '', startIndex: 0 })
    const items = slashCommandsToItems(filterSlashCommands(COMMANDS, query!.query))
    expect(items.map(item => item.label)).toEqual([
      '/ask',
      '/code',
      '/compact',
      '/condense',
      '/copy',
      '/create-pr',
      '/init',
    ])
  })

  it('filters /co to code, compact, condense and copy', () => {
    const query = detectAutocompleteQuery('/co')
    expect(query).toEqual({ trigger: '/', query: 'co', startIndex: 0 })
    expect(filterSlashCommands(COMMANDS, query!.query).map(item => item.name)).toEqual([
      'code',
      'compact',
      'condense',
      'copy',
    ])
  })

  it('inserts the selected command without executing it', () => {
    const query = detectAutocompleteQuery('/co')
    expect(applyAutocompleteInsert('/co', query!, '/condense ')).toBe('/condense ')
    expect(applyAutocompleteInsert('please /rev', detectAutocompleteQuery('please /rev')!, '/review ')).toBe(
      'please /review ',
    )
  })

  it('keeps a trailing slash token ready for @ later', () => {
    expect(detectAutocompleteQuery('hello @pl')).toEqual({
      trigger: '@',
      query: 'pl',
      startIndex: 6,
    })
    expect(detectAutocompleteQuery('hello world')).toBeNull()
  })

  it('cycles the highlighted index', () => {
    expect(cycleAutocompleteIndex(0, 1, 3)).toBe(1)
    expect(cycleAutocompleteIndex(2, 1, 3)).toBe(0)
    expect(cycleAutocompleteIndex(0, -1, 3)).toBe(2)
  })

  it('detects a native condense command without extra arguments', () => {
    expect(isNativeCondenseCommand('/condense')).toBe(true)
    expect(isNativeCondenseCommand('  /compact  ')).toBe(true)
    expect(isNativeCondenseCommand('/condense keep the auth plan')).toBe(false)
  })
})
