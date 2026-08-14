import clsx from 'clsx'
import type { Plugin } from '@bob-work/shared-types'
import agenticIcon from '../../assets/plugin-icons/agentic.svg'
import calendarIcon from '../../assets/plugin-icons/calendar.svg'
import chromeIcon from '../../assets/plugin-icons/chrome.svg'
import computerIcon from '../../assets/plugin-icons/computer.svg'
import documentIcon from '../../assets/plugin-icons/document.svg'
import excelIcon from '../../assets/plugin-icons/excel.svg'
import githubIcon from '../../assets/plugin-icons/github.svg'
import investIcon from '../../assets/plugin-icons/invest.svg'
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
  | 'invest'
  | 'computer'
  | 'chrome'
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
  'document', 'word', 'powerpoint', 'excel', 'onenote', 'invest', 'computer', 'chrome',
  'github', 'slack', 'monday', 'outlook', 'teams', 'calendar', 'onedrive',
  'agentic', 'plugin',
])

const ICON_SRC: Record<PluginIconId, string> = {
  document: documentIcon,
  word: wordIcon,
  powerpoint: powerpointIcon,
  excel: excelIcon,
  onenote: onenoteIcon,
  invest: investIcon,
  computer: computerIcon,
  chrome: chromeIcon,
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
  'builtin-cto-invest': 'invest',
  'bob-work-cto-invest': 'invest',
  'bob-work-ibm-pursuit': 'plugin',
  'builtin-computer-use': 'computer',
  'builtin-chrome-control': 'chrome',
}

const INTEGRATION_ID_ICON: Record<string, PluginIconId> = {
  'outlook-mail': 'outlook',
  teams: 'teams',
  'outlook-calendar': 'calendar',
  onedrive: 'onedrive',
  onenote: 'onenote',
  github: 'github',
  slack: 'slack',
  monday: 'monday',
}

const LOCAL_ICON_RULES: Array<{ keys: string[]; icon: PluginIconId }> = [
  { keys: ['powerpoint', 'pptx', 'microsoft-powerpoint'], icon: 'powerpoint' },
  { keys: ['excel', 'xlsx', 'microsoft-excel'], icon: 'excel' },
  { keys: ['onenote', 'microsoft-onenote'], icon: 'onenote' },
  { keys: ['microsoft-word', 'microsoft word', 'docx'], icon: 'word' },
  { keys: ['bob-work-documents', 'builtin-documents'], icon: 'document' },
  { keys: ['cto-invest', 'cto investissements', 'bob-work-cto'], icon: 'invest' },
  { keys: ['computer-use', 'computer use', 'bob-work-computer'], icon: 'computer' },
  { keys: ['chrome-control', 'contrôle chrome', 'controle chrome', 'bob-work-chrome'], icon: 'chrome' },
  { keys: ['github'], icon: 'github' },
  { keys: ['slack'], icon: 'slack' },
  { keys: ['monday'], icon: 'monday' },
  { keys: ['outlook'], icon: 'outlook' },
  { keys: ['teams', 'microsoft teams'], icon: 'teams' },
  { keys: ['outlook-calendar', 'calendrier outlook'], icon: 'calendar' },
  { keys: ['onedrive', 'one drive'], icon: 'onedrive' },
]

const FAVICON_RULES: Array<{ keys: string[]; domain: string }> = [
  { keys: ['notion'], domain: 'notion.so' },
  { keys: ['trello'], domain: 'trello.com' },
  { keys: ['jira', 'atlassian'], domain: 'atlassian.com' },
  { keys: ['discord'], domain: 'discord.com' },
  { keys: ['linear'], domain: 'linear.app' },
  { keys: ['figma'], domain: 'figma.com' },
  { keys: ['stripe'], domain: 'stripe.com' },
  { keys: ['shopify'], domain: 'shopify.com' },
  { keys: ['hubspot'], domain: 'hubspot.com' },
  { keys: ['salesforce'], domain: 'salesforce.com' },
  { keys: ['dropbox'], domain: 'dropbox.com' },
  { keys: ['asana'], domain: 'asana.com' },
  { keys: ['zoom'], domain: 'zoom.us' },
  { keys: ['telegram'], domain: 'telegram.org' },
  { keys: ['whatsapp'], domain: 'whatsapp.com' },
  { keys: ['spotify'], domain: 'spotify.com' },
  { keys: ['youtube'], domain: 'youtube.com' },
  { keys: ['linkedin'], domain: 'linkedin.com' },
  { keys: ['reddit'], domain: 'reddit.com' },
  { keys: ['aws', 'amazon web'], domain: 'aws.amazon.com' },
  { keys: ['azure'], domain: 'azure.microsoft.com' },
  { keys: ['gmail', 'google mail'], domain: 'gmail.com' },
  { keys: ['google drive', 'gdrive'], domain: 'drive.google.com' },
  { keys: ['tmdb', 'themoviedb'], domain: 'themoviedb.org' },
  { keys: ['openai', 'chatgpt'], domain: 'openai.com' },
  { keys: ['anthropic', 'claude'], domain: 'anthropic.com' },
]

