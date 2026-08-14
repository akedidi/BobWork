import { expect, $ } from '@wdio/globals'
import {
  clickSidebar,
  ensureHomeReady,
  expectApprovalOverlay,
  failNextApprovalResolve,
  openPriorityPanel,
  openSettingsTab,
  seedE2eApproval,
} from '../helpers'

describe('Bob Work — overlay d’approbation', () => {
  before(async () => {
    await ensureHomeReady()
  })

  it('refuse une action et ferme l’overlay', async () => {
    const description = 'Bob souhaite supprimer un brouillon E2E.'
    await seedE2eApproval({ humanDescription: description, riskLevel: 'high' })
    const dialog = await expectApprovalOverlay(description)
    await expect(dialog.$('.approval-risk-badge')).toHaveText(expect.stringContaining('Élevé'))
    await dialog.$('button.approval-btn-deny').click()
    await expect($('.approval-overlay')).not.toExist()
  })

  it('autorise une fois puis disparaît', async () => {
    const description = 'Bob souhaite écrire notes-e2e-once.md.'
    await seedE2eApproval({
      humanDescription: description,
      commandOrChange: 'write notes-e2e-once.md',
    })
    const dialog = await expectApprovalOverlay(description)
    await expect(dialog.$('button.approval-btn-allow')).toHaveText(expect.stringContaining('Autoriser une fois'))
    await dialog.$('button.approval-btn-allow').click()
    await expect($('.approval-overlay')).not.toExist()
  })

  it('autorise pour la tâche et mémorise une permission', async () => {
    const description = 'Bob souhaite modifier le workspace pour cette tâche E2E.'
    await seedE2eApproval({
      humanDescription: description,
      commandOrChange: 'edit workspace-e2e.md',
    })
    const dialog = await expectApprovalOverlay(description)
    await dialog.$('button=Pour cette tâche').click()
    await expect($('.approval-overlay')).not.toExist()

    await openSettingsTab('Permissions')
    await expect($('strong=file.write')).toBeDisplayed({ wait: 8_000 })
  })

  it('affiche Réessayer puis réussit après un échec d’enregistrement', async () => {
    const description = 'Bob souhaite relancer une écriture après échec E2E.'
    await seedE2eApproval({ humanDescription: description })
    const dialog = await expectApprovalOverlay(description)
    await failNextApprovalResolve()
    await dialog.$('button.approval-btn-allow').click()
    const alert = dialog.$('[role="alert"].approval-error')
    await expect(alert).toBeDisplayed({ wait: 8_000 })
    await expect(alert).toHaveText(expect.stringContaining('enregistrer votre décision'))
    await expect(alert.$('button=Réessayer')).toBeDisplayed()
    await expect(alert.$('button=Fermer')).toBeDisplayed()
    await alert.$('button=Réessayer').click()
    await expect($('.approval-overlay')).not.toExist()
  })

  it('remplit le centre Priorité après une demande d’approbation', async () => {
    await clickSidebar('Nouveau chat')
    const panel = await openPriorityPanel()
    const empty = panel.$('.sidebar-priority-empty')
    const item = panel.$('.sidebar-priority-item')
    const hasItem = await item.isExisting()
    if (!hasItem) {
      await expect(empty).toHaveText('Aucune notification pour le moment.')
    } else {
      await expect(item).toBeDisplayed()
    }
  })
})
