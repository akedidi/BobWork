import { browser, expect, $ } from '@wdio/globals'

export function labelled(label: string, control: 'input' | 'textarea' | 'select' = 'input') {
  return $(
    `//label[contains(normalize-space(.), "${label}")]//${control}`
    + ` | //label[contains(normalize-space(.), "${label}")]/following-sibling::${control}`
    + ` | //label[contains(normalize-space(.), "${label}")]/following-sibling::*//${control}`,
  )
}

export async function dismissUiChrome() {
  for (let attempt = 0; attempt < 3; attempt++) {
    const overlay = $('.approval-overlay')
    if (await overlay.isDisplayed().catch(() => false)) {
      const deny = overlay.$('button.approval-btn-deny')
      const close = overlay.$('button=Fermer')
      if (await deny.isExisting()) await deny.click()
      else if (await close.isExisting()) await close.click()
      else await browser.keys('Escape')
      await overlay.waitForExist({ reverse: true, timeout: 3_000 }).catch(() => undefined)
      continue
    }
    const modal = $('.modal-overlay')
    if (await modal.isDisplayed().catch(() => false)) {
      await browser.keys('Escape')
      await browser.pause(200)
      continue
    }
    break
  }

  const searchOverlay = $('.search-overlay')
  if (await searchOverlay.isDisplayed().catch(() => false)) {
    await browser.keys('Escape')
    await searchOverlay.waitForExist({ reverse: true, timeout: 3_000 }).catch(() => undefined)
  }

  const priority = $('button[title="Notifications"]')
  if ((await priority.isExisting()) && (await priority.getAttribute('aria-expanded')) === 'true') {
    await priority.click()
    await $('div.sidebar-nav').waitForDisplayed({ timeout: 5_000 }).catch(() => undefined)
  }
}

const SIDEBAR_ALIASES: Record<string, string[]> = {
  'Nouveau chat': ['Nouveau chat', 'New chat', 'Nuevo chat'],
  Planifié: ['Planifié', 'Scheduled', 'Programado'],
  Tâches: ['Tâches', 'Tasks', 'Tareas'],
  Artefacts: ['Artefacts', 'Artifacts', 'Artefactos'],
  Plugins: ['Plugins'],
  Skills: ['Skills'],
  'Intégrations et MCP': ['Intégrations et MCP', 'Integrations & MCP', 'Integraciones y MCP'],
}

function sidebarItem(label: string) {
  const aliases = SIDEBAR_ALIASES[label] ?? [label]
  const xpath = aliases
    .map(text => `//div[contains(@class, "sidebar-item")][contains(normalize-space(.), "${text}")]`)
    .join(' | ')
  return $(xpath)
}

async function clickElement(item: WebdriverIO.Element) {
  await item.waitForDisplayed({ timeout: 12_000 })
  await item.click()
}

export async function clickSidebar(label: string) {
  await dismissUiChrome()
  const item = label === 'Nouveau chat'
    ? $('div.sidebar-nav div.sidebar-item')
    : sidebarItem(label)
  await clickElement(item)
}

export async function clickNewProject() {
  await dismissUiChrome()
  const button = $('button[aria-label="Nouveau projet"]')
  await button.waitForDisplayed({ timeout: 8_000 })
  await button.scrollIntoView()
  await button.waitForClickable({ timeout: 8_000 })
  await button.click()
}

export async function selectOptionLabels(select: WebdriverIO.Element): Promise<string[]> {
  return browser.execute(node => (
    Array.from((node as unknown as HTMLSelectElement).options).map(option => option.text)
  ), select)
}

export async function expectSelectHasOption(select: WebdriverIO.Element, text: string) {
  const labels = await selectOptionLabels(select)
  expect(labels).toContain(text)
}

