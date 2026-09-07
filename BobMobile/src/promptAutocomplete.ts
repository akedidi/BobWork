import type { BobSlashCommand, Catalog } from './types'

export type PromptAutocompleteKind = 'slash' | 'plugin' | 'skill' | 'integration' | 'mcp' | 'db'

export interface PromptAutocompleteQuery {
  trigger: '/' | '@'
  query: string
  startIndex: number
}

export interface PromptAutocompleteItem {
  id: string
  label: string
  subtitle: string
  insert: string
  kind: PromptAutocompleteKind
  resourceId?: string
}

export function detectPromptAutocomplete(value: string): PromptAutocompleteQuery | null {
  const slash = /(?:^|\s)\/([\w:-]*)$/.exec(value)
  if (slash?.index !== undefined) {
    return { trigger: '/', query: slash[1] ?? '', startIndex: value.lastIndexOf('/', slash.index + slash[0].length) }
  }
  const mention = /(?:^|\s)@([\w-]*)$/.exec(value)
  if (mention?.index !== undefined) {
    return { trigger: '@', query: mention[1] ?? '', startIndex: value.lastIndexOf('@', mention.index + mention[0].length) }
  }
  return null
}

export function applyPromptAutocomplete(value: string, query: PromptAutocompleteQuery, insert: string): string {
  return `${value.slice(0, query.startIndex)}${insert}${value.slice(query.startIndex + query.query.length + 1)}`
}

export function buildPromptAutocompleteItems(
  value: string,
  catalog: Catalog,
  slashCommands: BobSlashCommand[],
): PromptAutocompleteItem[] {
  const active = detectPromptAutocomplete(value)
  if (!active) return []
  const needle = active.query.trim().toLocaleLowerCase()
  if (active.trigger === '/') {
    return slashCommands
      .filter(command => !needle
        || command.name.toLocaleLowerCase().startsWith(needle)
        || (command.altNames ?? []).some(alias => alias.toLocaleLowerCase().startsWith(needle)))
      .slice(0, 12)
      .map(command => ({
        id: `slash:${command.name}`,
        label: `/${command.name}`,
        subtitle: command.description,
        insert: `/${command.name} `,
        kind: 'slash',
      }))
  }

  const items: PromptAutocompleteItem[] = [
    ...catalog.plugins.map(plugin => ({ id: `plugin:${plugin.id}`, label: plugin.name, subtitle: 'Plugin', insert: `@plugin:${plugin.id} `, kind: 'plugin' as const, resourceId: plugin.id })),
    ...catalog.skills.map(skill => ({ id: `skill:${skill.slug}`, label: skill.name, subtitle: 'Skill', insert: `@skill:${skill.slug} `, kind: 'skill' as const, resourceId: skill.slug })),
    ...catalog.integrations.filter(integration => integration.connected).map(integration => {
      const skillSlug = `bob-work-${integration.id}`
      return { id: `integration:${integration.id}`, label: integration.name, subtitle: 'Integration', insert: `@skill:${skillSlug} `, kind: 'integration' as const, resourceId: skillSlug }
    }),
    ...catalog.mcpServers.filter(server => server.enabled).map(server => ({ id: `mcp:${server.name}`, label: server.name, subtitle: 'MCP', insert: `@mcp:${server.name} `, kind: 'mcp' as const, resourceId: server.name })),
    ...catalog.dbConnections.filter(connection => connection.enabled).map(connection => ({ id: `db:${connection.name}`, label: connection.name, subtitle: 'DB', insert: `@db:${connection.name} `, kind: 'db' as const, resourceId: connection.name })),
  ]
  return items
    .filter(item => !needle || item.label.toLocaleLowerCase().includes(needle) || item.id.toLocaleLowerCase().includes(needle))
    .slice(0, 8)
}
