import { browser, expect, $ } from '@wdio/globals'

export function labelled(label: string, control: 'input' | 'textarea' | 'select' = 'input') {
  return $(`//label[contains(normalize-space(.), "${label}")]//${control}`)
}

export async function clickSidebar(label: string) {
  const item = $(`//div[contains(@class, "sidebar-item")][contains(normalize-space(.), "${label}")]`)
  await item.waitForClickable()
  await item.click()
}

export async function approveConfirmations() {
  await browser.execute(() => {
    window.confirm = () => true
  })
}

export async function selectValue(select: WebdriverIO.Element, value: string) {
  await browser.execute((node, nextValue) => {
    const control = node as unknown as HTMLSelectElement
    control.value = nextValue
    control.dispatchEvent(new Event('change', { bubbles: true }))
  }, select, value)
}

async function completeOnboardingIfNeeded() {
  const configureBob = $('button=Configurer Bob')
  if (!(await configureBob.isExisting())) return

  await configureBob.click()
  await $('h1=Configurer IBM Bob').waitForDisplayed({ timeout: 8_000 })
  await $('input[aria-label="Clé API IBM Bob"]').setValue('e2e-headless-session-key')
  await $('button=Enregistrer dans le coffre').click()
  await $('h1=IBM Bob est prêt').waitForDisplayed({ timeout: 12_000 })
  await $('button=Continuer').click()
  await $('span=Réglages').waitForDisplayed({ timeout: 12_000 })
}

async function ensureBobSessionKey() {
  await clickSidebar('Nouveau chat')
  await $('span=Réglages').click()
  await $('button=IBM Bob Shell').click()
  const useSession = $('button=Enregistrer dans le coffre')
  if (await useSession.isExisting()) {
    const sessionKey = $('input[aria-label="Clé d’inférence IBM Bob"]')
    await sessionKey.setValue('e2e-headless-session-key')
    await useSession.click()
    await $('button=Effacer du coffre').waitForDisplayed({ timeout: 12_000 })
  }
  await clickSidebar('Nouveau chat')
}

export async function ensureHomeReady() {
  await completeOnboardingIfNeeded()
  await ensureBobSessionKey()

  const homeComposer = $('textarea[placeholder="Sur quoi travailler ?"]')
  if (await homeComposer.isExisting()) {
    await homeComposer.waitForDisplayed({ timeout: 8_000 })
    return
  }

  const projectComposer = $('textarea[placeholder="Travailler avec Bob…"]')
  if (await projectComposer.isExisting()) {
    await clickSidebar('Nouveau chat')
    await homeComposer.waitForDisplayed({ timeout: 8_000 })
    return
  }

  const settingsHeading = $('h2=Réglages')
  if (await settingsHeading.isExisting()) {
    await clickSidebar('Nouveau chat')
    await homeComposer.waitForDisplayed({ timeout: 8_000 })
    return
  }

  await homeComposer.waitForDisplayed({ timeout: 15_000 })
}

export async function openPluginPicker() {
  await $('button[title="Joindre un fichier ou un dossier"]').click()
  const menu = $('[role="menu"][aria-label="Ajouter une pièce jointe"]')
  await menu.waitForDisplayed()
  return menu
}

export async function invokeTauri<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  return browser.execute(async (cmd, payload) => {
    const globalTauri = (window as unknown as {
      __TAURI__?: { core?: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } }
    }).__TAURI__
    if (globalTauri?.core?.invoke) {
      return globalTauri.core.invoke(cmd, payload) as Promise<T>
    }
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke(cmd, payload) as Promise<T>
  }, command, args)
}

export async function openHomeChatComposer() {
  await clickSidebar('Nouveau chat')
  const composer = $('textarea[placeholder="Sur quoi travailler ?"]')
  await composer.waitForDisplayed({ timeout: 12_000 })
  return composer
}

export async function sendHomePrompt(text: string) {
  const composer = await openHomeChatComposer()
  await composer.setValue(text)
  await $('button[aria-label="Envoyer le prompt"]').click()
}

