import { browser, expect, $ } from '@wdio/globals'
import {
  clickNewProject,
  clickSidebar,
  ensureHomeReady,
  labelled,
  openHomeChatComposer,
  openPluginPicker,
  waitForHomeChatIdle,
} from '../helpers'

describe('Bob Work — accueil, composeur et file de chat', () => {
  before(async () => {
    await ensureHomeReady()
  })

  it('affiche l’accueil français avec placeholder et suggestions', async () => {
    await clickSidebar('Nouveau chat')
    await expect($('h1=Sur quoi travailler ?')).toBeDisplayed()
    await expect($('textarea[placeholder="Sur quoi travailler ?"]')).toBeDisplayed()
    await expect($('div*=L’IA peut faire des erreurs. Vérifiez les résultats importants.')).toBeDisplayed()
    await expect($('div*=Préparer un brief client ou un plan de transformation')).toBeDisplayed()
    await expect($('div*=Rédiger une proposition commerciale ou un suivi d’opportunité')).toBeDisplayed()
  })

  it('envoie une suggestion d’accueil dans le chat', async () => {
    await clickSidebar('Nouveau chat')
    await $('[data-testid="home-suggestion-consult"]').click()
    await browser.waitUntil(async () => {
      const sentPrompt = $('[data-testid="chat-message-user"]*=Préparer un brief client')
      return sentPrompt.isDisplayed().catch(() => false)
    }, {
      timeout: 20_000,
      interval: 200,
      timeoutMsg: 'Le prompt de suggestion n’est pas apparu dans le chat',
    })
    await waitForHomeChatIdle()
  })

  it('montre l’état vide d’une nouvelle conversation de projet', async () => {
    await clickNewProject()
    await labelled('Nom').setValue('Projet Chat Vide E2E')
    await labelled('Description', 'textarea').setValue('Projet pour l’état vide du chat.')
    const save = $('button=Enregistrer le projet')
    await save.waitForClickable({ timeout: 12_000 })
    await save.click()
    await $('h1=Projet Chat Vide E2E').waitForDisplayed({ timeout: 20_000 })
    await $('button=+ Nouvelle conversation').click()
    await expect($('span=Posez une question ou démarrez une tâche')).toBeDisplayed({ wait: 8_000 })
    await expect($('textarea.composer-textarea')).toBeDisplayed()
  })

  it('ajoute un plugin au composeur et affiche la puce de mention', async () => {
    const composer = await openHomeChatComposer()
    const menu = await openPluginPicker()
    await expect(menu.$('button*=Fichier(s)')).toBeDisplayed()
    await expect(menu.$('button*=Dossier')).toBeDisplayed()
    const documents = menu.$('//button[contains(@class, "attach-plugin-row")][contains(., "Documents")]')
    await documents.waitForDisplayed({ timeout: 8_000 })
    await documents.click()
    expect(await composer.getValue()).toContain('@plugin:builtin-documents')
    await expect($('[aria-label="Composants du prompt"]')).toBeDisplayed()
    await expect($('button[aria-label="Retirer Documents"]')).toBeDisplayed()
    // Pièces jointes fichier/dossier : le sélecteur natif n’est pas stimuable ici
    // (pas de hook e2e pour injecter un path Finder). Menu Fichier(s)/Dossier déjà couvert.
  })
})
