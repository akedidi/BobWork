import { expect, $ } from '@wdio/globals'
import {
  clickSidebar,
  ensureHomeReady,
  expectNoLoadErrorBanner,
  openSettingsTab,
} from '../helpers'

describe('Bob Work — bannières de chargement (happy path)', () => {
  before(async () => {
    await ensureHomeReady()
  })

  it('n’affiche pas de bannière d’erreur sur les vues catalogue', async () => {
    // Forcer un échec IPC nécessiterait un hook e2e_* dédié (absent).
    // On vérifie que le happy path ne confond jamais erreur et vide.
    for (const label of ['Plugins', 'Skills', 'Intégrations et MCP', 'Tâches', 'Planifié', 'Artefacts']) {
      await clickSidebar(label)
      await expectNoLoadErrorBanner()
    }

    await openSettingsTab('Modes')
    await expectNoLoadErrorBanner()
    await expect($('.load-error-banner')).not.toExist()
    await expect($('button=Réessayer')).not.toExist()
  })
})