export async function approveConfirmations() {
  await browser.execute(() => {
    // Legacy browser confirms plus Bob Work's promise-based application dialog.
    window.confirm = () => true
    const testWindow = window as typeof window & { __bobWorkDialogObserver?: MutationObserver }
    const acceptAppDialog = () => {
      const button = document.querySelector<HTMLButtonElement>(
        '.app-dialog [class~="primary-btn"], .app-dialog [class~="danger-btn"]',
      )
      button?.click()
    }
    acceptAppDialog()
    testWindow.__bobWorkDialogObserver?.disconnect()
    testWindow.__bobWorkDialogObserver = new MutationObserver(acceptAppDialog)
    testWindow.__bobWorkDialogObserver.observe(document.body, { childList: true, subtree: true })
  })
}

export async function selectValue(select: WebdriverIO.Element, value: string) {
  const el = await select
  await el.waitForExist({ timeout: 8_000 })
  await el.selectByAttribute('value', value)
  await browser.execute((node, nextValue) => {
    const target = node instanceof HTMLSelectElement
      ? node
      : (node as HTMLElement | null)?.querySelector?.('select')
    if (!target) return
    // The embedded WebKit driver can visually select an option without
    // updating React's controlled value. Use the native setter before firing
    // the real input/change sequence so the E2E action matches a user choice.
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
    setter?.call(target, nextValue)
    target.dispatchEvent(new Event('input', { bubbles: true }))
    target.dispatchEvent(new Event('change', { bubbles: true }))
  }, el, value)
}

export async function selectText(select: WebdriverIO.Element, text: string) {
  const el = await select
  await el.waitForExist({ timeout: 8_000 })
  await el.selectByVisibleText(text)
  await browser.execute((node) => {
    const target = node instanceof HTMLSelectElement
      ? node
      : (node as HTMLElement | null)?.querySelector?.('select')
    if (!target) return
    target.dispatchEvent(new Event('input', { bubbles: true }))
    target.dispatchEvent(new Event('change', { bubbles: true }))
  }, el)
}

async function completeOnboardingIfNeeded() {
  // Do not click the sidebar CTA « Configurer Bob » — that opens Réglages, not onboarding.
  const setup = $('.onboarding-step')
  if (!(await setup.isExisting())) return

  await $('h1=Configurer IBM Bob').waitForDisplayed({ timeout: 8_000 })
  const key = $('input[aria-label="Clé d’inférence IBM Bob"]')
  if (await key.isExisting()) {
    await key.setValue('e2e-headless-session-key')
    await $('button=Enregistrer dans le coffre').click()
  }
  const ready = $('h1=IBM Bob est prêt')
  if (await ready.waitForDisplayed({ timeout: 12_000 }).then(() => true).catch(() => false)) {
    await $('button=Continuer').click()
  }
  await $('span=Réglages').waitForDisplayed({ timeout: 12_000 })
}

async function ensureBobSessionKey() {
  try {
    const snapshot = await invokeTauri<{ authenticated?: boolean }>('get_bob_auth_snapshot')
    if (snapshot?.authenticated) return
  } catch {
    // Fall through to the settings form.
  }

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

const HOME_COMPOSER = 'textarea[placeholder="Sur quoi travailler ?"], textarea[placeholder="What should we work on?"], textarea[placeholder="¿En qué trabajamos?"]'

export async function ensureHomeReady() {
  await dismissUiChrome()
  const settings = await invokeTauri<Record<string, unknown>>('get_settings')
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error('get_settings n’a pas renvoyé un objet de réglages')
  }
  const next = { ...settings, language: 'fr' }
  await invokeTauri('update_settings', { settings: next })
  await browser.execute((detail) => {
    window.dispatchEvent(new CustomEvent('bob-settings-updated', { detail }))
  }, next)
  await browser.waitUntil(async () => (
    await browser.execute(() => document.documentElement.lang) === 'fr'
  ), { timeout: 8_000, timeoutMsg: 'L’UI n’est pas passée en français' }).catch(() => undefined)

  await completeOnboardingIfNeeded()
  await ensureBobSessionKey()

  const homeComposer = $(HOME_COMPOSER)
  await $('div.sidebar-nav').waitForDisplayed({ timeout: 15_000 })
  if (await homeComposer.isDisplayed().catch(() => false)) return

  await clickSidebar('Nouveau chat')
  await homeComposer.waitForDisplayed({ timeout: 15_000 })
}