export async function pickBuiltinPlugin(pluginLabel: string, pluginToken: string) {
  const composer = await openHomeChatComposer()
  const menu = await openPluginPicker()
  const choice = menu.$(`//button[contains(@class, "attach-plugin-row")][contains(., "${pluginLabel}")]`)
  await choice.waitForDisplayed({ timeout: 8_000 })
  await choice.click()
  expect(await composer.getValue()).toContain(pluginToken)
  return composer
}

export async function connectIntegrationOAuth(integrationId: string, accessToken: string, accountLabel?: string) {
  await invokeTauri('e2e_connect_integration', { integrationId, accessToken, accountLabel })
}

export async function seedOAuthProvider(provider: string, accessToken: string, accountLabel?: string) {
  await invokeTauri('e2e_seed_oauth_token', { provider, accessToken, accountLabel })
}

export async function registerMcpServer(name: string, scriptPath: string) {
  await clickSidebar('Intégrations et MCP')
  await $('button=Serveurs MCP').click()
  await $('input[placeholder="mon-serveur"]').setValue(name)
  await selectValue(await labelled('Transport', 'select'), 'stdio')
  await $('input[placeholder="/chemin/serveur"]').setValue(scriptPath)
  await $('button=Ajouter avec Bob Shell').click()
  const serverCard = $(`//article[contains(@class, "extension-card")][contains(., "${name}")]`)
  await serverCard.waitForDisplayed({ timeout: 10_000 })
  return serverCard
}

export async function ensureCloudArchitectPlugin() {
  await clickSidebar('Plugins')
  const row = $('//div[contains(@class, "skill-list-row")][contains(., "Cloud Architect Agent")]')
  if (await row.isExisting()) {
    await clickSidebar('Nouveau chat')
    return
  }
  await clickSidebar('Nouveau chat')
  const creator = $('textarea[placeholder="Sur quoi travailler ?"]')
  await creator.waitForDisplayed({ timeout: 12_000 })
  await creator.setValue('CREATE_CLOUD_ARCHITECT_PLUGIN_E2E Crée un plugin agentique Cloud Architect avec un outil Python utilisable en CLI, local et sans dépendance réseau.')
  await $('button[aria-label="Envoyer le prompt"]').click()
  await $('p*=Plugin Cloud Architect Agent créé').waitForDisplayed({ timeout: 15_000 })
}

export async function openSettingsTab(label: string) {
  await $('span=Réglages').click()
  await $('h2=Réglages').waitForDisplayed({ timeout: 8_000 })
  await $(`button=${label}`).click()
}

/** Returns true when the toggle actually changed (a save will follow). */
export async function toggleSetting(label: string, enabled: boolean) {
  const toggle = labelled(label)
  const selected = await toggle.isSelected()
  if (selected === enabled) return false
  await toggle.click()
  return true
}

/** Toggles a setting and waits for the auto-save only if a change occurred. */
export async function ensureSettingEnabled(label: string, enabled: boolean) {
  if (await toggleSetting(label, enabled)) await saveSettings()
}

export async function saveSettings() {
  await browser.pause(500)
  await $('div.settings-status=Réglages enregistrés.').waitForDisplayed({ timeout: 8_000 })
}

export async function prepareMacosAutomationStepForE2e() {
  await openSettingsTab('Accès et contrôle')
  await $('button=Ouvrir Automatisation (Réglages Système)').waitForDisplayed({ timeout: 8_000 })
  await invokeTauri('open_macos_privacy_pane', { pane: 'automation' })
  await invokeTauri('e2e_ack_macos_automation')
}

export async function ensureChromeExtensionReady() {
  const status = await invokeTauri<{ browserExtensions: Array<{ id: string; state: string; capability: string }> }>(
    'get_plugin_extension_status',
    { pluginId: 'agentic-cloud-architect-agent' },
  )
  const chromeExtension = status.browserExtensions.find(item => item.id === 'chrome-automation')
  expect(chromeExtension?.capability).toBe('chrome')
  expect(chromeExtension?.state).toBe('ready')
}
