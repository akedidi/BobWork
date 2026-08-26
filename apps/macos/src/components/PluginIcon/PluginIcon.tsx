import clsx from 'clsx'
import type { Plugin } from '@bob-work/shared-types'
import agenticIcon from '../../assets/plugin-icons/agentic.svg'
import architectureIcon from '../../assets/plugin-icons/architecture.svg'
import calendarIcon from '../../assets/plugin-icons/calendar.svg'
import changeIcon from '../../assets/plugin-icons/change.svg'
import chromeIcon from '../../assets/plugin-icons/chrome.svg'
import cloudIcon from '../../assets/plugin-icons/cloud.svg'
import computerIcon from '../../assets/plugin-icons/computer.svg'
import consultantIcon from '../../assets/plugin-icons/consultant.svg'
import deliveryIcon from '../../assets/plugin-icons/delivery.svg'
import designerIcon from '../../assets/plugin-icons/designer.svg'
import documentIcon from '../../assets/plugin-icons/document.svg'
import excelIcon from '../../assets/plugin-icons/excel.svg'
import githubIcon from '../../assets/plugin-icons/github.svg'
import investIcon from '../../assets/plugin-icons/invest.svg'
import meetingIcon from '../../assets/plugin-icons/meeting.svg'
import mondayIcon from '../../assets/plugin-icons/monday.svg'
import onedriveIcon from '../../assets/plugin-icons/onedrive.svg'
import onenoteIcon from '../../assets/plugin-icons/onenote.svg'
import outlookIcon from '../../assets/plugin-icons/outlook.svg'
import pluginIcon from '../../assets/plugin-icons/plugin.svg'
import powerpointIcon from '../../assets/plugin-icons/powerpoint.svg'
import productIcon from '../../assets/plugin-icons/product.svg'
import rfpIcon from '../../assets/plugin-icons/rfp.svg'
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
  | 'cloud'
  | 'chrome'
  | 'github'
  | 'slack'
  | 'monday'
  | 'outlook'
  | 'teams'
  | 'calendar'
  | 'onedrive'
  | 'meeting'
  | 'agentic'
  | 'designer'
  | 'consultant'
  | 'rfp'
  | 'product'
  | 'delivery'
  | 'change'
  | 'architecture'
  | 'plugin'

const ICONS = new Set<string>([
  'document', 'word', 'powerpoint', 'excel', 'onenote', 'invest', 'computer', 'cloud', 'chrome',
  'github', 'slack', 'monday', 'outlook', 'teams', 'calendar', 'onedrive', 'meeting',
  'agentic', 'designer', 'consultant', 'rfp', 'product', 'delivery', 'change', 'architecture', 'plugin',
])

const ICON_SRC: Record<PluginIconId, string> = {
  document: documentIcon,
  word: wordIcon,
  powerpoint: powerpointIcon,
  excel: excelIcon,
  onenote: onenoteIcon,
  invest: investIcon,
  computer: computerIcon,
  cloud: cloudIcon,
  chrome: chromeIcon,
  github: githubIcon,
  slack: slackIcon,
  monday: mondayIcon,
  outlook: outlookIcon,
  teams: teamsIcon,
  calendar: calendarIcon,
  onedrive: onedriveIcon,
  meeting: meetingIcon,
  agentic: agenticIcon,
  designer: designerIcon,
  consultant: consultantIcon,
  rfp: rfpIcon,
  product: productIcon,
  delivery: deliveryIcon,
  change: changeIcon,
  architecture: architectureIcon,
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
  'builtin-ibm-agentic-designer': 'designer',
  'builtin-ibm-agentic-consultant': 'consultant',
  'builtin-ibm-agentic-rfp': 'rfp',
  'builtin-ibm-agentic-product-manager': 'product',
  'builtin-ibm-agentic-delivery-manager': 'delivery',
  'builtin-ibm-agentic-change-manager': 'change',
  'builtin-ibm-agentic-solution-architect': 'architecture',
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
  { keys: ['cloud architect', 'cloud architecture', 'multi-cloud', 'multicloud'], icon: 'cloud' },
  { keys: ['chrome-control', 'contrôle chrome', 'controle chrome', 'bob-work-chrome'], icon: 'chrome' },
  { keys: ['ibm-agentic-designer', 'builtin-ibm-agentic-designer'], icon: 'designer' },
  { keys: ['ibm-agentic-consultant', 'builtin-ibm-agentic-consultant'], icon: 'consultant' },
  { keys: ['ibm-agentic-rfp', 'builtin-ibm-agentic-rfp'], icon: 'rfp' },
  { keys: ['ibm-agentic-product-manager', 'builtin-ibm-agentic-product-manager'], icon: 'product' },
  { keys: ['ibm-agentic-delivery-manager', 'builtin-ibm-agentic-delivery-manager'], icon: 'delivery' },
  { keys: ['ibm-agentic-change-manager', 'builtin-ibm-agentic-change-manager'], icon: 'change' },
  { keys: ['ibm-agentic-solution-architect', 'builtin-ibm-agentic-solution-architect'], icon: 'architecture' },
  { keys: ['github'], icon: 'github' },
  { keys: ['slack'], icon: 'slack' },
  { keys: ['monday'], icon: 'monday' },
  { keys: ['outlook'], icon: 'outlook' },
  { keys: ['teams', 'microsoft teams'], icon: 'teams' },
  { keys: ['outlook-calendar', 'calendrier outlook'], icon: 'calendar' },
  { keys: ['onedrive', 'one drive'], icon: 'onedrive' },
  { keys: ['meeting-minutes', 'compte rendu', 'compte-rendu', 'réunion', 'reunion'], icon: 'meeting' },
  { keys: ['adkar', 'kotter'], icon: 'change' },
  { keys: ['rice', 'jtbd', 'okr'], icon: 'product' },
  { keys: ['mece', 'issue-tree', 'red-team'], icon: 'consultant' },
  { keys: ['c4 model', ' nfr ', 'adr'], icon: 'architecture' },
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
  { keys: ['mermaid'], domain: 'mermaid.js.org' },
  { keys: ['avocat', 'juridique', 'legal', 'contrat', 'notaire'], domain: 'legifrance.gouv.fr' },
  { keys: ['comptable', 'compta', 'fiscal', 'impot'], domain: 'impots.gouv.fr' },
  { keys: ['médecin', 'medecin', 'santé', 'sante', 'clinique', 'hôpital', 'hopital'], domain: 'who.int' },
  { keys: ['recrutement', 'talent', 'ressources humaines', ' rh '], domain: 'linkedin.com' },
  { keys: ['marketing', 'seo', 'campagne'], domain: 'hubspot.com' },
  { keys: ['vente', 'commercial', 'crm'], domain: 'salesforce.com' },
  { keys: ['photographe', 'photographie'], domain: 'flickr.com' },
  { keys: ['cuisine', 'recette', 'chef'], domain: 'marmiton.org' },
  { keys: ['immobilier', 'logement'], domain: 'seloger.com' },
  { keys: ['éducation', 'education', 'pédagogie', 'pedagogie'], domain: 'wikipedia.org' },
  { keys: ['cybersécurité', 'cybersecurite', 'cybersecurity'], domain: 'cisa.gov' },
  { keys: ['kubernetes', 'devops'], domain: 'kubernetes.io' },
]

