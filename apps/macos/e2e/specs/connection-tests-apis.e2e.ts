import { expect, $, browser } from '@wdio/globals'
import { resolve } from 'node:path'
import {
  approveConfirmations,
  clickSidebar,
  connectIntegrationOAuth,
  ensureHomeReady,
  expectConnectionTestBadge,
  invokeTauri,
  openIntegrationsCategory,
  registerMcpServer,
  selectValue,
} from '../helpers'

/** Real TMDB v3 key used only to validate API-key connection status in e2e. */
const TMDB_API_KEY = process.env.TMDB_API_KEY || 'f3d757824f08ea2cff45eb8f47ca3a1e'
const TMDB_NAME = 'tmdb'
const TMDB_URL = 'https://api.themoviedb.org/3/configuration'
const TMDB_BAD_NAME = 'tmdb-bad-key'
const PUBLIC_API_NAME = 'public-e2e-api'
const PUBLIC_API_URL = 'https://httpbin.org/status/200'
const MCP_ECHO = 'mcp-e2e-echo-conn'
const MCP_ECHO_SCRIPT = resolve(import.meta.dirname, '..', 'fixtures', 'mcp-echo-server.py')

describe('Bob Work — tests de connexion (APIs, MCP, intégrations)', () => {
  before(async () => {
    await ensureHomeReady()
  })

  it('expose les onglets Intégrations / APIs / Serveurs MCP', async () => {
    await clickSidebar('Intégrations et MCP')
    await expect($('button=Intégrations')).toBeDisplayed()
    await expect($('button=APIs')).toBeDisplayed()
    await expect($('button=Serveurs MCP')).toBeDisplayed()
  })

  it('ajoute une API publique et persiste un test de connexion OK', async () => {
    await clickSidebar('Intégrations et MCP')
    await $('button=APIs').click()
    const publicPanel = $('//section[contains(@class, "connector-panel")][.//h3[contains(., "API publique")]]')
    await publicPanel.$('input[placeholder="stooq-public"]').setValue(PUBLIC_API_NAME)
    await selectValue(publicPanel.$('.//label[contains(., "Transport")]//select'), 'http')
    await publicPanel.$('input[placeholder="https://…"]').setValue(PUBLIC_API_URL)
    await publicPanel.$('button=Ajouter l’API publique').click()

    await expect($('div.settings-status*=API publique enregistrée')).toBeDisplayed({ wait: 8_000 })
    await $('button=APIs').click()
    const row = $(`//div[contains(@class, "connector-mini-row")][contains(., "${PUBLIC_API_NAME}")]`)
    await expect(row).toBeDisplayed({ wait: 8_000 })
    await row.$('button=Tester').click()
    await browser.waitUntil(async () => {
      const ok = await row.$('.//span[contains(@class, "plugin-mcp-state")][contains(., "Test réussi")]').isExisting()
      const fail = await row.$('.//span[contains(@class, "plugin-mcp-state")][contains(., "Échec")]').isExisting()
      return ok || fail
    }, { timeout: 20_000, timeoutMsg: 'Le test de connexion API publique n’a pas persisté' })

    const servers = await invokeTauri<Array<{ name: string; lastTest?: { ok: boolean } | null }>>('get_mcp_servers')
    expect(servers.find(item => item.name === PUBLIC_API_NAME)?.lastTest).toBeTruthy()
  })

  it('configure TMDB via le formulaire API + clé et affiche le statut de connexion', async () => {
    await clickSidebar('Intégrations et MCP')
    await $('button=APIs').click()
    const keyedPanel = $('//section[contains(@class, "connector-panel")][.//h3[contains(., "API protégée par clé")]]')
    await keyedPanel.$('input[placeholder="tmdb"]').setValue(TMDB_NAME)
    await selectValue(keyedPanel.$('.//label[contains(., "Transport")]//select'), 'http')
    await keyedPanel.$('input[placeholder="https://api.themoviedb.org/3/configuration"]').setValue(TMDB_URL)
    await selectValue(keyedPanel.$('.//label[contains(., "Mode d’auth")]//select'), 'query')
    await keyedPanel.$('input[placeholder="api_key"]').setValue('api_key')
    await keyedPanel.$('input[placeholder="sk-… / token"]').setValue(TMDB_API_KEY)
    await keyedPanel.$('button=Ajouter l’API avec clé').click()

    await expect($('div.settings-status*=enregistrée')).toBeDisplayed({ wait: 8_000 })
    // Stay on APIs tab — configured list should show TMDB immediately.
    const row = $(`//div[contains(@class, "connector-mini-row")][contains(., "${TMDB_NAME}")]`)
    await expect(row).toBeDisplayed({ wait: 8_000 })
    const untestedTmdb = row.$('.//span[contains(@class, "plugin-mcp-state")][contains(., "Non testé")]')
    if (await untestedTmdb.isExisting()) {
      await row.$('button=Tester').click()
    }
    await browser.waitUntil(async () => {
      const ok = await row.$('.//span[contains(@class, "plugin-mcp-state")][contains(., "Test réussi")]').isExisting()
      const fail = await row.$('.//span[contains(@class, "plugin-mcp-state")][contains(., "Échec")]').isExisting()
      return ok || fail
    }, { timeout: 20_000, timeoutMsg: 'Le test de connexion TMDB n’a pas persisté' })
    await expectConnectionTestBadge(row, 'Test réussi')
  })

  it('affiche Échec pour une clé TMDB invalide', async () => {
    await clickSidebar('Intégrations et MCP')
    await $('button=APIs').click()
    const keyedPanel = $('//section[contains(@class, "connector-panel")][.//h3[contains(., "API protégée par clé")]]')
    await keyedPanel.$('input[placeholder="tmdb"]').setValue(TMDB_BAD_NAME)
    await selectValue(keyedPanel.$('.//label[contains(., "Transport")]//select'), 'http')
    await keyedPanel.$('input[placeholder="https://api.themoviedb.org/3/configuration"]').setValue(TMDB_URL)
    await selectValue(keyedPanel.$('.//label[contains(., "Mode d’auth")]//select'), 'query')
    await keyedPanel.$('input[placeholder="sk-… / token"]').setValue('invalid-key-e2e')
    await keyedPanel.$('button=Ajouter l’API avec clé').click()
    await expect($('div.settings-status*=enregistrée')).toBeDisplayed({ wait: 8_000 })

    const row = $(`//div[contains(@class, "connector-mini-row")][contains(., "${TMDB_BAD_NAME}")]`)
    await row.$('button=Tester').click()
    await expectConnectionTestBadge(row, 'Échec')

    await $('button=Serveurs MCP').click()
    const card = $(`//article[contains(@class, "extension-card")][contains(., "${TMDB_BAD_NAME}")]`)
    await expectConnectionTestBadge(card, 'Échec')
    await approveConfirmations()
    await card.$('button=Supprimer').click()
    await expect(card).not.toExist()
  })

  it('persiste le test de connexion sur un serveur MCP echo', async () => {
    const card = await registerMcpServer(MCP_ECHO, MCP_ECHO_SCRIPT)
    const untested = card.$('.//span[contains(@class, "plugin-mcp-state")][contains(., "Non testé")]')
    if (await untested.isExisting()) {
      await card.$('button=Tester').click()
    }
    await expectConnectionTestBadge(card, 'Test réussi')
  })

  it('teste la connexion MCP derrière une intégration OAuth connectée', async () => {
    await connectIntegrationOAuth('github', 'e2e-github-token', 'e2e-user')
    await openIntegrationsCategory('Dev & collab')
    const githubCard = $('//div[.//div[normalize-space()="GitHub"]]')
    await expect(githubCard.$('.status-dot.green')).toBeDisplayed({ wait: 8_000 })
    await expectConnectionTestBadge(githubCard, 'Non testé')
    await githubCard.$('button=Tester').click()
    await browser.waitUntil(async () => {
      const ok = await githubCard.$('.//span[contains(@class, "plugin-mcp-state")][contains(., "Test réussi")]').isExisting()
      const fail = await githubCard.$('.//span[contains(@class, "plugin-mcp-state")][contains(., "Échec")]').isExisting()
      return ok || fail
    }, { timeout: 20_000, timeoutMsg: 'GitHub connection test did not persist' })
  })

  it('persiste lastTest sur les outils MCP du plugin CTO Investissements', async () => {
    await clickSidebar('Plugins')
    const ctoRow = $('//div[contains(@class, "skill-list-row")][contains(., "CTO Investissements")]')
    await ctoRow.waitForDisplayed({ timeout: 10_000 })
    await ctoRow.$('button.skill-row-main').click()
    const panel = $('aside[aria-label="Détails du plugin CTO Investissements"]')
    await expect(panel).toBeDisplayed({ wait: 8_000 })
    await expect(panel.$('button=Tester la connexion MCP')).toBeDisplayed()

    const results = await invokeTauri<Array<{ ok: boolean; testedAt?: string }>>('test_plugin_mcp', {
      pluginId: 'bob-work-cto-invest',
    })
    expect(results.length).toBeGreaterThan(0)

    await panel.$('button=Tester la connexion MCP').click()
    await browser.waitUntil(async () => {
      const ok = await panel.$('.//span[contains(@class, "plugin-mcp-state")][contains(., "Test réussi")]').isExisting()
      const fail = await panel.$('.//span[contains(@class, "plugin-mcp-state")][contains(., "Échec")]').isExisting()
      return ok || fail
    }, { timeout: 30_000, timeoutMsg: 'Plugin MCP connection test did not update badges' })
  })

  it('nettoie les serveurs MCP / APIs de test', async () => {
    await clickSidebar('Intégrations et MCP')
    await $('button=Serveurs MCP').click()
    for (const name of [PUBLIC_API_NAME, TMDB_NAME, TMDB_BAD_NAME, MCP_ECHO]) {
      const card = $(`//article[contains(@class, "extension-card")][contains(., "${name}")]`)
      if (await card.isExisting()) {
        await approveConfirmations()
        await card.$('button=Supprimer').click()
        await expect(card).not.toExist()
      }
    }
    await invokeTauri('disconnect_integration', { integrationId: 'github' }).catch(() => undefined)
  })
})
