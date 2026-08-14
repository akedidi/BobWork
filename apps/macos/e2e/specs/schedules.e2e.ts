import { expect, $ } from '@wdio/globals'
import {
  clickSidebar,
  ensureHomeReady,
  expectNoLoadErrorBanner,
  expectSelectHasOption,
  labelled,
  openSettingsTab,
} from '../helpers'

describe('Bob Work — planifications et préflight non supervisé', () => {
  before(async () => {
    await ensureHomeReady()
  })

  it('ouvre Planifié avec l’état vide ou la liste existante', async () => {
    await clickSidebar('Planifié')
    await expect($('button=+ Nouvelle')).toBeDisplayed({ wait: 8_000 })
    await expectNoLoadErrorBanner()
    const empty = $('div*=Aucune planification')
    const paused = $('span=En pause')
    const active = $('span=Actif')
    expect(
      (await empty.isExisting()) || (await paused.isExisting()) || (await active.isExisting()),
    ).toBe(true)
  })

  it('expose les options hors ligne et chevauchement dans le formulaire', async () => {
    await clickSidebar('Planifié')
    await $('button=+ Nouvelle').click()
    await expect($('div=Nouvelle planification')).toBeDisplayed()
    await expect($('//label[normalize-space()="Si hors ligne"]')).toBeDisplayed()
    await expect($('//label[normalize-space()="Si chevauchement"]')).toBeDisplayed()
    await expectSelectHasOption(await labelled('Si hors ligne', 'select'), 'Exécuter au réveil')
    await expectSelectHasOption(await labelled('Si chevauchement', 'select'), 'Mettre en file')
    await $('button=Annuler').click()
    await expect($('div=Nouvelle planification')).not.toExist()
  })

  it('explique le préflight non supervisé et le coffre dans Réglages', async () => {
    await openSettingsTab('Permissions')
    await expect($('p*=Les exécutions non supervisées réutilisent la clé IBM Bob du coffre local')).toBeDisplayed()
    await expect($('p*=« Toujours demander » ne peut pas attendre un clic')).toBeDisplayed()
    const policy = await labelled('Politique par défaut', 'select')
    await expectSelectHasOption(policy, 'Toujours demander (avant chaque session)')
    await expectSelectHasOption(policy, 'Ne jamais demander (--trust automatique)')

    await openSettingsTab('Tâches et planifié')
    await expect($('div.settings-warning*=écran verrouillé')).toBeDisplayed()
    await expect($('p*=Les alertes de fin de tâche se règlent dans Général → Notifications.')).toBeDisplayed()
  })
})