export async function openPluginPicker() {
  await $('button[title="Joindre un fichier ou un dossier"]').click()
  const menu = $('[role="menu"][aria-label="Ajouter une pièce jointe"]')
  await menu.waitForDisplayed()
  return menu
}

type InvokeBridgeResult<T> = { ok: true; value: T } | { ok: false; error: string }

export async function invokeTauri<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  // WebDriver execute/sync does not await Promises — a Tauri invoke would
  // serialize as "[object Object]". executeAsync waits for `done`.
  const result = await browser.executeAsync((cmd, payload, done) => {
    const report = (ok: boolean, value?: unknown, error?: unknown) => {
      const message = error == null
        ? undefined
        : typeof error === 'string'
          ? error
          : (error as { message?: string }).message
            ?? JSON.stringify(error)
      done({ ok, value, error: message })
    }
    const run = (invoke: (name: string, next?: Record<string, unknown>) => Promise<unknown>) => {
      invoke(cmd, payload).then(value => report(true, value)).catch(error => report(false, undefined, error))
    }
    const globals = window as unknown as {
      __TAURI__?: { core?: { invoke: (name: string, next?: Record<string, unknown>) => Promise<unknown> } }
      __TAURI_INTERNALS__?: { invoke: (name: string, next?: Record<string, unknown>) => Promise<unknown> }
    }
    if (globals.__TAURI__?.core?.invoke) {
      run(globals.__TAURI__.core.invoke)
      return
    }
    if (globals.__TAURI_INTERNALS__?.invoke) {
      run(globals.__TAURI_INTERNALS__.invoke)
      return
    }
    import('@tauri-apps/api/core')
      .then(({ invoke }) => run(invoke))
      .catch(error => report(false, undefined, error))
  }, command, args) as InvokeBridgeResult<T>

  if (!result?.ok) {
    throw new Error(result?.error || `invoke ${command} a échoué`)
  }
  return result.value
}

export async function openHomeChatComposer() {
  await clickSidebar('Nouveau chat')
  const composer = $(HOME_COMPOSER)
  await composer.waitForDisplayed({ timeout: 12_000 })
  return composer
}

export async function sendHomePrompt(text: string) {
  await dismissUiChrome()
  const composer = await openHomeChatComposer()
  await composer.setValue(text)
  await $('button[aria-label="Envoyer le prompt"]').click()
}

export async function pickBuiltinPlugin(pluginLabel: string, pluginToken: string | RegExp) {
  const composer = await openHomeChatComposer()
  const menu = await openPluginPicker()
  const search = menu.$('input.popover-search, input[aria-label*="Rechercher un plugin"]')
  if (await search.isExisting()) await search.setValue(pluginLabel)
  const choice = menu.$(`//button[contains(@class, "attach-plugin-row")][.//strong[normalize-space()="${pluginLabel}"]]`)
  await choice.waitForDisplayed({ timeout: 8_000 })
  await choice.click()
  const value = await composer.getValue()
  if (typeof pluginToken === 'string') expect(value).toContain(pluginToken)
  else expect(value).toMatch(pluginToken)
  return composer
}

export async function connectIntegrationOAuth(integrationId: string, accessToken: string, accountLabel?: string) {
  await invokeTauri('e2e_connect_integration', { integrationId, accessToken, accountLabel })
}

export async function seedOAuthProvider(provider: string, accessToken: string, accountLabel?: string) {
  await invokeTauri('e2e_seed_oauth_token', { provider, accessToken, accountLabel })
}

