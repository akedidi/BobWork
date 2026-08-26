export interface IntegrationDef {
  id: string
  name: string
  description: string
  oauthProvider: string
  tools?: string[]
  group: 'developer' | 'microsoft'
  tokenHint: string
  permissions: string[]
  webOnly?: boolean
}

export const CATALOG: IntegrationDef[] = [
  {
    id: 'github', name: 'GitHub', oauthProvider: 'github', group: 'developer',
    description: 'Parcourir dépôts, issues et pull requests avec votre compte GitHub.',
    tools: ['github_list_repos', 'github_search_issues', 'github_get_pull_request'],
    tokenHint: 'GitHub → Settings → Developer settings → Personal access tokens',
    permissions: ['Dépôts privés et publics (repo)', 'Profil (read:user)', 'Organisations (read:org)'],
  },
  {
    id: 'slack', name: 'Slack', oauthProvider: 'slack', group: 'developer',
    description: 'Rechercher des messages et publier dans les canaux autorisés.',
    tools: ['slack_search_messages', 'slack_list_channels', 'slack_post_message'],
    tokenHint: 'Slack → votre app → OAuth & Permissions → User OAuth Token (xoxp-…)',
    permissions: [
      'Canaux et historique (channels/groups/im)',
      'Envoi de messages (chat:write)',
      'Recherche (search:read)',
      'Profils (users:read)',
    ],
    webOnly: true,
  },
  {
    id: 'monday', name: 'Monday.com', oauthProvider: 'monday', group: 'developer',
    description: 'Consulter et mettre à jour vos tableaux Monday.com.',
    tools: ['monday_list_boards', 'monday_search_items', 'monday_create_update'],
    tokenHint: 'Monday.com → Avatar → Developers → My access tokens → API token',
    permissions: ['Tableaux (lecture/écriture)', 'Mises à jour (lecture/écriture)', 'Profil et compte (lecture)'],
    webOnly: true,
  },
  {
    id: 'outlook-mail', name: 'Outlook', oauthProvider: 'microsoft', group: 'microsoft',
    description: 'Lire, rechercher et préparer des e-mails via Microsoft Graph.',
    tools: ['graph_search_mail'],
    tokenHint: 'Microsoft Entra / Graph Explorer → jeton d’accès avec Mail.Read',
    permissions: ['Courrier (Mail.ReadWrite)', 'Envoi d’e-mails (Mail.Send)'],
  },
  {
    id: 'teams', name: 'Microsoft Teams', oauthProvider: 'microsoft', group: 'microsoft',
    description: 'Accéder aux équipes, canaux et messages Teams.',
    tools: ['graph_list_teams'],
    tokenHint: 'Couvert par le même jeton Microsoft Graph que Outlook',
    permissions: ['Équipes (Team.ReadBasic.All)', 'Messages de canaux (ChannelMessage.Read.All)'],
  },
  {
    id: 'outlook-calendar', name: 'Calendrier Outlook', oauthProvider: 'microsoft', group: 'microsoft',
    description: 'Consulter et gérer votre calendrier Microsoft 365.',
    tools: ['graph_list_calendar_events'],
    tokenHint: 'Couvert par le même jeton Microsoft Graph que Outlook',
    permissions: ['Calendriers (Calendars.ReadWrite)'],
  },
  {
    id: 'onedrive', name: 'OneDrive', oauthProvider: 'microsoft', group: 'microsoft',
    description: 'Rechercher, lire et déposer des fichiers OneDrive.',
    tools: ['graph_search_onedrive'],
    tokenHint: 'Couvert par le même jeton Microsoft Graph que Outlook',
    permissions: ['Fichiers OneDrive (Files.ReadWrite.All)'],
  },
  {
    id: 'onenote', name: 'OneNote', oauthProvider: 'microsoft', group: 'microsoft',
    description: 'Lire et organiser des carnets OneNote via Microsoft Graph.',
    tools: ['graph_onenote'],
    tokenHint: 'Couvert par le même jeton Microsoft Graph que Outlook',
    permissions: ['Notes OneNote (Notes.Read / Notes.ReadWrite)'],
  },
]
