import { expect, $ } from '@wdio/globals'
import {
  clickSidebar,
  ensureHomeReady,
  expectNoLoadErrorBanner,
} from '../helpers'

const TITLE = 'Rapport E2E artefacts'

describe('Bob Work — galerie d’artefacts', () => {
  before(async () => {
    await ensureHomeReady()
  })

  it('ouvre Artefacts avec l’état vide ou la grille', async () => {
    await clickSidebar('Artefacts')
    await expect($('span=Artefacts')).toBeDisplayed({ wait: 8_000 })
    await expectNoLoadErrorBanner()
    await expect($('button=+ Générer')).toBeDisplayed()
    const empty = $('span=Aucun artefact')
    if (await empty.isExisting()) {
      await expect($('span*=Cliquez sur « Générer »')).toBeDisplayed()
    }
  })

  it('génère un artefact Markdown et l’affiche dans la grille', async () => {
    await clickSidebar('Artefacts')
    await $('button=+ Générer').click()
    await expect($('div=Générer un artefact')).toBeDisplayed()
    await $('button*=Markdown').click()
    await $('input[placeholder="Ex : Rapport Q2 2024"]').setValue(TITLE)
    await $('textarea[placeholder^="## Introduction"]').setValue('## Introduction\n- Point E2E')
    await $('button=Générer').click()

    const card = $(`//div[@role="button"][.//div[normalize-space()="${TITLE}"]]`)
    await card.waitForDisplayed({ timeout: 12_000 })
    await expect(card.$('div*=Markdown')).toBeDisplayed()
  })

  it('ouvre l’aperçu d’un artefact puis le ferme', async () => {
    await clickSidebar('Artefacts')
    const card = $(`//div[@role="button"][.//div[normalize-space()="${TITLE}"]]`)
    await card.waitForDisplayed({ timeout: 8_000 })
    await card.click()
    const panel = $('aside[aria-label="Aperçus et activité"]')
    await expect(panel).toBeDisplayed({ wait: 8_000 })
    const unavailable = panel.$('div*=Aperçu indisponible')
    if (await unavailable.isExisting()) {
      await expect(unavailable).toBeDisplayed()
    } else {
      await expect(panel).toHaveText(expect.stringContaining(TITLE))
    }
    await $('button[title="Fermer le panneau"]').click()
    await expect(panel).not.toExist()
  })
})
