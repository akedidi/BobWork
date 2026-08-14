import { expect, $ } from '@wdio/globals'
import {
  clickSidebar,
  ensureHomeReady,
  expectNoLoadErrorBanner,
  openManualSkillForm,
  startSkillCreateWithBob,
} from '../helpers'

describe('Bob Work — création de skills', () => {
  before(async () => {
    await ensureHomeReady()
  })

  it('affiche le catalogue Skills sans bannière d’erreur', async () => {
    await clickSidebar('Skills')
    await expect($('strong=Skills')).toBeDisplayed({ wait: 8_000 })
    await expectNoLoadErrorBanner()
    await expect($('button=+ Nouveau skill')).toBeDisplayed()
  })

  it('propose le chat en premier, plus l’import Claude et le formulaire', async () => {
    await clickSidebar('Skills')
    await expect($('button=+ Nouveau skill')).toBeDisplayed()
    await expect($('button=Importer Claude')).toBeDisplayed()
    await expect($('button=Formulaire')).toBeDisplayed()
    await expect($('[role="dialog"][aria-labelledby="skill-create-title"]')).not.toExist()
  })

  it('crée un skill avec Bob dans le chat', async () => {
    await startSkillCreateWithBob()
    await expect($('div*=Création de skill')).toBeDisplayed({ wait: 12_000 })
    const composer = $('textarea[placeholder="Décrivez le skill à créer…"]')
    await expect(composer).toBeDisplayed()
    await expect($('h2=Skill — formulaire')).not.toExist()

    await composer.setValue('Créer un skill E2E de synthèse juridique')
    await $('button[aria-label="Envoyer le prompt"]').click()
    await expect($('div.conversation-title=Création de skill')).toBeDisplayed({ wait: 12_000 })
    await expect($('[aria-label="Conversations récentes"]').$('span=Création de skill')).toBeDisplayed({ wait: 12_000 })
  })

  it('ouvre encore le formulaire manuel si le chooser est présent', async () => {
    await openManualSkillForm()
    await expect($('input[placeholder="analyse-contrats"]')).toBeDisplayed()
    await expect($('textarea[placeholder^="Décris étape par étape"]')).toBeDisplayed()
    await $('button=Retour').click()
  })
})
