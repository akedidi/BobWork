import { expect, $ } from '@wdio/globals'
import {
  clickSidebar,
  ensureHomeReady,
  expectNoLoadErrorBanner,
  openSettingsTab,
} from '../helpers'

const IMPORT_YAML = [
  'slug: e2e-review',
  'name: Revue E2E',
  'description: Mode de revue créé par le parcours E2E.',
  'roleDefinition: You review local plans without editing.',
  'whenToUse: During the Bob Work e2e journey.',
  'customInstructions: Stay local and ask before any change.',
  'groups:',
  '  - read',
].join('\n')

async function waitForModesLoaded() {
  await $('h1=Modes').waitForDisplayed({ timeout: 10_000 })
  const loader = $('.settings-section-loader')
  if (await loader.isExisting()) {
    await loader.waitForExist({ reverse: true, timeout: 15_000 })
  }
  await $('h3=Installés').waitForDisplayed({ timeout: 10_000 })
  await $('h3=Catalogue').waitForDisplayed({ timeout: 10_000 })
}

describe('Bob Work — modes Bob Shell', () => {
  before(async () => {
    await ensureHomeReady()
  })

  it('liste les modes installés et le catalogue local', async () => {
    await openSettingsTab('Modes')
    await waitForModesLoaded()
    await expectNoLoadErrorBanner()
    await expect($('h3=Installés')).toBeDisplayed()
    await expect($('h3=Catalogue')).toBeDisplayed()
    await expect($('strong=Shell Debugger')).toBeDisplayed()
    await expect($('span=Catalogue')).toBeDisplayed()
    await expect($('input[aria-label="Rechercher un mode…"]')).toBeDisplayed()
    await expect($('button=+ Créer avec Bob')).toBeDisplayed()
    await expect($('button=Importer YAML')).toBeDisplayed()
  })

  it('filtre le catalogue puis installe un mode d’exemple', async () => {
    await openSettingsTab('Modes')
    await waitForModesLoaded()
    const search = $('input[aria-label="Rechercher un mode…"]')
    await search.setValue('Shell Debugger')
    await expect($('strong=Shell Debugger')).toBeDisplayed()
    await expect($('strong=Deployment Assistant')).not.toExist()
    await search.setValue('')

    const card = $('//div[contains(@class, "mode-card")][contains(., "Shell Debugger")]')
    await card.waitForDisplayed({ timeout: 8_000 })
    if (await card.$('button=Télécharger').isExisting()) {
      await card.$('button=Télécharger').click()
    }
    const installed = $('//div[contains(@class, "mode-card")][contains(., "Shell Debugger")]')
    await expect(installed.$('button=Retirer')).toBeDisplayed({ wait: 8_000 })
  })

  it('importe un mode YAML personnalisé', async () => {
    await openSettingsTab('Modes')
    await waitForModesLoaded()
    if (await $('strong=Revue E2E').isExisting()) {
      await expect($('strong=Revue E2E')).toBeDisplayed()
      return
    }
    await $('button=Importer YAML').click()
    await expect($('h2=Importer un mode YAML')).toBeDisplayed()
    await $('textarea[aria-label="YAML du mode"]').setValue(IMPORT_YAML)
    await $('button=Installer').click()
    await expect($('strong=Revue E2E')).toBeDisplayed({ wait: 10_000 })
  })

  it('propose le mode importé dans le sélecteur du composeur', async () => {
    await clickSidebar('Nouveau chat')
    await $('button[aria-label*="Mode Bob"]').click()
    const menu = $('[role="menu"][aria-label="Modes Bob"]')
    await menu.waitForDisplayed()
    const search = menu.$('input[placeholder="Rechercher un mode…"]')
    if (await search.isExisting()) {
      await search.setValue('Revue E2E')
    }
    await expect(menu.$('strong=Revue E2E')).toBeDisplayed({ wait: 8_000 })
    await menu.$('strong=Revue E2E').click()
    await expect($('button[aria-label="Mode Bob : Revue E2E"]')).toBeDisplayed()
  })

  it('ouvre le chat pour créer un mode avec Bob', async () => {
    await openSettingsTab('Modes')
    await waitForModesLoaded()
    await $('button=+ Créer avec Bob').click()
    await expect($('div.msg-user*=mode Bob Shell personnalisé')).toBeDisplayed({ wait: 10_000 })
  })
})
