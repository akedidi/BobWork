import { expect, $ } from '@wdio/globals'
import { resolve } from 'node:path'
import {
  approveConfirmations,
  clickSidebar,
  connectIntegrationOAuth,
  ensureHomeReady,
  invokeTauri,
  openIntegrationsCategory,
  openHomeChatComposer,
  pickBuiltinPlugin,
  registerMcpServer,
  seedOAuthProvider,
  sendHomePrompt,
  waitForVisible,
} from '../helpers'

const MCP_ECHO = 'mcp-e2e-echo'
const MCP_HUB = 'mcp-e2e-hub'
const MCP_ECHO_SCRIPT = resolve(import.meta.dirname, '..', 'fixtures', 'mcp-echo-server.py')
const MCP_HUB_SCRIPT = resolve(import.meta.dirname, '..', 'fixtures', 'mcp-integration-hub.py')

const BUILTIN_PLUGINS = [
  {
    label: 'Documents',
    token: '@plugin:builtin-documents',
    iconClass: 'plugin-icon--document',
    marker: 'USE_BUILTIN_DOCUMENTS_PLUGIN_E2E',
    success: 'Plugin Documents utilisé',
    toolHint: 'notes.md',
  },
  {
    label: 'Microsoft Word',
    token: /@plugin:builtin-word|@skill:bob-work-microsoft-word/,
    iconClass: 'plugin-icon--word',
    marker: 'USE_BUILTIN_WORD_PLUGIN_E2E',
    success: 'Plugin Microsoft Word utilisé',
    toolHint: 'draft.docx',
  },
  {
    label: 'Microsoft Excel',
    token: /@plugin:builtin-excel|@skill:bob-work-microsoft-excel/,
    iconClass: 'plugin-icon--excel',
    marker: 'USE_BUILTIN_EXCEL_PLUGIN_E2E',
    success: 'Plugin Microsoft Excel utilisé',
    toolHint: 'workbook.xlsx',
  },
  {
    label: 'Microsoft PowerPoint',
    token: /@plugin:builtin-powerpoint|@skill:bob-work-microsoft-powerpoint/,
    iconClass: 'plugin-icon--powerpoint',
    marker: 'USE_BUILTIN_POWERPOINT_PLUGIN_E2E',
    success: 'Plugin Microsoft PowerPoint utilisé',
    toolHint: 'deck.pptx',
  },
  {
    label: 'Microsoft OneNote',
    token: /@plugin:builtin-onenote|@skill:bob-work-microsoft-onenote/,
    iconClass: 'plugin-icon--onenote',
    marker: 'USE_BUILTIN_ONENOTE_PLUGIN_E2E',
    success: 'Plugin Microsoft OneNote utilisé',
    toolHint: 'page-one.onenote',
    requiresMicrosoft: true,
  },
  {
    label: 'CTO Investissements',
    token: '@plugin:bob-work-cto-invest',
    iconClass: 'plugin-icon--invest',
    marker: 'USE_BUILTIN_CTO_INVEST_PLUGIN_E2E',
    success: 'Plugin CTO Investissements utilisé',
    toolHint: 'cto_market_snapshot',
  },
] as const

