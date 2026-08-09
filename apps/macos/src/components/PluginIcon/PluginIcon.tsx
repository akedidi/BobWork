import clsx from 'clsx'
import type { Plugin } from '@bob-work/shared-types'
import agenticIcon from '../../assets/plugin-icons/agentic.svg'
import calendarIcon from '../../assets/plugin-icons/calendar.svg'
import documentIcon from '../../assets/plugin-icons/document.svg'
import excelIcon from '../../assets/plugin-icons/excel.svg'
import githubIcon from '../../assets/plugin-icons/github.svg'
import mondayIcon from '../../assets/plugin-icons/monday.svg'
import onedriveIcon from '../../assets/plugin-icons/onedrive.svg'
import onenoteIcon from '../../assets/plugin-icons/onenote.svg'
import outlookIcon from '../../assets/plugin-icons/outlook.svg'
import pluginIcon from '../../assets/plugin-icons/plugin.svg'
import powerpointIcon from '../../assets/plugin-icons/powerpoint.svg'
import slackIcon from '../../assets/plugin-icons/slack.svg'
import teamsIcon from '../../assets/plugin-icons/teams.svg'
import wordIcon from '../../assets/plugin-icons/word.svg'

export type PluginIconId =
  | 'document'
  | 'word'
  | 'powerpoint'
  | 'excel'
  | 'onenote'
  | 'github'
  | 'slack'
  | 'monday'
  | 'outlook'
  | 'teams'
  | 'calendar'
  | 'onedrive'
  | 'agentic'
  | 'plugin'

const ICONS = new Set<string>([
  'document', 'word', 'powerpoint', 'excel', 'onenote',
  'github', 'slack', 'monday', 'outlook', 'teams', 'calendar', 'onedrive',
  'agentic', 'plugin',
])

const ICON_SRC: Record<PluginIconId, string> = {
  document: documentIcon,
  word: wordIcon,
  powerpoint: powerpointIcon,
  excel: excelIcon,
  onenote: onenoteIcon,
  github: githubIcon,
  slack: slackIcon,
  monday: mondayIcon,
  outlook: outlookIcon,
  teams: teamsIcon,
  calendar: calendarIcon,
  onedrive: onedriveIcon,
  agentic: agenticIcon,
  plugin: pluginIcon,
}

const PLUGIN_ID_ICON: Record<string, PluginIconId> = {
  'builtin-documents': 'document',
  'builtin-word': 'word',
  'builtin-powerpoint': 'powerpoint',
  'builtin-excel': 'excel',
  'builtin-onenote': 'onenote',
}

const INTEGRATION_ID_ICON: Record<string, PluginIconId> = {
  'outlook-mail': 'outlook',
  teams: 'teams',
  'outlook-calendar': 'calendar',
  onedrive: 'onedrive',
  github: 'github',
  slack: 'slack',
  monday: 'monday',
}

export function resolvePluginIcon(plugin: Pick<Plugin, 'id' | 'manifest'> & { name?: string }): PluginIconId {
  const manifest = plugin.manifest as { icon?: string; agentic?: boolean } | undefined
  if (manifest?.icon && ICONS.has(manifest.icon)) return manifest.icon as PluginIconId
  if (PLUGIN_ID_ICON[plugin.id]) return PLUGIN_ID_ICON[plugin.id]
  if (manifest?.agentic) return 'agentic'
  return 'plugin'
}

export function resolveIntegrationIcon(integrationId: string): PluginIconId {
  return INTEGRATION_ID_ICON[integrationId] ?? 'plugin'
}

type PluginIconProps = {
  icon: PluginIconId | string | undefined
  size?: 'sm' | 'md' | 'lg'
  className?: string
  label?: string
}

export function PluginIcon({ icon, size = 'md', className, label }: PluginIconProps) {
  const id = icon && ICONS.has(icon) ? (icon as PluginIconId) : 'plugin'
  return (
    <span
      className={clsx('plugin-icon', `plugin-icon--${id}`, `plugin-icon--${size}`, className)}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
    >
      <img src={ICON_SRC[id]} alt="" className="plugin-icon-image" draggable={false} />
    </span>
  )
}