export async function registerMcpServer(
  name: string,
  scriptPath: string,
  env?: Record<string, string>,
) {
  await clickSidebar('Intégrations et MCP')
  const serversTab = $(
    '//button[normalize-space()="Serveurs MCP" or normalize-space()="MCP servers" or normalize-space()="Servidores MCP"]',
  )
  await serversTab.waitForClickable({ timeout: 10_000 })
  await serversTab.click()
  const nameInput = $('input[placeholder="mon-serveur"]')
  await nameInput.waitForDisplayed({
    timeout: 15_000,
    timeoutMsg: 'Formulaire MCP (placeholder mon-serveur) introuvable — onglet Serveurs MCP encore en chargement ?',
  })
  await nameInput.setValue(name)
  await selectValue(await labelled('Transport', 'select'), 'stdio')
  // Form: commande python3 + arguments = chemin du script
  const commandInput = $('input[placeholder="python3"]')
  if (await commandInput.isExisting()) {
    await commandInput.setValue('python3')
    await $('input[placeholder="server.py --flag"]').setValue(scriptPath)
  } else {
    // Ancien placeholder encore présent dans certaines builds e2e.
    await $('input[placeholder="/chemin/serveur"]').setValue(scriptPath)
  }
  if (env && Object.keys(env).length > 0) {
    const envText = Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n')
    const envField = $('textarea[placeholder*="API_TOKEN"]')
    await envField.waitForDisplayed({ timeout: 5_000 })
    await envField.setValue(envText)
  }
  await $('button=Ajouter avec Bob Shell').click()
  const serverCard = $(`//article[contains(@class, "extension-card")][contains(., "${name}")]`)
  await serverCard.waitForDisplayed({ timeout: 10_000 })
  return serverCard
}

export async function expectConnectionTestBadge(
  scope: WebdriverIO.Element,
  label: 'Test réussi' | 'Échec' | 'Non testé',
) {
  const badge = scope.$(`.//span[contains(@class, "plugin-mcp-state")][contains(normalize-space(.), "${label}")]`)
  await expect(badge).toBeDisplayed({ wait: 12_000 })
  return badge
}

export async function expectAnyBadge(
  scope: WebdriverIO.Element,
  labels: string[],
  timeout = 8_000,
) {
  const el = await scope
  await browser.waitUntil(async () => {
    for (const label of labels) {
      if (await el.$(`span*=${label}`).isExisting()) return true
    }
    return false
  }, { timeout, timeoutMsg: `Aucun badge parmi : ${labels.join(', ')}` })
}

export async function ensureCloudArchitectPlugin() {
  await clickSidebar('Plugins')
  const row = $('//div[contains(@class, "skill-list-row")][contains(., "Cloud Architect Agent")]')
  if (await row.isExisting()) {
    await clickSidebar('Nouveau chat')
    return
  }
  // Prefer IPC seed when the UI list is empty so later suites do not depend on
  // a slow chat round-trip that can fail if the runtime was previously blocked.
  try {
    const plugins = await invokeTauri<Array<{ id?: string; name?: string }>>('get_plugins')
    if (plugins.some(plugin => plugin.name === 'Cloud Architect Agent' || plugin.id?.includes('cloud-architect'))) {
      await clickSidebar('Nouveau chat')
      return
    }
  } catch {
    /* fall through to chat creation */
  }
  await clickSidebar('Nouveau chat')
  const creator = $('textarea[placeholder="Sur quoi travailler ?"]')
  await creator.waitForDisplayed({ timeout: 12_000 })
  await creator.setValue('CREATE_CLOUD_ARCHITECT_PLUGIN_E2E Crée un plugin agentique Cloud Architect avec un outil Python utilisable en CLI, local et sans dépendance réseau.')
  await $('button[aria-label="Envoyer le prompt"]').click()
  await $('p*=Plugin Cloud Architect Agent créé').waitForDisplayed({ timeout: 20_000 })
  await clickSidebar('Plugins')
  await row.waitForDisplayed({ timeout: 12_000 })
  await clickSidebar('Nouveau chat')
}

export async function openSettingsTab(label: string) {
  await dismissUiChrome()
  const settings = $('//span[normalize-space()="Réglages" or normalize-space()="Settings" or normalize-space()="Ajustes"]')
  await settings.waitForClickable({ timeout: 8_000 })
  await settings.click()
  await $('//h2[normalize-space()="Réglages" or normalize-space()="Settings" or normalize-space()="Ajustes"]').waitForDisplayed({ timeout: 8_000 })
  await $(`button=${label}`).click()
}

