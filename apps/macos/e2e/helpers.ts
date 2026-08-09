import { browser, $ } from '@wdio/globals'

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
  await $('span=Settings').waitForDisplayed({ timeout: 12_000 })
}

async function ensureBobSessionKey() {
  await clickSidebar('Nouveau chat')
  await $('span=Settings').click()
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
