import { expect, $ } from '@wdio/globals'
import {
  clickSidebar,
  ensureHomeReady,
  ensureSettingEnabled,
  invokeTauri,
  labelled,
  openSettingsTab,
  selectOptionLabels,
} from '../helpers'

describe('Bob Work — réglages restants (langue, notifications, données)', () => {
  before(async () => {
    await ensureHomeReady()
  })

  it('propose auto, français, anglais et espagnol, avec repli anglais hors langues supportées', async () => {
    await openSettingsTab('Apparence et langue')
    const language = await labelled('Langue', 'select')
    const labels = await selectOptionLabels(language)
    expect(labels).toEqual(['Détecter automatiquement', 'Français', 'English', 'Español'])
    await expect($('p*=Automatique suit la langue du système')).toBeDisplayed()
    await expect($('p*=Interface en français uniquement')).not.toExist()
  })

  it('enregistre les bascules de notifications', async () => {
    await openSettingsTab('Général')
    await expect($('h1=Notifications')).toBeDisplayed()
    await ensureSettingEnabled('Activer les notifications', true)
    await ensureSettingEnabled('Notifier quand une tâche se termine', false)
    await ensureSettingEnabled('Notifier quand une tâche se termine', true)
    const settings = await invokeTauri<{ notificationsEnabled: boolean; notifyTaskComplete: boolean }>('get_settings')
    expect(settings.notificationsEnabled).toBe(true)
    expect(settings.notifyTaskComplete).toBe(true)
  })

  it('exporte le diagnostic sans quitter l’app et expose le dossier de données', async () => {
    await openSettingsTab('Données locales')
    await expect($('button=Ouvrir le dossier de données')).toBeDisplayed()
    await expect($('button=Exporter les conversations')).toBeDisplayed()
    await $('button=Exporter le diagnostic').click()
    await expect($('div.settings-status*=Diagnostic exporté')).toBeDisplayed({ wait: 8_000 })
    await clickSidebar('Nouveau chat')
    await expect($('textarea[placeholder="Sur quoi travailler ?"]')).toBeDisplayed()
  })

  it('rappelle que la clé vit dans le coffre, pas une session', async () => {
    await openSettingsTab('IBM Bob Shell')
    await expect($('button=Tester le Trousseau')).not.toExist()
    const vaultNote = $('p.settings-note*=coffre local chiffré')
    await vaultNote.scrollIntoView()
    await expect(vaultNote).toBeDisplayed()
    const warning = $('div.settings-warning*=restent disponibles après redémarrage')
    await warning.scrollIntoView()
    await expect(warning).toBeDisplayed()
  })
})
