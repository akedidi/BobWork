import { browser, expect, $ } from '@wdio/globals'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { clickSidebar, ensureHomeReady, invokeTauri } from '../helpers'

const E2E_DATA = resolve(tmpdir(), 'bob-work-e2e', 'data')
const CANVAS = resolve(E2E_DATA, 'live-canvas', 'index.html')
const CODEGRAPH_ROOT = resolve(E2E_DATA, 'codegraph-project')
const CODEGRAPH_PROJECT = 'CodeGraph E2E récent'

async function sendPrompt(prompt: string) {
  await clickSidebar('Nouveau chat')
  const composer = $('textarea[placeholder="Sur quoi travailler ?"]')
  await composer.waitForDisplayed({ timeout: 10_000 })
  await composer.setValue(prompt)
  await $('button[aria-label="Envoyer le prompt"]').click()
}

describe('Bob Work — Canvas, CodeGraph et SSH récents', () => {
  before(async () => {
    await ensureHomeReady()
  })

  it('rend un Live Canvas sandboxé dans la conversation avec scroll actif', async () => {
    await sendPrompt('LIVE_CANVAS_RECENT_FEATURE_E2E Crée un dashboard 3D long et interactif.')
    await expect($('p*=Live Canvas créé')).toBeDisplayed({ wait: 20_000 })
    const inline = $('section.message-visualization-preview')
    await inline.waitForDisplayed({ timeout: 15_000 })
    await expect(inline.$('button=Pause')).toBeDisplayed()
    const inspector = inline.$('button=Inspecter le DOM')
    await expect(inspector).toBeDisplayed()
    await expect(inline.$('button=Exporter ZIP')).toBeDisplayed()

    await inspector.click()
    await expect(inspector).toHaveAttribute('aria-pressed', 'true')
    await expect(inline.$('div*=Inspecteur actif')).toBeDisplayed()

    const frame = inline.$('iframe')
    await frame.waitForDisplayed({ timeout: 15_000 })
    expect(await frame.getAttribute('src')).not.toBe('about:blank')
    expect(await frame.getAttribute('scrolling')).toBe('auto')
    expect(await frame.getAttribute('sandbox')).toBe('allow-scripts')
    const overflow = await browser.execute(() => {
      const host = document.querySelector('.message-visualization-preview .live-canvas-frames')
      return host ? getComputedStyle(host).overflow : ''
    })
    expect(overflow).toBe('auto')
  })

  it('actualise le Canvas, conserve la version précédente et exporte un ZIP', async () => {
    const inline = $('section.message-visualization-preview')
    await inline.$('button=Ouvrir l’aperçu').click()
    const panel = $('aside[aria-label="Aperçus et activité"]')
    await panel.waitForDisplayed({ timeout: 10_000 })
    const currentFrame = panel.$('.live-canvas-frames iframe')
    await currentFrame.waitForDisplayed({ timeout: 10_000 })
    const previousSource = await currentFrame.getAttribute('src')

    const source = await readFile(CANVAS, 'utf8')
    await writeFile(CANVAS, source.replace('Canvas Bob Work E2E', 'Canvas Bob Work E2E actualisé'))
    await browser.waitUntil(async () => {
      const next = await panel.$('.live-canvas-frames iframe').getAttribute('src')
      return Boolean(next && next !== previousSource)
    }, { timeout: 10_000, interval: 300, timeoutMsg: 'Le hot reload du Canvas ne s’est pas déclenché.' })

    const diff = panel.$('button=Diff visuel')
    await diff.waitForEnabled({ timeout: 8_000 })
    await diff.click()
    expect(await panel.$$('.live-canvas-frames.is-comparing iframe')).toHaveLength(2)

    const destination = resolve(E2E_DATA, 'live-canvas-export.zip')
    await invokeTauri('export_live_canvas_zip', { sourcePath: CANVAS, destination })
    expect((await stat(destination)).size).toBeGreaterThan(100)
    await $('button[title="Fermer le panneau"]').click()
  })

  it('propose CodeGraph uniquement dans un projet de code et respecte le choix sans installation', async () => {
    const project = await invokeTauri<{ id: string }>('create_project', { input: {
      name: CODEGRAPH_PROJECT,
      description: 'Projet E2E pour le graphe de code.',
      objective: 'Tester les callers et l’analyse d’impact.',
      localPath: CODEGRAPH_ROOT,
      language: 'fr',
      defaultMode: 'agent',
    } })
    await browser.refresh()
    await ensureHomeReady()
    const projectRow = $(`//div[contains(@class,"sidebar-item")][contains(.,"${CODEGRAPH_PROJECT}")]`)
    await projectRow.waitForDisplayed({ timeout: 12_000 })
    await projectRow.click()
    await $(`button[aria-label="Nouvelle conversation dans ${CODEGRAPH_PROJECT}"]`).click()

    const prompt = "Fais une analyse d'impact de totalOrder et trouve tous ses callers"
    const composer = $('textarea[placeholder="Sur quoi travailler ?"]')
    await composer.setValue(prompt)
    await $('button[aria-label="Envoyer le prompt"]').click()
    await expect($(`div.msg-user=${prompt}`)).toBeDisplayed({ wait: 8_000 })
    const card = $('section[data-testid="conversation-interaction"]')
    await card.waitForDisplayed({ timeout: 8_000 })
    await card.scrollIntoView()
    const choices = await card.$$('button')
    expect(choices.length).toBeGreaterThanOrEqual(2)
    await choices[0].scrollIntoView()
    await expect(choices[0]).toBeDisplayed()
    await choices[1].click()
    await expect($('p*=Réponse Bob E2E terminée')).toBeDisplayed({ wait: 20_000 })
    await invokeTauri('delete_project', { id: project.id })
  })

  it('exécute ssh_exec/read/write/browse via le vrai backend Tauri et affiche xterm.js', async () => {
    const server = await invokeTauri<{ id: string }>('save_ssh_server', { input: {
      name: 'SSH process E2E',
      host: '127.0.0.1',
      port: 2222,
      user: 'bob-e2e',
      remoteRoot: '/srv/app',
      enabled: true,
    } })
    const tested = await invokeTauri<{ stdout: string; exitCode: number }>('test_ssh_server', { id: server.id })
    expect(tested).toMatchObject({ stdout: 'BOB_SSH_OK', exitCode: 0 })
    await invokeTauri('ssh_write', { id: server.id, path: 'conversation.txt', content: 'contenu distant Bob Work' })
    expect(await invokeTauri<string>('ssh_read', { id: server.id, path: 'conversation.txt', maxBytes: 4096 })).toBe('contenu distant Bob Work')
    const entries = await invokeTauri<Array<{ name: string; kind: string }>>('browse_ssh_directory', { id: server.id, path: '' })
    expect(entries).toEqual(expect.arrayContaining([{ name: 'conversation.txt', path: 'conversation.txt', kind: 'file', size: 21 }]))

    await clickSidebar('Réglages')
    await $('button=Serveurs SSH').click()
    await expect($('strong=SSH process E2E')).toBeDisplayed({ wait: 8_000 })
    await expect($('strong=Terminal SSH')).toBeDisplayed()
    await $('.xterm').waitForDisplayed({ timeout: 12_000 })
    await browser.waitUntil(async () => (await $('.xterm').getText()).includes('bob-e2e@remote'), {
      timeout: 12_000,
      timeoutMsg: 'Le terminal xterm.js n’a pas reçu la sortie du processus SSH.',
    })
    await invokeTauri('delete_ssh_server', { id: server.id })
  })
})