/** Built-in skills (top-level and nested profession skills) → local icon. */
const BUILTIN_SKILL_ICONS: Record<string, PluginIconId> = {
  'bob-work-meeting-minutes': 'meeting',
  'bob-work-computer-use': 'computer',
  'bob-work-chrome-control': 'chrome',
  'bob-work-documents': 'document',
  'bob-work-microsoft-word': 'word',
  'bob-work-microsoft-powerpoint': 'powerpoint',
  'bob-work-microsoft-excel': 'excel',
  'bob-work-microsoft-onenote': 'onenote',
  'ibm-agentic-designer': 'designer',
  'ibm-agentic-consultant': 'consultant',
  'ibm-agentic-rfp': 'rfp',
  'ibm-agentic-product-manager': 'product',
  'ibm-agentic-delivery-manager': 'delivery',
  'ibm-agentic-change-manager': 'change',
  'ibm-agentic-solution-architect': 'architecture',
  'bob-work-github': 'github',
  'bob-work-slack': 'slack',
  'bob-work-monday': 'monday',
  'bob-work-outlook-mail': 'outlook',
  'bob-work-outlook-calendar': 'calendar',
  'bob-work-teams': 'teams',
  'bob-work-onedrive': 'onedrive',
  'ux-research': 'designer',
  'user-journey': 'designer',
  'information-architecture': 'designer',
  'product-design': 'designer',
  'ui-design': 'designer',
  'design-system': 'designer',
  'design-review': 'designer',
  'ux-heuristics': 'designer',
  'accessibility-audit': 'designer',
  'developer-handoff': 'designer',
  'problem-framing': 'consultant',
  'issue-tree': 'consultant',
  'stakeholder-analysis': 'consultant',
  'process-mapping': 'consultant',
  'gap-analysis': 'consultant',
  'business-case': 'consultant',
  'executive-storytelling': 'consultant',
  'consulting-deck': 'consultant',
  'red-team-review': 'consultant',
  'rfp-analysis': 'rfp',
  'requirements-extraction': 'rfp',
  'compliance-matrix': 'rfp',
  'bid-no-bid': 'rfp',
  'proposal-strategy': 'rfp',
  'proposal-writing': 'rfp',
  'proposal-review': 'rfp',
  'product-discovery': 'product',
  'user-research': 'product',
  'product-strategy': 'product',
  'product-kpi': 'product',
  'user-story': 'product',
  'backlog-management': 'delivery',
  'user-story-review': 'delivery',
  'capacity-planning': 'delivery',
  'sprint-planning': 'delivery',
  'dependency-analysis': 'delivery',
  'sprint-review': 'delivery',
  'release-planning': 'delivery',
  'change-impact-analysis': 'change',
  'stakeholder-mapping': 'change',
  'change-readiness': 'change',
  'resistance-analysis': 'change',
  'communication-plan': 'change',
  'training-plan': 'change',
  'adoption-plan': 'change',
  'change-kpi': 'change',
  'requirements-analysis': 'architecture',
  'architecture-drivers': 'architecture',
  'tradeoff-analysis': 'architecture',
  'solution-architecture': 'architecture',
  'cost-analysis': 'architecture',
  'architecture-review': 'architecture',
}

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
  const normalizedSlug = slug.trim().toLocaleLowerCase()
  if (BUILTIN_SKILL_ICONS[normalizedSlug]) return BUILTIN_SKILL_ICONS[normalizedSlug]
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

export function resolveSkillIcon(skill: {
  slug: string
  name?: string
  description?: string
  icon?: string | null
}): string {
  const declared = skill.icon?.trim()
  if (declared && (ICONS.has(declared) || isRemotePluginIcon(declared))) return declared
  return inferPluginIcon(skill.slug, skill.name ?? '', skill.description ?? '')
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
