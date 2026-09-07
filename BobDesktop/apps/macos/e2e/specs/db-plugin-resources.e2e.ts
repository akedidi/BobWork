import { writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, $ } from '@wdio/globals'
import { clickSidebar, ensureHomeReady, invokeTauri, openHomeChatComposer, openPluginPicker } from '../helpers'

const ROOT = join(tmpdir(), 'bob-work-db-e2e')
const SQLITE = join(ROOT, 'sales.sqlite')
const PDF = join(ROOT, 'brief.pdf')
const XLSX = join(ROOT, 'data.xlsx')
const EXE = join(ROOT, 'malware.exe')

describe('Bob Work — connexions DB et fichiers plugin', () => {
  before(async () => {
    mkdirSync(ROOT, { recursive: true })
    execFileSync('sqlite3', [SQLITE, 'CREATE TABLE t(id INTEGER);'])
    writeFileSync(PDF, '%PDF-1.4\n%eof\n')
    writeFileSync(XLSX, 'PK\u0003\u0004')
    writeFileSync(EXE, 'MZ')
    await ensureHomeReady()
  })

  it('crée, teste et affiche une connexion SQLite', async () => {
    const saved = await invokeTauri<{ id: string; name: string }>('save_db_connection', {
      input: {
        name: 'e2e-sales',
        engine: 'sqlite',
        config: { filePath: SQLITE },
        enabled: true,
      },
    })
    const tested = await invokeTauri<{ ok: boolean; message: string }>('test_db_connection', { id: saved.id })
    expect(tested.ok).toBe(true)

    await clickSidebar('Intégrations et MCP')
    await $('button=DB').click()
    await expect($('strong=e2e-sales')).toBeDisplayed({ wait: 8_000 })
    await expect($('p*=SQLite ouvert')).toBeDisplayed()

    const composer = await openHomeChatComposer()
    const menu = await openPluginPicker()
    await expect(menu.$('div*=Bases de données')).toBeDisplayed()
    const dbRow = menu.$('//button[contains(@class, "attach-plugin-row")][contains(., "e2e-sales")]')
    await dbRow.waitForDisplayed({ timeout: 8_000 })
    await dbRow.click()
    expect(await composer.getValue()).toContain('@db:e2e-sales')
    await expect($('[aria-label="Composants du prompt"]')).toBeDisplayed()
    await expect($('button[aria-label="Retirer e2e-sales"]')).toBeDisplayed()
  })

  it('uploade un PDF et un tableur sur un plugin, refuse un exe', async () => {
    const plugins = await invokeTauri<Array<{ id: string; name: string }>>('get_plugins')
    const plugin = plugins.find(item => item.name.includes('Word') || item.name.includes('Documents')) ?? plugins[0]
    expect(plugin).toBeTruthy()

    const pdf = await invokeTauri<{ fileName: string; kind: string }>('upload_plugin_file_resource', {
      pluginId: plugin.id,
      sourcePath: PDF,
    })
    expect(pdf.kind).toBe('pdf')
    const sheet = await invokeTauri<{ kind: string }>('upload_plugin_file_resource', {
      pluginId: plugin.id,
      sourcePath: XLSX,
    })
    expect(sheet.kind).toBe('spreadsheet')

    let rejected = false
    try {
      await invokeTauri('upload_plugin_file_resource', { pluginId: plugin.id, sourcePath: EXE })
    } catch {
      rejected = true
    }
    expect(rejected).toBe(true)

    const files = await invokeTauri<Array<{ fileName: string }>>('list_plugin_file_resources', { pluginId: plugin.id })
    expect(files.some(item => item.fileName === 'brief.pdf')).toBe(true)
    expect(files.some(item => item.fileName === 'data.xlsx')).toBe(true)

    await clickSidebar('Plugins')
    const row = $(`//div[contains(@class, "skill-list-row")][contains(., "${plugin.name}")]`)
    await row.$('button.skill-row-main').click()
    await expect($('h3=Fichiers ressources')).toBeDisplayed({ wait: 8_000 })
    await expect($('strong=brief.pdf')).toBeDisplayed()
    await expect($('strong=data.xlsx')).toBeDisplayed()

    const composer = await openHomeChatComposer()
    const menu = await openPluginPicker()
    const search = menu.$('input.popover-search')
    if (await search.isExisting()) await search.setValue(plugin.name)
    const pluginRow = menu.$(`//button[contains(@class, "attach-plugin-row")][contains(., "${plugin.name}")]`)
    await pluginRow.waitForDisplayed({ timeout: 8_000 })
    await pluginRow.click()
    expect(await composer.getValue()).toContain(`@plugin:${plugin.id}`)
    await expect($('[aria-label="Composants du prompt"]')).toBeDisplayed()
  })

  it('supprime la connexion DB et les fichiers', async () => {
    const connections = await invokeTauri<Array<{ id: string; name: string }>>('get_db_connections')
    for (const connection of connections.filter(item => item.name === 'e2e-sales')) {
      await invokeTauri('delete_db_connection', { id: connection.id })
    }
    const plugins = await invokeTauri<Array<{ id: string }>>('get_plugins')
    for (const plugin of plugins) {
      const files = await invokeTauri<Array<{ id: string; fileName: string }>>('list_plugin_file_resources', { pluginId: plugin.id })
      for (const file of files.filter(item => item.fileName === 'brief.pdf' || item.fileName === 'data.xlsx')) {
        await invokeTauri('delete_plugin_file_resource', { pluginId: plugin.id, fileId: file.id })
      }
    }
    const leftover = await invokeTauri<Array<{ name: string }>>('get_db_connections')
    expect(leftover.some(item => item.name === 'e2e-sales')).toBe(false)
  })
})
