import { expect, $ } from '@wdio/globals'
import {
  clickSidebar,
  ensureHomeReady,
  expectNoLoadErrorBanner,
  invokeTauri,
  openIntegrationsCategory,
} from '../helpers'

describe('Bob Work — états OAuth honnêtes (configuré / connecté / Entra)', () => {
  before(async () => {
    await ensureHomeReady()
  })

  it('affiche la bannière Entra tant que Microsoft n’a pas de client', async () => {
    await openIntegrationsCategory('Microsoft 365')
    await expectNoLoadErrorBanner()
    const outlook = $('//div[@data-provider="outlook-mail"]')
    await outlook.waitForDisplayed({ timeout: 8_000 })
    if (await outlook.$('.status-dot.green').isExisting()) {
      await expect(outlook.$('span=Connecté')).toBeDisplayed()
      return
    }
    if (await outlook.$('span=Configuré').isExisting()) {
      await expect($('[role="status"]*=Client Entra requis')).not.toExist()
      return
    }
    await expect($('[role="status"]*=Client Entra requis')).toBeDisplayed()
    await expect(outlook.$('span=Non connecté')).toBeDisplayed()
    await expect(outlook.$('p*=Client Entra requis')).toBeDisplayed()
  })

  it('passe Outlook à Configuré après enregistrement du Client ID, sans authentifier', async () => {
    await invokeTauri('disconnect_integration', { integrationId: 'outlook-mail' }).catch(() => undefined)
    await invokeTauri('set_oauth_client_config', {
      integrationId: 'outlook-mail',
      clientId: '00000000-0000-4000-8000-000000000001',
    })
    await clickSidebar('Nouveau chat')
    await openIntegrationsCategory('Microsoft 365')

    const outlook = $('//div[@data-provider="outlook-mail"]')
    await expect(outlook.$('span=Configuré')).toBeDisplayed({ wait: 8_000 })
    await expect(outlook.$('span=Connecté')).not.toExist()
    await expect(outlook.$('.status-dot.green')).not.toExist()
    await expect($('[role="status"]*=Client Entra requis')).not.toExist()
  })

  it('distingue GitHub connecté vs non connecté selon l’authentification réelle', async () => {
    await openIntegrationsCategory('Dev & collab')
    const github = $('//div[@data-provider="github"]')
    await github.waitForDisplayed({ timeout: 8_000 })
    if (await github.$('button=Déconnecter').isExisting()) {
      await expect(github.$('span=Connecté')).toBeDisplayed()
      await expect(github.$('.status-dot.green')).toBeDisplayed()
      return
    }
    const configured = github.$('span=Configuré')
    const disconnected = github.$('span=Non connecté')
    expect(
      (await configured.isExisting()) || (await disconnected.isExisting()),
    ).toBe(true)
    if (await configured.isExisting()) {
      await expect(configured).toBeDisplayed()
    } else {
      await expect(disconnected).toBeDisplayed()
    }
    await expect(github.$('button=Connecter avec GitHub')).toBeDisplayed()
    await expect(github.$('.status-dot.green')).not.toExist()
  })
})
