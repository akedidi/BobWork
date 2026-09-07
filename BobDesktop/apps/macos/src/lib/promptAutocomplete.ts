import type { BobSlashCommand } from '@bob-work/shared-types'

export type AutocompleteTrigger = '/' | '@'

export interface AutocompleteQuery {
  trigger: AutocompleteTrigger
  query: string
  startIndex: number
}

export interface PromptAutocompleteItem {
  id: string
  trigger: AutocompleteTrigger
  label: string
  subtitle: string
  insert: string
}

/** Detect a `/` or `@` token at the caret (end of the current value). */
export function detectAutocompleteQuery(text: string): AutocompleteQuery | null {
  const slash = /(?:^|\s)\/([\w:-]*)$/.exec(text)
  if (slash && slash.index !== undefined) {
    const tokenIndex = text.lastIndexOf('/', slash.index + slash[0].length)
    return { trigger: '/', query: slash[1] ?? '', startIndex: tokenIndex }
  }
  const mention = /(?:^|\s)@([\w-]*)$/.exec(text)
  if (mention && mention.index !== undefined) {
    const tokenIndex = text.lastIndexOf('@', mention.index + mention[0].length)
    return { trigger: '@', query: mention[1] ?? '', startIndex: tokenIndex }
  }
  return null
}

export function filterSlashCommands(
  commands: BobSlashCommand[],
  query: string,
): BobSlashCommand[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return commands
  return commands.filter(command => {
    if (command.name.toLowerCase().startsWith(needle)) return true
    return (command.altNames ?? []).some(alias => alias.toLowerCase().startsWith(needle))
  })
}

export function slashCommandsToItems(commands: BobSlashCommand[]): PromptAutocompleteItem[] {
  return commands.map(command => ({
    id: `slash:${command.name}`,
    trigger: '/',
    label: `/${command.name}`,
    subtitle: command.description,
    insert: `/${command.name} `,
  }))
}

export function applyAutocompleteInsert(
  text: string,
  query: AutocompleteQuery,
  insert: string,
): string {
  return `${text.slice(0, query.startIndex)}${insert}${text.slice(query.startIndex + 1 + query.query.length)}`
}

export function cycleAutocompleteIndex(current: number, delta: number, length: number): number {
  if (length <= 0) return 0
  return (current + delta + length) % length
}

export function isNativeCondenseCommand(text: string): boolean {
  const trimmed = text.trim()
  return /^\/(?:condense|compact)\s*$/i.test(trimmed)
}