export function isRemotePluginIcon(value: string | undefined): boolean {
  if (!value) return false
  return value.startsWith('http://')
    || value.startsWith('https://')
    || value.startsWith('data:image/')
}

export function faviconUrlForDomain(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=128`
}

/** Infer a local brand key or a public favicon URL from name/slug/description. */
export function inferPluginIcon(slug: string, name: string, description = ''): string {
  const text = `${slug} ${name} ${description}`.toLocaleLowerCase()
  for (const rule of LOCAL_ICON_RULES) {
    if (rule.keys.some(key => text.includes(key))) return rule.icon
  }
  if (text.includes('microsoft word') || slug.includes('microsoft-word') || slug.endsWith('-word')) {
    return 'word'
  }
  for (const rule of FAVICON_RULES) {
    if (rule.keys.some(key => text.includes(key))) return faviconUrlForDomain(rule.domain)
  }
  return 'plugin'
}

export function resolveIconFromText(...parts: Array<string | undefined | null>): string {
  return inferPluginIcon(parts[0] ?? '', parts[1] ?? '', parts.slice(2).filter(Boolean).join(' '))
}

export function resolvePluginIcon(plugin: Pick<Plugin, 'id' | 'manifest'> & { name?: string }): string {
  const manifest = plugin.manifest as { icon?: string; agentic?: boolean; slug?: string } | undefined
  const icon = manifest?.icon?.trim()
  if (icon && (ICONS.has(icon) || isRemotePluginIcon(icon))) return icon
  if (PLUGIN_ID_ICON[plugin.id]) return PLUGIN_ID_ICON[plugin.id]
  const inferred = inferPluginIcon(
    manifest?.slug ?? plugin.id,
    plugin.name ?? '',
    typeof (plugin.manifest as { description?: string } | undefined)?.description === 'string'
      ? (plugin.manifest as { description?: string }).description
      : '',
  )
  if (inferred !== 'plugin') return inferred
  if (manifest?.agentic) return 'agentic'
  return 'plugin'
}

export function resolveIntegrationIcon(integrationId: string): PluginIconId {
  return INTEGRATION_ID_ICON[integrationId] ?? 'plugin'
}

/** Map a file name/path to a recognizable type icon (PPTX → PowerPoint, etc.). */
export function iconForFileName(nameOrPath: string): PluginIconId {
  const base = nameOrPath.split(/[/\\]/).pop() ?? nameOrPath
  const ext = base.includes('.') ? base.split('.').pop()?.toLowerCase() ?? '' : ''
  switch (ext) {
    case 'ppt':
    case 'pptx':
    case 'key':
    case 'odp':
      return 'powerpoint'
    case 'doc':
    case 'docx':
    case 'rtf':
    case 'odt':
    case 'pages':
      return 'word'
    case 'xls':
    case 'xlsx':
    case 'xlsm':
    case 'csv':
    case 'ods':
    case 'numbers':
      return 'excel'
    case 'one':
      return 'onenote'
    case 'pdf':
    case 'md':
    case 'markdown':
    case 'txt':
    case 'html':
    case 'htm':
      return 'document'
    default:
      return 'document'
  }
}

type PluginIconProps = {
  icon: PluginIconId | string | undefined
  size?: 'sm' | 'md' | 'lg'
  className?: string
  label?: string
}

export function PluginIcon({ icon, size = 'md', className, label }: PluginIconProps) {
  const remote = isRemotePluginIcon(icon)
  const id = !remote && icon && ICONS.has(icon) ? (icon as PluginIconId) : 'plugin'
  const src = remote ? icon! : ICON_SRC[id]
  return (
    <span
      className={clsx(
        'plugin-icon',
        remote ? 'plugin-icon--remote' : `plugin-icon--${id}`,
        `plugin-icon--${size}`,
        className,
      )}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
    >
      <img src={src} alt="" className="plugin-icon-image" draggable={false} />
    </span>
  )
}
