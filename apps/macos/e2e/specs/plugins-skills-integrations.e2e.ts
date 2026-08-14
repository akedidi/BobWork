import { browser, expect, $ } from '@wdio/globals'
import { resolve } from 'node:path'
import {
  approveConfirmations,
  clickNewProject,
  clickSidebar,
  dismissUiChrome,
  ensureHomeReady,
  invokeTauri,
  labelled,
  openManualSkillForm,
  openPluginPicker,
  pickBuiltinPlugin,
  registerMcpServer,
  seedInstructionPlugin,
} from '../helpers'

const SKILL = 'skill-e2e-local'
const LOCAL_PLUGIN = 'Plugin E2E Usage Guard'
const MCP_ECHO = 'mcp-e2e-echo'
const MCP_SCRIPT = resolve(import.meta.dirname, '..', 'fixtures', 'mcp-echo-server.py')
const GITHUB_TOKEN = 'e2e-github-token'

const USE_WORD_PROMPT = 'USE_BUILTIN_WORD_PLUGIN_E2E Prépare une modification DOCX avec le plugin Word intégré.'
const USE_SKILL_PROMPT = 'USE_SKILL_E2E Applique le skill personnel pour produire une synthèse locale.'
const GITHUB_PROMPT = 'GITHUB_INTEGRATION_E2E @skill:bob-work-github Liste les dépôts accessibles en lecture seule.'
const MCP_ECHO_PROMPT = 'USE_MCP_ECHO_E2E Vérifie que le serveur MCP echo_text répond correctement.'