describe('Bob Work — plugins intégrés, intégrations OAuth et MCP connus', () => {
  before(async () => {
    await ensureHomeReady()
  })

  it('affiche les plugins documentaires et CTO avec leurs icônes', async () => {
    await clickSidebar('Plugins')
    for (const plugin of BUILTIN_PLUGINS) {
      await expect($(`strong=${plugin.label}`)).toBeDisplayed()
      const row = $(`//div[contains(@class, "skill-list-row")][contains(., "${plugin.label}")]`)
      await expect(row.$(`.${plugin.iconClass}`)).toBeDisplayed()
    }
    await expect($('strong=Microsoft OneNote')).toBeDisplayed()
    await expect($('strong=CTO Investissements')).toBeDisplayed()
    const ctoRow = $('//div[contains(@class, "skill-list-row")][contains(., "CTO Investissements")]')
    expect(await ctoRow.getText()).not.toContain('Intégré')
  })

  for (const plugin of BUILTIN_PLUGINS) {
    it(`exécute le plugin ${plugin.label} via le composeur`, async () => {
      if ('requiresMicrosoft' in plugin && plugin.requiresMicrosoft) {
        await seedOAuthProvider('microsoft', 'e2e-microsoft-token', 'e2e@contoso.com')
        await invokeTauri('install_builtin_integration', { integrationId: 'outlook-mail' })
      }

      const composer = await pickBuiltinPlugin(plugin.label, plugin.token)
      await composer.addValue(` ${plugin.marker}`)
      await $('button[aria-label="Envoyer le prompt"]').click()

      await expect($(`p*=${plugin.success}`)).toBeDisplayed({ wait: 25_000 })
      await $('button[title="Activité, sources et fichiers"]').click()
      const panel = $('aside[aria-label="Aperçus et activité"]')
      await expect(panel.$(`.//div[@data-event-type="tool_started"][contains(., "${plugin.toolHint}")]`)).toBeDisplayed()
      await $('button[title="Fermer le panneau"]').click()
    })
  }

  it('connecte Slack et Monday via OAuth puis installe leurs skills', async () => {
    await connectIntegrationOAuth('slack', 'e2e-slack-token', 'e2e-workspace')
    await connectIntegrationOAuth('monday', 'e2e-monday-token', 'e2e@monday.com')

    await clickSidebar('Skills')
    await expect($('strong=bob-work-slack')).toBeDisplayed()
    await expect($('strong=bob-work-monday')).toBeDisplayed()
  })

  it('synchronise les connecteurs MCP OAuth (GitHub, Slack, Monday, Microsoft)', async () => {
    await connectIntegrationOAuth('github', 'e2e-github-token', 'e2e-user')

    await clickSidebar('Intégrations et MCP')
    await $('button=Serveurs MCP').click()
    for (const server of ['bob-work-github', 'bob-work-slack', 'bob-work-monday']) {
      const card = $(`//article[contains(@class, "extension-card")][contains(., "${server}")]`)
      await expect(card).toBeDisplayed({ wait: 8_000 })
      await expect(card.$('input[type="checkbox"]')).toBeChecked()
    }

    await seedOAuthProvider('microsoft', 'e2e-microsoft-token', 'e2e@contoso.com')
    await connectIntegrationOAuth('outlook-mail', 'e2e-microsoft-token', 'e2e@contoso.com')
    const microsoftCard = $('//article[contains(@class, "extension-card")][contains(., "bob-work-microsoft")]')
    await expect(microsoftCard).toBeDisplayed({ wait: 8_000 })
    await expect(microsoftCard.$('input[type="checkbox"]')).toBeChecked()
  })

  it('exécute les connecteurs MCP intégrés via use_mcp_tool', async () => {
    await sendHomePrompt('USE_GITHUB_CONNECTOR_MCP_E2E Liste les dépôts via le connecteur MCP GitHub.')
    await expect($('p*=Connecteur MCP GitHub opérationnel')).toBeDisplayed({ wait: 25_000 })
    await expect($('p*=2 dépôts mockés')).toBeDisplayed()

    await sendHomePrompt('USE_SLACK_CONNECTOR_MCP_E2E Liste les canaux via le connecteur MCP Slack.')
    await expect($('p*=Connecteur MCP Slack opérationnel')).toBeDisplayed({ wait: 25_000 })

    await sendHomePrompt('USE_MONDAY_CONNECTOR_MCP_E2E Liste les tableaux via le connecteur MCP Monday.')
    await expect($('p*=Connecteur MCP Monday.com opérationnel')).toBeDisplayed({ wait: 25_000 })

    await sendHomePrompt('USE_MICROSOFT_CONNECTOR_MCP_E2E Liste les équipes via le connecteur MCP Microsoft.')
    await waitForVisible('p*=Connecteur MCP Microsoft 365 opérationnel')
  })

  it('injecte Slack et Monday dans Bob Shell lors de tâches réelles', async () => {
    await connectIntegrationOAuth('slack', 'e2e-slack-token', 'e2e-workspace')
    await connectIntegrationOAuth('monday', 'e2e-monday-token', 'e2e@monday.com')
    await sendHomePrompt('SLACK_INTEGRATION_E2E @skill:bob-work-slack Recherche les messages récents.')
    await expect($('p*=Intégration Slack active')).toBeDisplayed({ wait: 25_000 })

    await sendHomePrompt('MONDAY_INTEGRATION_E2E @skill:bob-work-monday Liste les tableaux accessibles.')
    await expect($('p*=Intégration Monday.com active')).toBeDisplayed({ wait: 25_000 })
  })

  it('simule une connexion Microsoft OAuth et exécute Outlook via Graph', async () => {
    await seedOAuthProvider('microsoft', 'e2e-microsoft-token', 'e2e@contoso.com')
    await connectIntegrationOAuth('outlook-mail', 'e2e-microsoft-token', 'e2e@contoso.com')
    await openIntegrationsCategory('Microsoft 365')
    const outlookCard = $('//div[.//div[normalize-space()="Outlook"]]')
    await expect(outlookCard.$('.status-dot.green')).toBeDisplayed({ wait: 8_000 })

    await sendHomePrompt('MICROSOFT_INTEGRATION_E2E @skill:bob-work-outlook-mail Cherche les messages récents.')
    await expect($('p*=Intégration Microsoft Outlook active')).toBeDisplayed({ wait: 25_000 })
  })

  it('enregistre deux serveurs MCP connus (echo + hub) et les active', async () => {
    const echoCard = await registerMcpServer(MCP_ECHO, MCP_ECHO_SCRIPT)
    const hubCard = await registerMcpServer(MCP_HUB, MCP_HUB_SCRIPT)
    await expect(echoCard.$('input[type="checkbox"]')).toBeChecked()
    await expect(hubCard.$('input[type="checkbox"]')).toBeChecked()
  })

  it('exécute le serveur MCP echo_text', async () => {
    await sendHomePrompt('USE_MCP_ECHO_E2E Vérifie que le serveur MCP echo_text répond correctement.')
    await $('p*=Serveur MCP mcp-e2e-echo opérationnel').waitForDisplayed({ timeout: 25_000 })
    await expect($('p*=echo:integration-mcp')).toBeDisplayed()
  })

  it('exécute le serveur MCP hub multi-outils (catalogue + GitHub mock)', async () => {
    await sendHomePrompt('USE_MCP_HUB_E2E Interroge le serveur MCP hub et ses connecteurs simulés.')
    await expect($('p*=Serveur MCP mcp-e2e-hub opérationnel')).toBeDisplayed({ wait: 25_000 })
    await expect($('p*=4 connecteurs simulés')).toBeDisplayed()
    await expect($('p*=2 dépôts GitHub mockés')).toBeDisplayed()
    await $('button[title="Activité, sources et fichiers"]').click()
    const panel = $('aside[aria-label="Aperçus et activité"]')
    await expect(panel.$('.//div[@data-event-type="tool_started"][contains(., "list_known_integrations")]')).toBeDisplayed()
    await expect(panel.$('.//div[@data-event-type="tool_started"][contains(., "mock_github_repos")]')).toBeDisplayed()
    await $('button[title="Fermer le panneau"]').click()
  })

  it('nettoie les intégrations et serveurs MCP de test', async () => {
    await clickSidebar('Intégrations et MCP')

    for (const name of ['Slack', 'Monday.com']) {
      await $('button=Intégrations').click()
      await $('button=Dev & collab').click()
      const card = $(`//div[.//div[normalize-space()="${name}"]][.//button[contains(., "Déconnecter")]]`)
      if (await card.isExisting()) {
        await approveConfirmations()
        await card.$('button=Déconnecter').click()
      }
    }

    await invokeTauri('disconnect_integration', { integrationId: 'outlook-mail' })
    await invokeTauri('disconnect_integration', { integrationId: 'github' })

    await $('button=Serveurs MCP').click()
    for (const server of [MCP_ECHO, MCP_HUB]) {
      const card = $(`//article[contains(@class, "extension-card")][contains(., "${server}")]`)
      if (await card.isExisting()) {
        await approveConfirmations()
        await card.$('button=Supprimer').click()
        await expect(card).not.toExist()
      }
    }
  })
})
