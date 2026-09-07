export interface IntegrationDef {
  id: string
  name: string
  descriptionKey: string
  oauthProvider: string
  tools?: string[]
  group: 'developer' | 'microsoft'
  tokenHintKey: string
  permissionKeys: string[]
  shortKey: string
  webOnly?: boolean
}

export const CATALOG: IntegrationDef[] = [
  {
    id: 'github', name: 'GitHub', oauthProvider: 'github', group: 'developer',
    descriptionKey: 'integrations.githubDescription',
    shortKey: 'integrations.githubShort',
    tools: ['github_list_repos', 'github_search_issues', 'github_get_pull_request'],
    tokenHintKey: 'integrations.githubTokenHint',
    permissionKeys: ['integrations.githubPermRepo', 'integrations.githubPermProfile', 'integrations.githubPermOrg'],
  },
  {
    id: 'slack', name: 'Slack', oauthProvider: 'slack', group: 'developer',
    descriptionKey: 'integrations.slackDescription',
    shortKey: 'integrations.slackShort',
    tools: ['slack_search_messages', 'slack_list_channels', 'slack_post_message'],
    tokenHintKey: 'integrations.slackTokenHint',
    permissionKeys: [
      'integrations.slackPermChannels',
      'integrations.slackPermChat',
      'integrations.slackPermSearch',
      'integrations.slackPermUsers',
    ],
    webOnly: true,
  },
  {
    id: 'monday', name: 'Monday.com', oauthProvider: 'monday', group: 'developer',
    descriptionKey: 'integrations.mondayDescription',
    shortKey: 'integrations.mondayShort',
    tools: ['monday_list_boards', 'monday_search_items', 'monday_create_update'],
    tokenHintKey: 'integrations.mondayTokenHint',
    permissionKeys: ['integrations.mondayPermBoards', 'integrations.mondayPermUpdates', 'integrations.mondayPermAccount'],
    webOnly: true,
  },
  {
    id: 'outlook-mail', name: 'Outlook', oauthProvider: 'microsoft', group: 'microsoft',
    descriptionKey: 'integrations.outlookDescription',
    shortKey: 'integrations.outlookShort',
    tools: ['graph_search_mail'],
    tokenHintKey: 'integrations.outlookTokenHint',
    permissionKeys: ['integrations.outlookPermMail', 'integrations.outlookPermSend'],
  },
  {
    id: 'teams', name: 'Microsoft Teams', oauthProvider: 'microsoft', group: 'microsoft',
    descriptionKey: 'integrations.teamsDescription',
    shortKey: 'integrations.teamsShort',
    tools: ['graph_list_teams'],
    tokenHintKey: 'integrations.microsoftGraphTokenHint',
    permissionKeys: ['integrations.teamsPermTeams', 'integrations.teamsPermMessages'],
  },
  {
    id: 'outlook-calendar', name: 'Outlook Calendar', oauthProvider: 'microsoft', group: 'microsoft',
    descriptionKey: 'integrations.calendarDescription',
    shortKey: 'integrations.calendarShort',
    tools: ['graph_list_calendar_events'],
    tokenHintKey: 'integrations.microsoftGraphTokenHint',
    permissionKeys: ['integrations.calendarPerm'],
  },
  {
    id: 'onedrive', name: 'OneDrive', oauthProvider: 'microsoft', group: 'microsoft',
    descriptionKey: 'integrations.onedriveDescription',
    shortKey: 'integrations.onedriveShort',
    tools: ['graph_search_onedrive'],
    tokenHintKey: 'integrations.microsoftGraphTokenHint',
    permissionKeys: ['integrations.onedrivePerm'],
  },
  {
    id: 'onenote', name: 'OneNote', oauthProvider: 'microsoft', group: 'microsoft',
    descriptionKey: 'integrations.onenoteDescription',
    shortKey: 'integrations.onenoteShort',
    tools: ['graph_onenote'],
    tokenHintKey: 'integrations.microsoftGraphTokenHint',
    permissionKeys: ['integrations.onenotePerm'],
  },
]
