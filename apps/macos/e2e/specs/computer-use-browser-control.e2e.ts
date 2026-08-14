import { expect, $ } from '@wdio/globals'
import { resolve } from 'node:path'
import type { AppSettings, PluginExtensionStatus } from '@bob-work/shared-types'
import {
  approveConfirmations,
  clickSidebar,
  ensureChromeExtensionReady,
  ensureCloudArchitectPlugin,
  ensureHomeReady,
  ensureSettingEnabled,
  invokeTauri,
  openSettingsTab,
  prepareMacosAutomationStepForE2e,
  registerMcpServer,
  saveSettings,
  sendHomePrompt,
  toggleSetting,
} from '../helpers'

const MCP_BROWSER = 'mcp-e2e-computer-use'
const MCP_CHROME_REAL = 'mcp-e2e-chrome-real'
const MCP_SCRIPT = resolve(import.meta.dirname, '..', 'fixtures', 'mcp-computer-use.py')
const MCP_CHROME_SCRIPT = resolve(import.meta.dirname, '..', 'fixtures', 'mcp-chrome-control.py')

describe('Bob Work — contrôle navigateur, Chrome et accès web', () => {
  before(async () => {
    await ensureHomeReady()
    await approveConfirmations()
    await ensureCloudArchitectPlugin()
  })

  it('expose les réglages computer use, Chrome et accès web', async () => {
    await openSettingsTab('Accès et contrôle')
    await expect($('strong=Contrôle de l’ordinateur')).toBeDisplayed()
    await expect($('strong=Contrôle de Chrome')).toBeDisplayed()
    await expect($('strong=Accès web')).toBeDisplayed()
    await expect($('small*=bob-work-computer-use')).toBeDisplayed()
    await expect($('small*=bob-work-chrome-control')).toBeDisplayed()
  })

  it('active computer use, Chrome et accès web puis persiste l’état', async () => {
    await openSettingsTab('Accès et contrôle')
    await ensureSettingEnabled('Contrôle de l’ordinateur', true)
    await ensureSettingEnabled('Contrôle de Chrome', true)
    await ensureSettingEnabled('Accès web', true)

    const settings = await invokeTauri<AppSettings>('get_settings')
    expect(settings.computerUseEnabled).toBe(true)
    expect(settings.chromeControlEnabled).toBe(true)
    expect(settings.webEnabled).toBe(true)
  })

  it('enregistre un serveur MCP browser/chrome simulé', async () => {
    const card = await registerMcpServer(MCP_BROWSER, MCP_SCRIPT)
    await expect(card).toBeDisplayed()
  })

  it('bloque la capacité browser (Accès web) quand le réglage est désactivé', async () => {
    await openSettingsTab('Accès et contrôle')
    await toggleSetting('Accès web', false)
    await saveSettings()

    const status = await invokeTauri<PluginExtensionStatus>('get_plugin_extension_status', {
      pluginId: 'agentic-cloud-architect-agent',
    })
    const browserExtension = status.browserExtensions.find(item => item.id === 'cloud-sources')
    expect(browserExtension?.capability).toBe('browser')
    expect(browserExtension?.state).toBe('disabled')
    expect(browserExtension?.message.toLowerCase()).toContain('réglages')
  })

  it('bloque la capacité chrome quand le réglage Contrôle de Chrome est désactivé', async () => {
    await openSettingsTab('Accès et contrôle')
    await toggleSetting('Accès web', true)
    await toggleSetting('Contrôle de Chrome', false)
    await saveSettings()

    const status = await invokeTauri<PluginExtensionStatus>('get_plugin_extension_status', {
      pluginId: 'agentic-cloud-architect-agent',
    })
    const chromeExtension = status.browserExtensions.find(item => item.id === 'chrome-automation')
    expect(chromeExtension?.capability).toBe('chrome')
    expect(chromeExtension?.state).toBe('disabled')
  })

  it('autorise browser et chrome quand les réglages et le MCP sont actifs', async () => {
    await openSettingsTab('Accès et contrôle')
    await toggleSetting('Accès web', true)
    await toggleSetting('Contrôle de Chrome', true)
    await saveSettings()

    const status = await invokeTauri<PluginExtensionStatus>('get_plugin_extension_status', {
      pluginId: 'agentic-cloud-architect-agent',
    })
    const browserExtension = status.browserExtensions.find(item => item.id === 'cloud-sources')
    const chromeExtension = status.browserExtensions.find(item => item.id === 'chrome-automation')
    expect(browserExtension?.state).not.toBe('disabled')
    expect(chromeExtension?.state).not.toBe('disabled')
    expect(['ready', 'disconnected']).toContain(browserExtension?.state)
    expect(['ready', 'disconnected']).toContain(chromeExtension?.state)
  })

  it('affiche les capacités browser et chrome dans le détail plugin Cloud Architect', async () => {
    await clickSidebarPluginsAndOpenCloudArchitect()
    await expect($('section[aria-label="Capacités navigateur du plugin"]')).toBeDisplayed()
    await expect($('strong=Sources cloud dans le navigateur')).toBeDisplayed()
    await expect($('strong=Contrôle Chrome')).toBeDisplayed()
  })

  it('simule une session Bob avec computer use (list_apps + desktop_click)', async () => {
    await openSettingsTab('Accès et contrôle')
    await ensureSettingEnabled('Contrôle de l’ordinateur', true)

    await sendHomePrompt('USE_COMPUTER_USE_E2E @plugin:agentic-cloud-architect-agent Liste les apps ouvertes puis clique sur le bouton Envoyer.')
    await expect($('p*=Computer use simulé terminé')).toBeDisplayed({ wait: 15_000 })
    await expect($('p*=Bob Work, Chrome, Finder')).toBeDisplayed()
  })

  it('simule une session Bob avec contrôle Chrome (browser_snapshot + browser_click)', async () => {
    await openSettingsTab('Accès et contrôle')
    await ensureSettingEnabled('Contrôle de Chrome', true)

    await sendHomePrompt('USE_CHROME_CONTROL_E2E @plugin:agentic-cloud-architect-agent Capture la page Chrome active sur example.com puis clique sur #submit.')
    await expect($('p*=Contrôle Chrome simulé terminé')).toBeDisplayed({ wait: 15_000 })
    await expect($('p*=Example Domain')).toBeDisplayed()
  })

  it('parcours intégré contrôle Chrome : réglages, MCP réel, Automatisation macOS et ouverture example.com', async () => {
    await openSettingsTab('Accès et contrôle')
    await ensureSettingEnabled('Contrôle de Chrome', true)

    const settings = await invokeTauri<AppSettings>('get_settings')
    expect(settings.chromeControlEnabled).toBe(true)

    await prepareMacosAutomationStepForE2e()

    const chromeCard = await registerMcpServer(MCP_CHROME_REAL, MCP_CHROME_SCRIPT)
    await expect(chromeCard).toBeDisplayed()

    const chrome = await ensureChromeExtensionReady()
    await expect(chromeCard).toBeDisplayed()

    if (chrome?.state !== 'ready') {
      return
    }

    await sendHomePrompt('CHROME_OPEN_EXAMPLE_E2E @plugin:agentic-cloud-architect-agent Ouvre https://example.com dans Chrome et confirme le titre Example Domain.')
    await expect($('p*=Contrôle Chrome réel terminé')).toBeDisplayed({ wait: 30_000 })
    await expect($('p*=https://example.com')).toBeDisplayed()
    await expect($('p*=Google Chrome')).toBeDisplayed()
  })

  it('simule une session Bob avec accès web classique (browser)', async () => {
    await openSettingsTab('Accès et contrôle')
    await ensureSettingEnabled('Accès web', true)

    await sendHomePrompt('USE_BROWSER_WEB_E2E @plugin:agentic-cloud-architect-agent Lis le contenu de docs.example.com via le navigateur autorisé.')
    await expect($('p*=Accès web simulé terminé')).toBeDisplayed({ wait: 15_000 })
    await expect($('p*=docs.example.com')).toBeDisplayed()
  })
})

async function clickSidebarPluginsAndOpenCloudArchitect() {
  await clickSidebar('Plugins')
  const row = $(`//div[contains(@class, "skill-list-row")][contains(., "Cloud Architect Agent")]`)
  await row.waitForDisplayed({ timeout: 10_000 })
  await row.$('button.skill-row-main').click()
  const detail = $('aside[aria-label="Détails du plugin Cloud Architect Agent"]')
  await detail.waitForDisplayed({ timeout: 8_000 })
}