/** Returns true when the toggle actually changed (a save will follow). */
export async function toggleSetting(label: string, enabled: boolean) {
  const ariaOn = $(`input[aria-label="Activer ${label}"]`)
  const ariaOff = $(`input[aria-label="Désactiver ${label}"]`)
  const toggle = (await ariaOn.isExisting())
    ? ariaOn
    : (await ariaOff.isExisting())
      ? ariaOff
      : labelled(label)
  const selected = await toggle.isSelected()
  if (selected === enabled) return false
  await toggle.click()
  return true
}

/** Toggles a setting and waits for the auto-save only if a change occurred. */
export async function ensureSettingEnabled(label: string, enabled: boolean) {
  if (!(await toggleSetting(label, enabled))) return
  const settingKeys: Record<string, string> = {
    'Accès web': 'webEnabled',
    'Contrôle de l’ordinateur': 'computerUseEnabled',
    'Contrôle de Chrome': 'chromeControlEnabled',
  }
  const key = settingKeys[label]
  try {
    await saveSettings(key ? { [key]: enabled } : undefined)
  } catch (error) {
    // Debounced UI save can lose a race when status probes were blocking IPC.
    // Force the expected keys through the backend, then re-check.
    if (!key) throw error
    const current = await invokeTauri<Record<string, unknown>>('get_settings')
    await invokeTauri('update_settings', { settings: { ...current, [key]: enabled } })
    await saveSettings({ [key]: enabled })
  }
}

export async function saveSettings(expected?: Record<string, unknown>) {
  // Settings are debounced and the success toast is intentionally transient.
  // Verify the persisted backend snapshot instead of racing that visual toast.
  await browser.waitUntil(async () => {
    const settings = await invokeTauri<Record<string, unknown>>('get_settings')
    if (!expected) return true
    return Object.entries(expected).every(([key, value]) => settings[key] === value)
  }, {
    timeout: 10_000,
    interval: 200,
    timeoutMsg: `Les réglages attendus n’ont pas été persistés : ${JSON.stringify(expected ?? {})}`,
  })
}

export async function openIntegrationsCategory(category?: string) {
  await clickSidebar('Intégrations et MCP')
  const integrationsTab = $(
    '//button[normalize-space()="Intégrations" or normalize-space()="Integrations" or normalize-space()="Integraciones"]',
  )
  await integrationsTab.waitForClickable({ timeout: 10_000 })
  await integrationsTab.click()
  if (!category) return
  const categoryButton = $(`button=${category}`)
  await categoryButton.waitForClickable({ timeout: 10_000 })
  await categoryButton.click()
}

export async function prepareMacosAutomationStepForE2e() {
  await openSettingsTab('Accès et contrôle')
  await $('button=Ouvrir Automatisation (Réglages Système)').waitForDisplayed({ timeout: 8_000 })
  await invokeTauri('open_macos_privacy_pane', { pane: 'automation' })
  await invokeTauri('e2e_ack_macos_automation')
}

export async function chromeExtensionState() {
  const status = await invokeTauri<{ browserExtensions: Array<{ id: string; state: string; capability: string; message?: string }> }>(
    'get_plugin_extension_status',
    { pluginId: 'agentic-cloud-architect-agent' },
  )
  return status.browserExtensions.find(item => item.id === 'chrome-automation')
}

export async function ensureChromeExtensionReady() {
  const chromeExtension = await chromeExtensionState()
  expect(chromeExtension?.capability).toBe('chrome')
  expect(['ready', 'disconnected']).toContain(chromeExtension?.state)
  return chromeExtension
}

export async function seedInstructionPlugin(name: string, description: string, instructions: string) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return invokeTauri('create_plugin', {
    input: {
      name,
      version: '1.0.0',
      description,
      scope: 'personal',
      category: 'recipe',
      manifest: {
        name,
        slug,
        version: '1.0.0',
        description,
        category: 'recipe',
        instructions,
        icon: 'plugin',
        permissions: [],
        capabilities: ['prompt'],
      },
    },
  })
}

export async function expectNoLoadErrorBanner() {
  await expect($('.load-error-banner')).not.toExist()
}

export async function openPriorityPanel() {
  const button = $('button[title="Notifications"]')
  await button.waitForClickable({ timeout: 8_000 })
  if ((await button.getAttribute('aria-expanded')) !== 'true') {
    await button.click()
  }
  const panel = $('[role="region"][aria-label="Priorité"]')
  await panel.waitForDisplayed({ timeout: 8_000 })
  return panel
}

