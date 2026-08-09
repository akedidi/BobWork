import { browser, expect, $, $$ } from '@wdio/globals'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const PROJECT = 'Projet E2E Finance'
const FIRST_VISIBLE_PROMPT = 'PREMIER_PROMPT_VISIBLE_E2E vérifie affichage immédiat'
const FIRST_VISIBLE_TITLE = 'Affichage immédiat du premier prompt'
const FIRST_PROMPT = 'PREMIER_PROMPT_E2E analyse le budget alpha-unique'
const FIRST_TITLE = 'Analyse du budget alpha'
const SECOND_PROMPT = 'SECOND_PROMPT_E2E prépare la synthèse beta-unique'
const ERROR_PROMPT = 'ERROR_STREAM_E2E vérifie la remontée structurée'
const VISUAL_ACTIVITY_PROMPT = 'VISUAL_AGENT_ACTIVITY_E2E montre visuellement les étapes agentiques en temps réel'
const PLUGIN = 'Plugin E2E Local'
const AGENTIC_PLUGIN = 'Cloud Architect Agent'
const CREATE_AGENTIC_PLUGIN_PROMPT = 'CREATE_CLOUD_ARCHITECT_PLUGIN_E2E Crée un plugin agentique Cloud Architect avec un outil Python utilisable en CLI, local et sans dépendance réseau.'
const UPDATE_AGENTIC_PLUGIN_PROMPT = 'UPDATE_CLOUD_ARCHITECT_PLUGIN_E2E Prépare une nouvelle version du plugin Cloud Architect sans remplacer silencieusement la version installée.'
const SKILL = 'skill-e2e-local'
const MCP = 'mcp-e2e-local'
const SCHEDULE = 'Rapport E2E quotidien'
const VISUAL_ARTIFACTS = resolve(import.meta.dirname, '..', 'artifacts', 'agent-activity')

async function captureAgentActivity(name: string) {
  await mkdir(VISUAL_ARTIFACTS, { recursive: true })
  await browser.saveScreenshot(resolve(VISUAL_ARTIFACTS, `${name}.png`))
}

function labelled(label: string, control: 'input' | 'textarea' | 'select' = 'input') {
  return $(`//label[contains(normalize-space(.), "${label}")]//${control}`)
}

async function clickSidebar(label: string) {
  const item = $(`//div[contains(@class, "sidebar-item")][contains(normalize-space(.), "${label}")]`)
  await item.waitForClickable()
  await item.click()
}

async function approveConfirmations() {
  await browser.execute(() => {
    window.confirm = () => true
  })
}

async function selectValue(select: WebdriverIO.Element, value: string) {
  await browser.execute((node, nextValue) => {
    const control = node as unknown as HTMLSelectElement
    control.value = nextValue
    control.dispatchEvent(new Event('change', { bubbles: true }))
  }, select, value)
}

async function selectText(select: WebdriverIO.Element, text: string) {
  await browser.execute((node, label) => {
    const control = node as unknown as HTMLSelectElement
    const option = Array.from(control.options).find(item => item.text === label)
    if (!option) throw new Error(`Option introuvable : ${label}`)
    control.value = option.value
    control.dispatchEvent(new Event('change', { bubbles: true }))
  }, select, text)
}

