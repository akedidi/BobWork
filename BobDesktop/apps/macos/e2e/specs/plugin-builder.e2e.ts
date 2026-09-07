import { expect, $ } from '@wdio/globals'
import {
  clickSidebar,
  ensureCloudArchitectPlugin,
  ensureHomeReady,
  labelled,
  startPluginCreateWithBob,
  startPluginWizard,
  waitForHomeChatIdle,
  waitForVisible,
} from '../helpers'

describe('Bob Work — création de plugin (chat d’abord)', () => {
  before(async () => {
    await ensureHomeReady()
  })

  it('ouvre le chat directement depuis + Nouveau plugin', async () => {
    await clickSidebar('Plugins')
    await expect($('button=Assistant guidé')).toBeDisplayed()
    await $('button=+ Nouveau plugin').click()
    await expect($('div*=Création de plugin')).toBeDisplayed({ wait: 12_000 })
    await expect($('textarea[placeholder="Décrivez le plugin à créer…"]')).toBeDisplayed()
    await expect($('h1=Que doit faire ce plugin ?')).not.toExist()
    await expect($('[role="dialog"][aria-labelledby="plugin-create-title"]')).not.toExist()
  })

  it('démarre la création dans le chat sans formulaire', async () => {
    await startPluginCreateWithBob()
    await expect($('div*=Création de plugin')).toBeDisplayed({ wait: 12_000 })
    await expect($('div*=Décrivez l’idée ici')).toBeDisplayed()
    await expect($('h1=Que doit faire ce plugin ?')).not.toExist()
    await expect($('textarea[placeholder="Décrivez le plugin à créer…"]')).toBeDisplayed()
  })

  it('parcourt l’assistant guidé optionnel jusqu’à la génération', async () => {
    await startPluginWizard()
    await labelled('Nom').setValue('Brief E2E')
    await labelled('Bénéfice (description)', 'textarea').setValue(
      'Prépare un brief client et liste les risques à vérifier.',
    )
    await $('button=Continuer').click()

    await expect($('h1=Quand s’exécute-t-il ?')).toBeDisplayed()
    await $('button=Continuer').click()

    await expect($('h1=Quels outils embarquer ?')).toBeDisplayed()
    await $('button=Continuer').click()

    await expect($('h1=Quelles autorisations ?')).toBeDisplayed()
    await $('button=Continuer').click()

    const preview = $('section[aria-label="Aperçu du plugin"]')
    await expect(preview).toBeDisplayed()
    await expect(preview.$('dd=Brief E2E')).toBeDisplayed()
    await $('button=Générer le plugin').click()
    await waitForVisible('div.msg-user*=Brief E2E')
    await waitForHomeChatIdle()
  })

  it('propose Faire évoluer avec Bob sur un plugin agentique', async () => {
    await ensureCloudArchitectPlugin()
    await clickSidebar('Plugins')
    const row = $('//div[contains(@class, "skill-list-row")][contains(., "Cloud Architect Agent")]')
    await row.waitForDisplayed({ timeout: 10_000 })
    await row.$('button.skill-row-main').click()
    const detail = $('aside[aria-label="Détails du plugin Cloud Architect Agent"]')
    await detail.waitForDisplayed({ timeout: 8_000 })
    const evolve = detail.$('button=Faire évoluer avec Bob')
    if (!(await evolve.isExisting())) {
      // Builtin / non-agentic builds : le bouton n’existe que pour les bundles agentiques.
      return
    }
    await evolve.click()
    await waitForVisible('div.msg-user*=Mets à jour le plugin agentique')
    await waitForHomeChatIdle()
  })
})