export async function openSidebarSearch() {
  await dismissUiChrome()
  await $('button[title="Rechercher"]').waitForClickable({ timeout: 8_000 })
  await $('button[title="Rechercher"]').click()
  const search = $('input[placeholder="Rechercher dans les chats"], input[placeholder="Search chats"], input[placeholder*="Rechercher"]')
  await search.waitForDisplayed({ timeout: 8_000 })
  return search
}

export async function openPluginCreateChooser() {
  await clickSidebar('Plugins')
  const dialog = $('[role="dialog"][aria-labelledby="plugin-create-title"]')
  if (await dialog.isExisting()) return dialog
  return null
}

export async function startPluginCreateWithBob() {
  await clickSidebar('Plugins')
  await $('button=+ Nouveau plugin').waitForClickable({ timeout: 8_000 })
  await $('button=+ Nouveau plugin').click()
}

export async function startPluginWizard() {
  await clickSidebar('Plugins')
  const guided = $('button=Assistant guidé')
  if (await guided.isExisting()) {
    await guided.click()
  } else {
    const chooser = await openPluginCreateChooser()
    if (chooser) await chooser.$('strong=Assistant guidé').click()
  }
  await $('h1=Que doit faire ce plugin ?').waitForDisplayed({ timeout: 8_000 })
}

export async function openSkillCreateChooser() {
  await clickSidebar('Skills')
  const dialog = $('[role="dialog"][aria-labelledby="skill-create-title"]')
  if (await dialog.isExisting()) return dialog
  return null
}

export async function openManualSkillForm() {
  await clickSidebar('Skills')
  const formBtn = $('button=Formulaire')
  if (await formBtn.isExisting()) {
    await formBtn.click()
  } else {
    const chooser = await openSkillCreateChooser()
    if (chooser) await chooser.$('strong=Formulaire manuel').click()
  }
  await $('h2=Skill — formulaire').waitForDisplayed({ timeout: 8_000 })
}

export async function startSkillCreateWithBob() {
  await clickSidebar('Skills')
  await $('button=+ Nouveau skill').waitForClickable({ timeout: 8_000 })
  await $('button=+ Nouveau skill').click()
}

export async function waitForHomeChatIdle() {
  await browser.waitUntil(async () => {
    const send = $('button[aria-label="Envoyer le prompt"]')
    return (await send.isExisting()) && (await send.isDisplayed())
  }, { timeout: 25_000, timeoutMsg: 'Le composeur n’est pas revenu à l’état prêt.' })
}

/** Re-resolve the selector while React replaces nodes during route transitions. */
export async function waitForVisible(selector: string, timeout = 25_000) {
  await browser.waitUntil(async () => {
    const element = $(selector)
    return (await element.isExisting()) && (await element.isDisplayed())
  }, { timeout, interval: 150, timeoutMsg: `Élément non visible : ${selector}` })
}

export async function seedE2eApproval(options: {
  humanDescription?: string
  riskLevel?: string
  commandOrChange?: string
} = {}) {
  const args: Record<string, unknown> = {}
  if (options.humanDescription) args.humanDescription = options.humanDescription
  if (options.riskLevel) args.riskLevel = options.riskLevel
  if (options.commandOrChange) args.commandOrChange = options.commandOrChange
  return invokeTauri<{ id: string; humanDescription: string; riskLevel: string }>(
    'e2e_seed_approval',
    args,
  )
}

export async function failNextApprovalResolve() {
  await invokeTauri('e2e_fail_next_approval_resolve')
}

export async function expectApprovalOverlay(description?: string) {
  const overlay = $('.approval-overlay')
  await overlay.waitForDisplayed({ timeout: 8_000 })
  const dialog = overlay.$('[role="dialog"]')
  await expect(dialog).toBeDisplayed()
  await expect(dialog.$('#approval-title')).toHaveText('Approbation requise')
  if (description) {
    await expect(dialog.$('.approval-description')).toHaveText(description)
  }
  return dialog
}