describe('Bob Work — plugins, skills et intégrations MCP (cas réels)', () => {
  before(async () => {
    await ensureHomeReady()
  })

  it('affiche les icônes de marque des plugins intégrés', async () => {
    await clickSidebar('Plugins')
    await expect($('strong=Microsoft Word')).toBeDisplayed()
    await expect($('strong=Microsoft PowerPoint')).toBeDisplayed()
    await expect($('strong=Microsoft Excel')).toBeDisplayed()

    const wordRow = $('//div[contains(@class, "skill-list-row")][contains(., "Microsoft Word")]')
    await expect(wordRow.$('.plugin-icon--word')).toBeDisplayed()
    await expect(wordRow.$('.plugin-icon--powerpoint')).not.toExist()

    const powerpointRow = $('//div[contains(@class, "skill-list-row")][contains(., "Microsoft PowerPoint")]')
    await expect(powerpointRow.$('.plugin-icon--powerpoint')).toBeDisplayed()

    const excelRow = $('//div[contains(@class, "skill-list-row")][contains(., "Microsoft Excel")]')
    await expect(excelRow.$('.plugin-icon--excel')).toBeDisplayed()

    await wordRow.$('button.skill-row-main').click()
    const detail = $('aside[aria-label="Détails du plugin Microsoft Word"]')
    await expect(detail.$('.plugin-icon--word.plugin-icon--lg')).toBeDisplayed()
  })

  it('filtre, recherche et réactive les plugins du catalogue', async () => {
    await seedInstructionPlugin(
      LOCAL_PLUGIN,
      'Plugin temporaire pour valider les filtres E2E.',
      'Ne rien exécuter en dehors du périmètre E2E.',
    )
    await clickSidebar('Nouveau chat')
    await clickSidebar('Plugins')
    const pluginRow = $(`//div[contains(@class, "skill-list-row")][contains(., "${LOCAL_PLUGIN}")]`)
    await pluginRow.waitForDisplayed({ timeout: 10_000 })
    await pluginRow.$(`input[aria-label="Désactiver le plugin ${LOCAL_PLUGIN}"]`).click()

    await $('button=Désactivés').click()
    await expect($(`//div[contains(@class, "skill-list-row")][contains(., "${LOCAL_PLUGIN}")]`)).toBeDisplayed()
    await expect($('strong=Microsoft Word')).not.toExist()

    await $('button=Tous').click()
    await $('input[aria-label="Rechercher un plugin"]').setValue('Word')
    await expect($('strong=Microsoft Word')).toBeDisplayed()
    await expect(pluginRow).not.toExist()

    await $('input[aria-label="Rechercher un plugin"]').setValue('')
    await $('button=Activés').click()
    await expect($('strong=Microsoft Word')).toBeDisplayed()
    await expect(pluginRow).not.toExist()

    await $('button=Tous').click()
    await pluginRow.$(`input[aria-label="Activer le plugin ${LOCAL_PLUGIN}"]`).click()
    await expect(pluginRow.$(`input[aria-label="Désactiver le plugin ${LOCAL_PLUGIN}"]`)).toBeChecked()
  })

  it('utilise un plugin intégré Word via le sélecteur du composeur', async () => {
    const composer = await pickBuiltinPlugin('Microsoft Word', /@plugin:builtin-word|@skill:bob-work-microsoft-word/)
    const prefix = (await composer.getValue()).trim()
    await composer.setValue(`${prefix} ${USE_WORD_PROMPT}`)
    await $('button[aria-label="Envoyer le prompt"]').click()

    await expect($('p*=Plugin Microsoft Word utilisé')).toBeDisplayed({ wait: 25_000 })
    await expect($('p*=brouillon DOCX')).toBeDisplayed()
    await $('button[title="Activité, sources et fichiers"]').click()
    const panel = $('aside[aria-label="Aperçus et activité"]')
    await expect(panel.$('.//div[@data-event-type="tool_started"][contains(., "draft.docx")]')).toBeDisplayed()
    await $('button[title="Fermer le panneau"]').click()
  })

  it('n’expose pas un plugin désactivé dans le sélecteur du composeur', async () => {
    await clickSidebar('Plugins')
    const pluginRow = $(`//div[contains(@class, "skill-list-row")][contains(., "${LOCAL_PLUGIN}")]`)
    await pluginRow.waitForDisplayed()
    const disableToggle = pluginRow.$(`input[aria-label="Désactiver le plugin ${LOCAL_PLUGIN}"]`)
    if (await disableToggle.isExisting()) {
      await disableToggle.click()
    }

    await clickSidebar('Nouveau chat')
    const menu = await openPluginPicker()
    await menu.$('input.popover-search, input[aria-label*="Rechercher un plugin"]').setValue(LOCAL_PLUGIN)
    await expect(menu.$(`//button[contains(@class, "attach-plugin-row")][contains(., "${LOCAL_PLUGIN}")]`)).not.toExist()
    await expect(menu.$('p=Aucun plugin correspondant.')).toBeDisplayed()

    await clickSidebar('Plugins')
    const rowAfterPicker = $(`//div[contains(@class, "skill-list-row")][contains(., "${LOCAL_PLUGIN}")]`)
    await rowAfterPicker.waitForDisplayed({ timeout: 8_000 })
    await approveConfirmations()
    const deleteBtn = rowAfterPicker.$(`button[aria-label="Supprimer le plugin ${LOCAL_PLUGIN}"]`)
    if (await deleteBtn.isExisting()) await deleteBtn.click()
    const plugins = await invokeTauri<Array<{ id: string; name: string }>>('get_plugins')
    const list = Array.isArray(plugins) ? plugins : []
    for (const item of list) {
      if (item.name === LOCAL_PLUGIN) await invokeTauri('delete_plugin', { pluginId: item.id })
    }
    await clickSidebar('Plugins')
    const allFilter = $('button=Tous')
    if (await allFilter.isExisting()) await allFilter.click()
    const search = $('input[aria-label="Rechercher un plugin"]')
    if (await search.isExisting()) await search.setValue('')
    await expect($(`//div[contains(@class, "skill-list-row")][contains(., "${LOCAL_PLUGIN}")]`)).not.toExist()
  })

  it('crée un skill personnel et l’exécute via @skill dans une conversation', async () => {
    await openManualSkillForm()
    await $('input[placeholder="analyse-contrats"]').setValue(SKILL)
    await labelled('Description').setValue('Pour valider le parcours skill E2E réel.')
    await $('textarea[placeholder^="Décris étape par étape"]').setValue('Lire la demande, vérifier les entrées, produire une synthèse locale sans appel réseau.')
    await $('button=Enregistrer').click()
    await expect($(`strong=${SKILL}`)).toBeDisplayed()

    await clickSidebar('Nouveau chat')
    const composer = $('textarea[placeholder="Sur quoi travailler ?"]')
    await composer.setValue(`@skill:${SKILL} ${USE_SKILL_PROMPT}`)
    await $('button[aria-label="Envoyer le prompt"]').click()

    await expect($('p*=Skill skill-e2e-local exécuté')).toBeDisplayed({ wait: 12_000 })
    await expect($('p*=synthèse locale produite')).toBeDisplayed()

    await clickSidebar('Skills')
    const skillRow = $(`//div[contains(@class, "skill-list-row")][contains(., "${SKILL}")]`)
    await skillRow.$('button.skill-row-main').click()
    await approveConfirmations()
    await $('aside.skill-detail-panel').$('button=Supprimer').click()
    await expect(skillRow).not.toExist()
  })

  it('connecte GitHub via OAuth et installe le skill intégré', async () => {
    await clickSidebar('Intégrations et MCP')
    await $('button=Intégrations').click()
    await $('button=Dev & collab').click()

    const githubCard = $('//div[.//div[normalize-space()="GitHub"]]')
    await githubCard.waitForDisplayed()
    await expect(githubCard.$('.plugin-icon--github')).toBeDisplayed()

    await invokeTauri('e2e_connect_integration', {
      integrationId: 'github',
      accessToken: GITHUB_TOKEN,
      accountLabel: 'e2e-user',
    })

    await expect(githubCard.$('.status-dot.green')).toBeDisplayed({ wait: 8_000 })
    await expect(githubCard.$('button=Déconnecter')).toBeDisplayed()

    await clickSidebar('Skills')
    await expect($('strong=bob-work-github')).toBeDisplayed()
    const githubSkill = $(`//div[contains(@class, "skill-list-row")][contains(., "bob-work-github")]`)
    await githubSkill.$('button.skill-row-main').click()
    await expect($('aside[aria-label="Détails du skill bob-work-github"]')).toBeDisplayed()
  })

  it('injecte le jeton GitHub dans Bob Shell lors d’une tâche réelle', async () => {
    await invokeTauri('e2e_connect_integration', {
      integrationId: 'github',
      accessToken: GITHUB_TOKEN,
      accountLabel: 'e2e-user',
    })
    await clickNewProject()
    await labelled('Nom').setValue('Projet GitHub E2E')
    await labelled('Description', 'textarea').setValue('Valide l’injection du jeton GitHub dans Bob Shell.')
    const githubAllow = $('//fieldset[legend[normalize-space()="Intégrations autorisées"]]//label[contains(., "github")]//input')
    await githubAllow.waitForExist({ timeout: 8_000 })
    if (!(await githubAllow.isSelected())) await githubAllow.click()
    await $('button=Enregistrer le projet').click()
    await $('h1=Projet GitHub E2E').waitForDisplayed({ timeout: 20_000 })

    const newConversation = $('button=+ Nouvelle conversation')
    await newConversation.waitForClickable({ timeout: 12_000 })
    await newConversation.click()
    await dismissUiChrome()
    const composer = $('textarea[placeholder="Sur quoi travailler ?"]')
    await composer.waitForDisplayed({ timeout: 20_000 }).catch(async error => {
      // Embedded WebKit can occasionally acknowledge the project button click
      // without dispatching it. Retry the same user action once, then preserve
      // the original failure if navigation is still impossible.
      if (!await newConversation.isDisplayed().catch(() => false)) throw error
      await newConversation.click()
      await composer.waitForDisplayed({ timeout: 12_000 })
    })
    await composer.setValue(GITHUB_PROMPT)
    await $('button[aria-label="Envoyer le prompt"]').click()

    await expect($('p*=Intégration GitHub active')).toBeDisplayed({ wait: 20_000 })
    await expect($('p*=deux dépôts consultés')).toBeDisplayed()
    await $('button[title="Activité, sources et fichiers"]').click()
    const panel = $('aside[aria-label="Aperçus et activité"]')
    await expect(panel.$('.//div[@data-event-type="tool_started"][contains(., "gh repo list")]')).toBeDisplayed()
    await $('button[title="Fermer le panneau"]').click()
  })

  it('ajoute un serveur MCP Python réel, le désactive puis le réactive sans écraser les autres', async () => {
    const serverCard = await registerMcpServer(MCP_ECHO, MCP_SCRIPT)
    await expect(serverCard.$('span=stdio')).toBeDisplayed()
    await expect(serverCard.$('input[type="checkbox"]')).toBeChecked()

    const cloudArchitectMcp = $('//article[contains(@class, "extension-card")][contains(., "bw-cloud-architect-agent-architecture-tools")]')
    if (await cloudArchitectMcp.isExisting()) {
      await expect(cloudArchitectMcp).toBeDisplayed()
    }

    await serverCard.$('input[type="checkbox"]').click()
    await expect(serverCard.$('input[type="checkbox"]')).not.toBeChecked()
    await serverCard.$('input[type="checkbox"]').click()
    await expect(serverCard.$('input[type="checkbox"]')).toBeChecked()
  })

  it('exécute une tâche Bob qui appelle réellement le serveur MCP echo_text', async () => {
    await clickSidebar('Nouveau chat')
    const composer = $('textarea[placeholder="Sur quoi travailler ?"]')
    await composer.setValue(MCP_ECHO_PROMPT)
    await $('button[aria-label="Envoyer le prompt"]').click()

    await expect($('p*=Serveur MCP mcp-e2e-echo opérationnel')).toBeDisplayed({ wait: 12_000 })
    await expect($('p*=echo:integration-mcp')).toBeDisplayed()
    await $('button[title="Activité, sources et fichiers"]').click()
    const panel = $('aside[aria-label="Aperçus et activité"]')
    await expect(panel.$('.//div[@data-event-type="tool_started"][contains(., "echo_text")]')).toBeDisplayed()
    await expect(panel.$('.//div[@data-event-type="tool_finished"][contains(., "echo:integration-mcp")]')).toBeDisplayed()
    await $('button[title="Fermer le panneau"]').click()
  })

  it('déconnecte GitHub et supprime le serveur MCP de test', async () => {
    await clickSidebar('Intégrations et MCP')
    await $('button=Intégrations').click()
    await $('button=Dev & collab').click()

    const githubCard = $('//div[.//div[normalize-space()="GitHub"]][.//button[contains(., "Déconnecter")]]')
    await approveConfirmations()
    await githubCard.$('button=Déconnecter').click()
    await expect(githubCard.$('button=Connecter avec GitHub')).toBeDisplayed({ wait: 8_000 })

    await $('button=Serveurs MCP').click()
    const serverCard = $(`//article[contains(@class, "extension-card")][contains(., "${MCP_ECHO}")]`)
    await approveConfirmations()
    await serverCard.$('button=Supprimer').click()
    await expect(serverCard).not.toExist()
  })
})
