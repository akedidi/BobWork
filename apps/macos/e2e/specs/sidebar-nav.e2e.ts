import { expect, $ } from '@wdio/globals'
import {
  clickSidebar,
  ensureHomeReady,
  expectNoLoadErrorBanner,
  openPriorityPanel,
  openSidebarSearch,
} from '../helpers'

describe('Bob Work — barre latérale, recherche et Priorité', () => {
  before(async () => {
    await ensureHomeReady()
  })

  it('navigue vers Plugins, Skills et Artefacts', async () => {
    await clickSidebar('Plugins')
    await expect($('button=+ Nouveau plugin')).toBeDisplayed({ wait: 8_000 })
    await expectNoLoadErrorBanner()

    await clickSidebar('Skills')
    await expect($('button=+ Nouveau skill')).toBeDisplayed({ wait: 8_000 })
    await expectNoLoadErrorBanner()

    await clickSidebar('Artefacts')
    await expect($('button=+ Générer')).toBeDisplayed({ wait: 8_000 })
    await expectNoLoadErrorBanner()
  })

  it('ouvre le centre Priorité (vide ou avec notifications)', async () => {
    await clickSidebar('Nouveau chat')
    const panel = await openPriorityPanel()
    await expect(panel.$('strong=Priorité')).toBeDisplayed()
    const empty = panel.$('.sidebar-priority-empty')
    const item = panel.$('.sidebar-priority-item')
    if (await item.isExisting()) {
      await expect(item).toBeDisplayed()
      await expect(panel.$('button=Effacer')).toBeDisplayed()
    } else {
      await expect(empty).toHaveText('Aucune notification pour le moment.')
    }
    await $('button[title="Notifications"]').click()
    await expect(panel).not.toExist()
  })

  it('recherche en local et libelle le type Message en français', async () => {
    const search = await openSidebarSearch()
    await expect(search).toHaveAttribute('placeholder', expect.stringContaining('Rechercher'))
    await search.setValue('alpha-unique')
    const results = $('.search-results')
    if (await results.$('button').isExisting()) {
      await expect(results.$('span=Message')).toBeDisplayed({ wait: 8_000 })
      await expect(results.$('span=message')).not.toExist()
    } else {
      await expect($('div*=Aucun résultat')).toBeDisplayed()
    }

    await search.setValue('Word')
    const pluginHit = results.$('//button[.//span[normalize-space()="Plugin"]]')
    if (await pluginHit.isExisting()) {
      await expect(pluginHit).toBeDisplayed()
    }
  })
})