describe('Bob Work — parcours macOS natifs de bout en bout', () => {
  it('démarre avec le vrai backend local et propose la clé Bob limitée à la session', async () => {
    const heading = $('h1=Sur quoi travailler ?')
    await heading.waitForDisplayed({ timeout: 15_000 })
    await expect(heading).toBeDisplayed()
    await expect($('button=Configurer Bob')).toBeDisplayed()
    await expect(browser).toHaveTitle('Bob Work')
  })

  it('configure directement bob run sans proposer le login SSO IBM', async () => {
    await $('button=Configurer Bob').click()
    await expect($('h1=Configurer IBM Bob')).toBeDisplayed()
    await expect($('button=Continuer avec IBM')).not.toExist()
    await expect($('*=IBMid')).not.toExist()

    const success = $('h1=IBM Bob est prêt')
    await $('input[aria-label="Clé API IBM Bob"]').setValue('e2e-headless-session-key')
    await $('button=Enregistrer dans le coffre').click()
    await success.waitForDisplayed({ timeout: 12_000 })
    await $('button=Continuer').click()
    await expect($('span=Réglages')).toBeDisplayed()
    await expect($('button=Configurer Bob')).not.toExist()
  })

  it('ouvre correctement les menus de pièce jointe et de modes sans chevauchement', async () => {
    await $('button[title="Joindre un fichier ou un dossier"]').click()
    const attachmentMenu = $('[role="menu"][aria-label="Ajouter une pièce jointe"]')
    await attachmentMenu.waitForDisplayed()
    await expect(attachmentMenu.$('button*=Fichier(s)')).toBeDisplayed()
    await expect(attachmentMenu.$('button*=Dossier')).toBeDisplayed()

    const attachmentBounds = await browser.execute(() => {
      const node = document.querySelector<HTMLElement>('[role="menu"][aria-label="Ajouter une pièce jointe"]')
      if (!node) throw new Error('Menu de pièce jointe introuvable')
      const rect = node.getBoundingClientRect()
      return { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight }
    })
    expect(attachmentBounds.top).toBeGreaterThanOrEqual(0)
    expect(attachmentBounds.left).toBeGreaterThanOrEqual(0)
    expect(attachmentBounds.right).toBeLessThanOrEqual(attachmentBounds.width)
    expect(attachmentBounds.bottom).toBeLessThanOrEqual(attachmentBounds.height)

    await $('button[aria-label="Mode Bob : Agent"]').click()
    await expect(attachmentMenu).not.toExist()
    const modeMenu = $('[role="menu"][aria-label="Modes Bob"]')
    await expect(modeMenu).toBeDisplayed()
    await expect(modeMenu.$('strong=Agent')).toBeDisplayed()
    await expect(modeMenu.$('strong=Plan')).toBeDisplayed()
    await expect(modeMenu.$('strong=Ask')).toBeDisplayed()
    await modeMenu.$('strong=Plan').click()
    await expect($('button[aria-label="Mode Bob : Plan"]')).toBeDisplayed()

    await $('button[aria-label="Mode Bob : Plan"]').click()
    await $('[role="menu"][aria-label="Modes Bob"]').$('strong=Agent').click()
    await expect($('button[aria-label="Mode Bob : Agent"]')).toBeDisplayed()
  })

  it('affiche le premier prompt immédiatement dans les conversations et les tâches actives', async () => {
    const composer = $('textarea[placeholder="Sur quoi travailler ?"]')
    await composer.setValue(FIRST_VISIBLE_PROMPT)
    await $('button[aria-label="Envoyer le prompt"]').click()
    await expect($('div.conversation-title=Nouvelle conversation')).toBeDisplayed()

    const recent = $('[aria-label="Conversations récentes"]')
    const conversation = recent.$('.//div[@data-conversation-id]')
    await conversation.waitForDisplayed({ timeout: 4_000 })
    await expect(recent.$(`.//div[@data-conversation-id][.//span[normalize-space()="${FIRST_VISIBLE_TITLE}"]]`)).toBeDisplayed({ wait: 8_000 })
    await expect($(`div.conversation-title=${FIRST_VISIBLE_TITLE}`)).toBeDisplayed()
    await expect(recent.$(`.//span[normalize-space()="${FIRST_VISIBLE_PROMPT}"]`)).not.toExist()

    await clickSidebar('Tâches')
    const task = $(`//button[contains(@class, "task-card")][contains(., "${FIRST_VISIBLE_PROMPT}")]`)
    await task.waitForDisplayed({ timeout: 4_000 })
    await expect(task.$('[aria-label="En cours"]')).toBeDisplayed()
    await expect(task.$('.task-state')).toHaveText('En cours')

    await browser.waitUntil(async () => (await task.$('.task-state').getText()) === 'Terminée', {
      timeout: 15_000,
      interval: 250,
      timeoutMsg: 'La tâche du premier prompt n’a pas été rafraîchie après sa fin.',
    })
    await clickSidebar('Nouveau chat')
    await expect($('h1=Sur quoi travailler ?')).toBeDisplayed()
  })

  it('crée et configure un projet avec instructions, mode et permissions locales', async () => {
    await $('button[aria-label="Nouveau projet"]').click()
    await expect($('h1=Créer un projet')).toBeDisplayed()

    await labelled('Nom').setValue(PROJECT)
    await labelled('Description', 'textarea').setValue('Projet créé par le parcours natif E2E.')
    await labelled('Objectif', 'textarea').setValue('Valider les fonctions locales de Bob Work.')
    await labelled('Instructions personnalisées', 'textarea').setValue('Répondre en français et toujours citer les sources explicites.')
    await selectValue(await labelled('Langue', 'select'), 'fr')
    await selectValue(await labelled('Mode Bob par défaut', 'select'), 'plan')
    await $('button=Enregistrer le projet').click()

    const projectTitle = $(`h1=${PROJECT}`)
    await projectTitle.waitForDisplayed({ timeout: 12_000 })
    await expect($('strong=Valider les fonctions locales de Bob Work.')).toBeDisplayed()
    await expect($('p=Répondre en français et toujours citer les sources explicites.')).toBeDisplayed()
  })

  it('crée une conversation de projet, exécute Bob Shell et traite les prompts en file FIFO', async () => {
    await $('button=+ Nouvelle conversation').click()
    const composer = $('textarea[placeholder="Travailler avec Bob…"]')
    await composer.waitForDisplayed()

    await composer.setValue(FIRST_PROMPT)
    await $('button[aria-label="Envoyer le prompt"]').click()

    const queueButton = $('button[aria-label="Ajouter le prompt à la file"]')
    await queueButton.waitForDisplayed({ timeout: 8_000 })
    await expect($('[aria-label="Bob réfléchit"]')).toBeDisplayed()
    await expect($(`//div[contains(@class, "sidebar-item") and contains(@class, "sub-item")][.//span[normalize-space()="${FIRST_TITLE}"]]`)).toBeDisplayed({ wait: 8_000 })
    await composer.setValue(SECOND_PROMPT)
    await queueButton.click()

    await expect($('section.prompt-queue')).toBeDisplayed()
    await expect($(`article.prompt-queue-item*=${SECOND_PROMPT}`)).toBeDisplayed()

    await browser.waitUntil(async () => {
      const responses = await $$('p*=Réponse Bob E2E terminée.')
      return responses.length >= 2
    }, { timeout: 20_000, interval: 250, timeoutMsg: 'Les deux réponses Bob n’ont pas terminé dans l’ordre attendu.' })

    await expect($(`div.msg-user=${FIRST_PROMPT}`)).toBeDisplayed()
    await expect($(`div.msg-user=${SECOND_PROMPT}`)).toBeDisplayed()
    await expect($('div.msg-assistant*=Analyse E2E explicite du projet.')).not.toExist()
    await expect($('section.prompt-queue')).not.toExist()
    await expect($('button[aria-label="Envoyer le prompt"]')).toBeDisplayed()
    await expect($(`//div[contains(@class, "sidebar-item") and contains(@class, "sub-item")][.//span[normalize-space()="${FIRST_TITLE}"]]`)).toBeDisplayed()
    await expect($('//span[normalize-space()="Titre incorrect du second prompt"]')).not.toExist()
  })

  it('montre visuellement en temps réel Bob qui analyse, lit, teste puis termine', async () => {
    await clickSidebar('Nouveau chat')
    const composer = $('textarea[placeholder="Sur quoi travailler ?"]')
    await composer.waitForDisplayed()
    await composer.setValue(VISUAL_ACTIVITY_PROMPT)
    await $('button[aria-label="Envoyer le prompt"]').click()

    await $('button[title="Activité, sources et fichiers"]').click()
    const panel = $('aside[aria-label="Aperçus et activité"]')
    await expect(panel).toBeDisplayed()
    await expect(panel.$('strong=Activité de Bob')).toBeDisplayed()
    await expect(panel.$('.workspace-panel-title .task-spinner')).toBeDisplayed()

    const analysis = panel.$('[data-event-type="analysis"]')
    await expect(analysis.$('strong')).toHaveText('Analyse en cours')
    await expect(analysis.$('p')).toHaveText('J’analyse la structure du projet et je prépare les prochaines actions observables.')
    await expect(analysis).toHaveElementClass('running')
    await captureAgentActivity('01-analyse-en-cours')

    await expect(panel.$('.//div[@data-event-type="tool_started"][.//strong[normalize-space()="Lecture de /tmp/package.json"]]')).toBeDisplayed()
    await captureAgentActivity('02-lecture-fichier')

    await expect(panel.$('.//div[@data-event-type="tool_finished" and contains(@class, "completed")][.//strong[normalize-space()="Fichier lu : /tmp/package.json"]]')).toBeDisplayed()
    await expect(panel.$('.//div[@data-event-type="tool_started"][.//strong[normalize-space()="Exécution des tests"]]')).toBeDisplayed()
    await captureAgentActivity('03-tests-en-cours')

    await expect(panel.$('.//div[@data-event-type="tool_finished" and contains(@class, "completed")][.//strong[normalize-space()="Tests terminés"]]')).toBeDisplayed()
    await expect(panel.$('.//div[@data-event-type="run_finished" and contains(@class, "completed")][.//strong[normalize-space()="Tâche terminée"]]')).toBeDisplayed()
    await expect(panel.$('.workspace-panel-title .task-spinner')).not.toExist()
    await captureAgentActivity('04-tache-terminee')

    const outputs = $('strong=Sorties et sources')
    await outputs.waitForDisplayed({ timeout: 8_000 })
    await expect($('small=https://example.test/source')).toBeDisplayed()

    await $('button[title="Nouvel onglet Web"]').click()
    const address = $('input[aria-label="Adresse Web"]')
    await address.waitForDisplayed()
    await address.setValue('example.com')
    await browser.keys('Enter')
    await expect(address).toHaveValue('https://example.com')
    await $('button[title="Fermer le panneau"]').click()
  })

  it('remonte une erreur structurée Bob Shell sans mélanger le résumé d’analyse avec la réponse', async () => {
    await clickSidebar('Nouveau chat')
    const composer = $('textarea[placeholder="Sur quoi travailler ?"]')
    await composer.waitForDisplayed()
    await composer.setValue(ERROR_PROMPT)
    await $('button[aria-label="Envoyer le prompt"]').click()

    await expect($('p*=Erreur Bob E2E structurée.')).toBeDisplayed({ wait: 12_000 })
    await expect($('div.msg-assistant*=Analyse E2E avant erreur.')).not.toExist()

    await $('button[title="Activité, sources et fichiers"]').click()
    const panel = $('aside[aria-label="Aperçus et activité"]')
    const analysis = panel.$('[data-event-type="analysis"]')
    await expect(analysis.$('strong')).toHaveText('Analyse en cours')
    await expect(analysis.$('p')).toHaveText('Analyse E2E avant erreur.')
    const error = panel.$('[data-event-type="error"].failed')
    await expect(error.$('strong')).toHaveText('Erreur Bob')
    await expect(error.$('p')).toHaveText('Erreur Bob E2E structurée.')
    await $('button[title="Fermer le panneau"]').click()
  })

  it('retrouve la conversation par recherche locale', async () => {
    await $('button[title="Rechercher"]').click()
    const search = $('input[placeholder="Rechercher dans les conversations, projets et tâches…"]')
    await search.setValue('alpha-unique')
    const result = $('//div[contains(@class, "search-results")]//button[.//span[normalize-space()="message"]]')
    await result.waitForDisplayed({ timeout: 8_000 })
    await result.click()
    await expect($(`div.msg-user=${FIRST_PROMPT}`)).toBeDisplayed()
  })

  it('présente l’historique des tâches, les entrées, sorties, sources et événements', async () => {
    await clickSidebar('Tâches')
    await expect($('span=Tâches')).toBeDisplayed()
    await expect($('button=Historique')).toBeDisplayed()

    const task = $(`//button[contains(@class, "task-card")][contains(., "${SECOND_PROMPT}")]`)
    await task.waitForDisplayed({ timeout: 10_000 })
    await task.click()
    const drawer = $('aside.task-drawer')
    await drawer.waitForDisplayed({ timeout: 8_000 })
    await expect(drawer.$('strong=Détail de la tâche')).toBeDisplayed()
    await expect(drawer.$('h3=Tentatives (1)')).toBeDisplayed()
    await expect(drawer.$('h3=Entrées (1)')).toBeDisplayed()
    await expect(drawer.$('h3*=Sorties et sources')).toBeDisplayed()
    await expect(drawer.$('small=https://example.test/source')).toBeDisplayed()
    await expect(drawer.$('h3*=Activité (')).toBeDisplayed()
  })

  it('épingle une tâche et sa conversation puis les retrouve depuis la barre latérale', async () => {
    await clickSidebar('Tâches')
    const task = $(`//button[contains(@class, "task-card")][contains(., "${SECOND_PROMPT}")]`)
    await task.waitForDisplayed({ timeout: 10_000 })
    await task.$('[aria-label="Épingler la tâche"]').click()
    await expect(task.$('[aria-label="Désépingler la tâche"]')).toBeDisplayed()

    const pinnedTask = $(`//div[contains(@class, "sidebar-item")][contains(., "${SECOND_PROMPT}")][.//button[contains(@aria-label, "Désépingler")]]`)
    await pinnedTask.waitForDisplayed({ timeout: 8_000 })

    await task.click()
    const drawer = $('aside.task-drawer')
    await drawer.$('button=Ouvrir la conversation').click()
    const pinConversation = $('button[aria-label="Épingler la conversation"]')
    await pinConversation.waitForClickable({ timeout: 8_000 })
    await pinConversation.click()
    await expect($('button[aria-label="Désépingler la conversation"]')).toBeDisplayed()

    const pinnedConversation = $(`//div[contains(@class, "sidebar-item")][contains(., "${FIRST_TITLE}")][.//button[contains(@aria-label, "Désépingler")]]`)
    await pinnedConversation.waitForDisplayed({ timeout: 8_000 })

    await clickSidebar('Tâches')
    await $('button=Épinglées').click()
    await expect($(`//button[contains(@class, "task-card")][contains(., "${SECOND_PROMPT}")]`)).toBeDisplayed()
  })

  it('crée une planification, l’exécute immédiatement, consulte son historique et la met en pause', async () => {
    await clickSidebar('Planifié')
    await expect($('span=Planifications')).toBeDisplayed()
    await $('button=+ Nouvelle').click()
    await expect($('div=Nouvelle planification')).toBeDisplayed()

    await $('input[placeholder="Ex : Rapport quotidien"]').setValue(SCHEDULE)
    await $('textarea[placeholder^="Génère un rapport"]').setValue('Produis un rapport E2E à partir des tâches terminées.')
    await selectText(await $('//label[normalize-space()="Projet"]/following-sibling::select[1]'), PROJECT)
    await selectText(await $('//label[normalize-space()="Fréquence"]/following-sibling::select[1]'), 'Chaque jour')
    await $('button=Créer').click()

    await expect($(`//div[normalize-space()="${SCHEDULE}"]`)).toBeDisplayed()
    await $('button=Exécuter maintenant').click()
    const historyTitle = $(`div=Historique · ${SCHEDULE}`)
    await historyTitle.waitForDisplayed({ timeout: 12_000 })
    await expect($('small*=Tâche')).toBeDisplayed({ wait: 12_000 })
    await $('button=Fermer').click()

    await $('button[title="Mettre en pause"]').click()
    await expect($('span=Pausé')).toBeDisplayed()
  })

  it('crée, modifie, désactive puis supprime un plugin local', async () => {
    await clickSidebar('Plugins')
    await expect($('strong=Documents')).toBeDisplayed()
    await expect($('strong=Microsoft Word')).toBeDisplayed()
    await expect($('strong=Microsoft PowerPoint')).toBeDisplayed()
    await expect($('strong=Microsoft Excel')).toBeDisplayed()
    await expect($('strong=Microsoft OneNote')).toBeDisplayed()

    await $('button=+ Nouveau plugin').click()
    await labelled('Nom').setValue(PLUGIN)
    await labelled('Description').setValue('Automatise une validation locale E2E.')
    await labelled('Instructions', 'textarea').setValue('Vérifier les entrées, produire un résultat local et demander avant toute action externe.')
    await $('button=Enregistrer').click()
    const pluginRow = $(`//div[contains(@class, "skill-list-row")][contains(., "${PLUGIN}")]`)
    await pluginRow.waitForDisplayed({ timeout: 10_000 })
    await pluginRow.$('button.skill-row-main').click()
    const pluginDetail = $(`aside[aria-label="Détails du plugin ${PLUGIN}"]`)
    await pluginDetail.waitForDisplayed()

    await pluginDetail.$('button=Modifier').click()
    const description = labelled('Description')
    await description.setValue('Plugin local E2E modifié.')
    await $('button=Enregistrer').click()
    await expect(pluginDetail.$('p=Plugin local E2E modifié.')).toBeDisplayed()

    await pluginRow.$(`input[aria-label="Désactiver le plugin ${PLUGIN}"]`).click()
    await expect(pluginRow.$(`input[aria-label="Activer le plugin ${PLUGIN}"]`)).not.toBeChecked()
    await approveConfirmations()
    await pluginDetail.$('button=Supprimer').click()
    await expect(pluginRow).not.toExist()
  })

  it('crée un plugin agentique Cloud Architect avec MCP puis exécute réellement son outil', async () => {
    await clickSidebar('Nouveau chat')
    const creator = $('textarea[placeholder="Sur quoi travailler ?"]')
    await creator.setValue(CREATE_AGENTIC_PLUGIN_PROMPT)
    await $('button[aria-label="Envoyer le prompt"]').click()
    await expect($('p*=Plugin Cloud Architect Agent créé avec son serveur MCP')).toBeDisplayed({ wait: 12_000 })

    await clickSidebar('Plugins')
    const pluginRow = $(`//div[contains(@class, "skill-list-row")][contains(., "${AGENTIC_PLUGIN}")]`)
    await pluginRow.waitForDisplayed({ timeout: 10_000 })
    await expect(pluginRow.$('span=Personnel')).toBeDisplayed()
    await expect(pluginRow.$(`input[aria-label="Désactiver le plugin ${AGENTIC_PLUGIN}"]`)).toBeChecked()
    await pluginRow.$('button.skill-row-main').click()
    const pluginDetail = $(`aside[aria-label="Détails du plugin ${AGENTIC_PLUGIN}"]`)
    await expect(pluginDetail.$('li=Demander votre accord avant d’exécuter une action locale')).toBeDisplayed()
    await expect(pluginDetail.$('li=Lire les fichiers que vous avez autorisés')).toBeDisplayed()
    await expect(pluginDetail.$('li=Utiliser les outils connectés fournis par ce plugin')).toBeDisplayed()
    await expect(pluginDetail.$('li=Exécuter les actions automatiques déclarées par ce plugin')).toBeDisplayed()
    await expect(pluginDetail.$('li=Utiliser le navigateur uniquement avec votre autorisation')).toBeDisplayed()
    await expect(pluginDetail.$('h3=Outils connectés')).toBeDisplayed()
    await expect(pluginDetail.$('strong=Outils Cloud Architect')).toBeDisplayed()
    await expect(pluginDetail.$('span=Actif')).toBeDisplayed()
    await expect(pluginDetail.$('li=assess architecture')).toBeDisplayed()
    await expect(pluginDetail.$('span=Python')).not.toExist()
    await expect(pluginDetail.$('span=CLI')).not.toExist()
    await expect(pluginDetail.$('h3=Connexions')).toBeDisplayed()
    await expect(pluginDetail.$('strong=Cloud Architecture MCP')).toBeDisplayed()
    await expect(pluginDetail.$('.//div[contains(@class, "plugin-mcp-card")][contains(., "Cloud Architecture MCP")]//span[normalize-space()="Connecté"]')).toBeDisplayed()
    await expect(pluginDetail.$('strong=GitHub')).toBeDisplayed()
    await expect(pluginDetail.$('h3=Navigateur')).toBeDisplayed()
    await expect(pluginDetail.$('strong=Sources cloud dans le navigateur')).toBeDisplayed()
    await expect(pluginDetail.$('span=Prêt')).toBeDisplayed()
    await expect(pluginDetail.$('h3=Actions automatiques')).toBeDisplayed()
    await expect(pluginDetail.$('li*=Préparation du contexte cloud')).toBeDisplayed()
    await expect(pluginDetail.$('h3=Automatisations')).toBeDisplayed()
    await expect(pluginDetail.$('strong=Revue cloud hebdomadaire')).toBeDisplayed()

    await pluginDetail.$('button=Planifier').click()
    await expect($('div=Nouvelle planification')).toBeDisplayed()
    await expect($('input[placeholder="Ex : Rapport quotidien"]')).toHaveValue('Revue cloud hebdomadaire')
    await expect($('textarea[placeholder^="Génère un rapport"]')).toHaveValue('Analyse les changements d’architecture cloud et priorise les risques.')
    await expect($('//label[normalize-space()="Mode Bob Shell"]/following-sibling::select[1]')).toHaveValue('plugin:agentic-cloud-architect-agent')
    await $('button=Annuler').click()
    await clickSidebar('Plugins')
    const pluginRowAfterSchedule = $(`//div[contains(@class, "skill-list-row")][contains(., "${AGENTIC_PLUGIN}")]`)
    await pluginRowAfterSchedule.$('button.skill-row-main').click()
    const pluginDetailAfterSchedule = $(`aside[aria-label="Détails du plugin ${AGENTIC_PLUGIN}"]`)

    await pluginRowAfterSchedule.$(`input[aria-label="Désactiver le plugin ${AGENTIC_PLUGIN}"]`).click()
    await expect(pluginDetailAfterSchedule.$('.plugin-mcp-card').$('span=Désactivé')).toBeDisplayed()
    await pluginRowAfterSchedule.$(`input[aria-label="Activer le plugin ${AGENTIC_PLUGIN}"]`).click()
    await expect(pluginDetailAfterSchedule.$('.plugin-mcp-card').$('span=Actif')).toBeDisplayed()

    await clickSidebar('Nouveau chat')
    const prompt = $('textarea[placeholder="Sur quoi travailler ?"]')
    await $('button[title="Joindre un fichier ou un dossier"]').click()
    const pluginMenu = $('[role="menu"][aria-label="Ajouter une pièce jointe"]')
    const pluginChoice = pluginMenu.$(`//button[contains(@class, "attach-plugin-row")][contains(., "${AGENTIC_PLUGIN}")]`)
    await pluginChoice.waitForDisplayed({ timeout: 8_000 })
    await pluginChoice.click()
    expect(await prompt.getValue()).toContain('@plugin:agentic-cloud-architect-agent')
    await prompt.addValue('Évalue une architecture AWS de paiements mono-région et donne le risque prioritaire.')
    await approveConfirmations()
    await $('button[aria-label="Envoyer le prompt"]').click()

    await expect($('p*=Cloud Architect Agent a utilisé son outil MCP')).toBeDisplayed({ wait: 12_000 })
    await expect($('p*=stratégie multi-région')).toBeDisplayed()
    await $('button[title="Activité, sources et fichiers"]').click()
    const panel = $('aside[aria-label="Aperçus et activité"]')
    await expect(panel.$('.//div[@data-event-type="hook_started"][contains(., "Préparation du contexte cloud")]')).toBeDisplayed()
    await expect(panel.$('.//div[@data-event-type="hook_finished"][contains(., "Préparation du contexte cloud terminé")]')).toBeDisplayed()
    await expect(panel.$('.//div[@data-event-type="tool_started"][contains(., "architecture_assessment.py")]')).toBeDisplayed()
    await expect(panel.$('.//div[@data-event-type="tool_started"][contains(., "python3")]')).toBeDisplayed()
    await expect(panel.$('.//div[@data-event-type="tool_started"][contains(., "assess_architecture")]')).toBeDisplayed()
    await expect(panel.$('.//div[@data-event-type="tool_finished" and contains(@class, "completed")][contains(., "cloud-architect-agent")]')).toBeDisplayed()
    await $('button[title="Fermer le panneau"]').click()
  })

  it('détecte, compare, installe puis restaure une version de plugin agentique', async () => {
    await clickSidebar('Nouveau chat')
    const composer = $('textarea[placeholder="Sur quoi travailler ?"]')
    await composer.setValue(UPDATE_AGENTIC_PLUGIN_PROMPT)
    await $('button[aria-label="Envoyer le prompt"]').click()
    await expect($('p*=La version 1.3.0 du plugin Cloud Architect Agent est prête')).toBeDisplayed({ wait: 12_000 })

    await clickSidebar('Plugins')
    const pluginRow = $(`//div[contains(@class, "skill-list-row")][contains(., "${AGENTIC_PLUGIN}")]`)
    await pluginRow.waitForDisplayed({ timeout: 10_000 })
    await expect(pluginRow.$('span=Mise à jour')).toBeDisplayed()
    await pluginRow.$('button.skill-row-main').click()
    const detail = $(`aside[aria-label="Détails du plugin ${AGENTIC_PLUGIN}"]`)
    await expect(detail.$('strong=Version 1.3.0 disponible')).toBeDisplayed()
    await detail.$('button=Voir les changements').click()
    const changes = detail.$('.plugin-version-diff')
    await changes.waitForExist()
    await changes.scrollIntoView()
    expect(await changes.getText()).toContain('Ajout du contrôle de conformité et de nouvelles sources cloud.')
    expect(await changes.getText()).toContain('Nouvelles autorisations demandées : network.request')

    await detail.$('button=Mettre à jour').click()
    await expect(detail.$('small*=Version 1.3.0')).toBeDisplayed({ wait: 12_000 })
    await expect(detail.$('.//div[contains(@class, "plugin-version-row")][.//span[normalize-space()="Actuelle"]]//strong[normalize-space()="Version 1.3.0"]')).toBeDisplayed()

    await approveConfirmations()
    const previousVersion = detail.$('.//div[contains(@class, "plugin-version-row")][contains(., "Version 1.2.0")]')
    await previousVersion.$('button=Restaurer').click()
    await expect(detail.$('small*=Version 1.2.0')).toBeDisplayed({ wait: 12_000 })
    await expect(pluginRow.$('span=Mise à jour')).toBeDisplayed()
    await detail.$('strong=Version 1.3.0 disponible').waitForExist()
  })

  it('gère un skill séparément puis un serveur dans Intégrations et MCP', async () => {
    await clickSidebar('Skills')
    await expect($('strong=Skills')).toBeDisplayed()
    await expect($('button=Serveurs MCP')).not.toExist()

    await $('button=+ Nouveau skill').click()
    await $('input[placeholder="analyse-contrats"]').setValue(SKILL)
    await $('input[placeholder="Quand utiliser ce skill"]').setValue('Pour valider le parcours skill E2E.')
    await $('textarea[placeholder^="Décris étape par étape"]').setValue('Lire la demande, vérifier les entrées, produire une synthèse locale.')
    await $('button=Enregistrer').click()
    await expect($(`strong=${SKILL}`)).toBeDisplayed()

    const skillRow = $(`//div[contains(@class, "skill-list-row")][contains(., "${SKILL}")]`)
    await expect(skillRow).toBeDisplayed()
    await skillRow.$('input[type="checkbox"]').click()
    await expect(skillRow.$('input[type="checkbox"]')).not.toBeChecked()
    await skillRow.$('input[type="checkbox"]').click()
    await expect(skillRow.$('input[type="checkbox"]')).toBeChecked()
    await $('aside.skill-detail-panel').$('button=Modifier').click()
    await $('input[placeholder="Quand utiliser ce skill"]').setValue('Description skill E2E modifiée.')
    await $('button=Enregistrer').click()
    await expect($('p=Description skill E2E modifiée.')).toBeDisplayed()

    const modifiedSkill = $(`//div[contains(@class, "skill-list-row")][contains(., "${SKILL}")]`)
    await approveConfirmations()
    await $('aside.skill-detail-panel').$('button=Supprimer').click()
    await expect(modifiedSkill).not.toExist()

    await clickSidebar('Intégrations et MCP')
    await expect($('span=Intégrations et MCP')).toBeDisplayed()
    await $('button=Serveurs MCP').click()
    await $('input[placeholder="mon-serveur"]').setValue(MCP)
    await selectValue(await labelled('Transport', 'select'), 'stdio')
    await $('input[placeholder="/chemin/serveur"]').setValue('/usr/bin/true')
    await $('input[placeholder="--option valeur"]').setValue('--e2e local')
    await $('button=Ajouter avec Bob Shell').click()
    const serverCard = $(`//article[contains(@class, "extension-card")][contains(., "${MCP}")]`)
    await serverCard.waitForDisplayed({ timeout: 10_000 })
    await serverCard.$('input[type="checkbox"]').click()
    await expect(serverCard.$('input[type="checkbox"]')).not.toBeChecked()
    await serverCard.$('input[type="checkbox"]').click()
    await expect(serverCard.$('input[type="checkbox"]')).toBeChecked()
    await approveConfirmations()
    await serverCard.$('button=Supprimer').click()
    await expect(serverCard).not.toExist()
  })

  it('affiche les intégrations de base et leurs filtres sans écrire de secret réel', async () => {
    await clickSidebar('Intégrations et MCP')
    await expect($('span=Intégrations et MCP')).toBeDisplayed()
    await $('button=Intégrations').click()
    await expect($('div=Outlook')).toBeDisplayed()
    await expect($('div=Microsoft Teams')).toBeDisplayed()
    await expect($('div=Outlook Calendar')).toBeDisplayed()
    await expect($('div=OneDrive')).toBeDisplayed()
    await expect($('div=GitHub')).toBeDisplayed()
    await expect($('div=Slack')).toBeDisplayed()
    await expect($('div=Monday.com')).toBeDisplayed()
    await $('button=Dev & collab').click()
    await expect($('button=Connecter avec GitHub')).toBeDisplayed()
    await $('button=Microsoft 365').click()
    await expect($('button=Connecter avec Microsoft 365')).toBeDisplayed()
  })

  it('enregistre les instructions, permissions, limites, extensions, thème et langue', async () => {
    await $('span=Réglages').click()
    await expect($('h2=Réglages')).toBeDisplayed()

    const settingsSearch = $('input[aria-label="Rechercher dans les réglages"]')
    await settingsSearch.setValue('langue')
    await expect($('button=Apparence et langue')).toBeDisplayed()
    await expect($('button=IBM Bob Shell')).not.toExist()
    await expect($('h1=Apparence et langue')).toBeDisplayed()
    await settingsSearch.setValue('réglage totalement absent')
    await expect($('h1=Aucun réglage trouvé')).toBeDisplayed()
    await settingsSearch.setValue('')
    await expect($('button=IBM Bob Shell')).toBeDisplayed()

    await $('button=IBM Bob Shell').click()
    await expect($('button=Tester le Trousseau')).not.toExist()
    await expect($('button=Effacer du coffre')).toBeDisplayed({ wait: 30_000 })
    await $('button=Effacer du coffre').click()
    const sessionKey = $('input[placeholder*="Clé d’inférence IBM Bob"]')
    await sessionKey.setValue('e2e-session-secret')
    await $('button=Enregistrer dans le coffre').click()
    await expect($('button=Effacer du coffre')).toBeDisplayed({ wait: 30_000 })

    await clickSidebar('Nouveau chat')
    const sessionComposer = $('textarea[placeholder="Sur quoi travailler ?"]')
    await sessionComposer.setValue('SESSION_SECRET_E2E')
    await $('button[aria-label="Envoyer le prompt"]').click()
    await expect($('p*=Réponse Bob E2E terminée.')).toBeDisplayed()

    await $('span=Réglages').click()
    await $('button=IBM Bob Shell').click()
    await $('button=Effacer du coffre').click()
    await expect($('button=Enregistrer dans le coffre')).toBeDisplayed()

    await $('button=Instructions').click()
    await $('textarea[placeholder^="Ex. Répondre en français"]').setValue('Instruction globale E2E : répondre en français.')

    await $('button=Permissions').click()
    await selectValue(await labelled('Politique par défaut', 'select'), 'ask_for_modifications')

    await $('button=Tâches et planifié').click()
    await labelled('Nombre maximal de tours').setValue('7')
    await labelled('Conserver l’historique').setValue('45')

    await $('button=Accès et contrôle').click()
    const webToggle = labelled('Accès web')
    if (!(await webToggle.isSelected())) await webToggle.click()
    const subagentToggle = labelled('Sous-agents / orchestrateur')
    if (!(await subagentToggle.isSelected())) await subagentToggle.click()

    await $('button=Apparence et langue').click()
    await selectValue(await labelled('Thème', 'select'), 'dark')
    await selectValue(await labelled('Langue', 'select'), 'fr')
    await browser.pause(500)
    await expect($('div.settings-status=Réglages enregistrés.')).toBeDisplayed({ wait: 8_000 })
    await expect($('html')).toHaveElementClass('dark')

    await $('button=Instructions').click()
    await expect($('textarea[placeholder^="Ex. Répondre en français"]')).toHaveValue('Instruction globale E2E : répondre en français.')
  })
})
