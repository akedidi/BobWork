import http from 'node:http'

const token = 'bob-mobile-simulator'
const now = new Date().toISOString()
let project = {
  id: 'project-demo', name: 'Lancement Bob Mobile', description: 'Projet de validation du compagnon mobile.', objective: 'Contrôler Bob Work depuis iOS.', color: '#5B8CFF', localPath: '/Users/demo/BobMobile', customInstructions: 'Respecter les conventions Bob Work.', language: 'fr', memoryEnabled: true, defaultMode: 'agent', updatedAt: now,
  allowedPlugins: ['review', 'skill:documentation'], allowedIntegrations: ['github'], conversationCount: 18, activeTaskCount: 1,
}
const conversations = [
  { conversation: { id: 'conversation-active', projectId: project.id, title: 'Finaliser le MVP mobile', type: 'chat', bobMode: 'agent', date: now, summary: 'Bob vérifie le parcours iOS et les états de tâche.', pinned: true, archived: false }, taskState: 'running', scheduled: false },
  { conversation: { id: 'conversation-plan', projectId: project.id, title: 'Plan de publication', type: 'chat', bobMode: 'plan', date: now, summary: 'Préparation des étapes de distribution.', pinned: false, archived: false }, taskState: 'completed', scheduled: true },
  ...Array.from({ length: 16 }, (_, index) => ({
    conversation: {
      id: `conversation-history-${index + 1}`,
      projectId: project.id,
      title: `Conversation historique ${index + 1}`,
      type: 'chat',
      bobMode: index % 2 === 0 ? 'agent' : 'plan',
      date: new Date(Date.now() - (index + 1) * 3_600_000).toISOString(),
      summary: `Échange synchronisé ${index + 1} depuis Bob Work.`,
      pinned: false,
      archived: index === 15,
    },
    taskState: 'completed',
    scheduled: index === 2,
  })),
]
const tasks = [
  { id: 'task-running', objective: 'Valider Bob Mobile sur le simulateur iOS', projectId: project.id, conversationId: 'conversation-active', mode: 'agent', permissionPolicy: 'ask_for_important', progress: 62, state: 'running', resumable: false, shellTaskId: 'shell-task-demo', createdAt: now, updatedAt: now },
  { id: 'task-completed', objective: 'Compiler le bundle Expo', projectId: project.id, conversationId: 'conversation-plan', mode: 'plan', permissionPolicy: 'ask_for_important', summary: 'Bundle iOS généré.', progress: 100, state: 'completed', resumable: true, shellTaskId: 'shell-task-completed', createdAt: now, updatedAt: now },
]
let schedules = []
const scheduleRuns = new Map()
let approvals = [{ id: 'approval-demo', taskId: 'task-running', actionType: 'file.write', humanDescription: 'Bob souhaite enregistrer le schéma d’architecture dans le projet.', commandOrChange: 'write architecture.svg', filesAffected: ['architecture.svg'], networkDestination: null, riskLevel: 'medium', undoPossible: true, createdAt: now }]
let catalog = {
  plugins: [
    { id: 'builtin-review', name: 'Code review', description: 'Vérifie la qualité et la sécurité du code.', category: 'development', scope: 'personal', builtin: true, enabled: true, favorite: true, version: '1.2.0', availableVersion: null, lastUsedAt: now, validationState: 'valid', permissions: ['file.read'], capabilities: ['quality.review'], tools: ['read_file', 'search'], configuration: [], requiresMacConfiguration: false, canUpdate: false },
    { id: 'proposal-personal', name: 'Proposition client', description: 'Plugin personnel pour préparer des propositions.', category: 'business', scope: 'personal', builtin: false, enabled: false, favorite: false, version: '1.0.0', availableVersion: '1.1.0', lastUsedAt: null, validationState: 'valid', permissions: ['file.read', 'file.write', 'network.request'], capabilities: ['document.create'], tools: ['documents', 'web_search'], configuration: ['Compte Microsoft'], requiresMacConfiguration: true, canUpdate: true },
  ],
  skills: [
    { slug: 'documentation', name: 'Documentation', description: 'Rédige la documentation du projet.', scope: 'global-bob', enabled: true, builtin: true, favorite: false, updatedAt: now, icon: 'document' },
    { slug: 'customer-brief', name: 'Customer brief', description: 'Skill personnel de préparation client.', scope: 'global-bob', enabled: false, builtin: false, favorite: true, updatedAt: now, icon: '' },
  ],
  integrations: [
    { id: 'github', name: 'GitHub', connected: true, favorite: true, authMethod: 'oauth', accountLabel: 'demo@bob.work', expiresAt: null, oauthClientConfigured: true, deviceFlowAvailable: true, scopeSatisfied: true, permissions: ['repo', 'read:user'], requiresMacConfiguration: false },
    { id: 'slack', name: 'Slack', connected: false, favorite: false, authMethod: null, accountLabel: null, expiresAt: null, oauthClientConfigured: true, deviceFlowAvailable: false, scopeSatisfied: true, permissions: ['channels:read', 'search:read'], requiresMacConfiguration: true },
  ],
}
let artifacts = [
  { id: 'artifact-architecture-v2', type: 'svg', title: 'Architecture Cloud', fileName: 'architecture-v2.svg', mimeType: 'image/svg+xml', size: 714, inlinePreview: true, category: 'images', version: 2, validationStatus: 'valid', validationNotes: null, createdAt: now, project: { id: project.id, name: project.name }, conversation: { id: 'conversation-active', title: 'Finaliser le MVP mobile' }, versions: [{ id: 'artifact-architecture-v2', version: 2, validationStatus: 'valid', createdAt: now }, { id: 'artifact-architecture-v1', version: 1, validationStatus: 'warning', createdAt: now }] },
  { id: 'artifact-architecture-v1', type: 'svg', title: 'Architecture Cloud', fileName: 'architecture-v1.svg', mimeType: 'image/svg+xml', size: 680, inlinePreview: true, category: 'images', version: 1, validationStatus: 'warning', validationNotes: 'La légende doit être vérifiée.', createdAt: now, project: { id: project.id, name: project.name }, conversation: { id: 'conversation-active', title: 'Finaliser le MVP mobile' }, versions: [{ id: 'artifact-architecture-v2', version: 2, validationStatus: 'valid', createdAt: now }, { id: 'artifact-architecture-v1', version: 1, validationStatus: 'warning', createdAt: now }] },
  { id: 'artifact-document', type: 'pdf', title: 'Dossier d’architecture', fileName: 'dossier-architecture.pdf', mimeType: 'application/pdf', size: 245760, inlinePreview: false, category: 'pdf', version: 1, validationStatus: 'valid', validationNotes: null, createdAt: now, project: { id: project.id, name: project.name }, conversation: { id: 'conversation-active', title: 'Finaliser le MVP mobile' }, versions: [{ id: 'artifact-document', version: 1, validationStatus: 'valid', createdAt: now }] },
  { id: 'artifact-roadmap', type: 'docx', title: 'Roadmap de livraison', fileName: 'roadmap.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 18432, inlinePreview: false, category: 'word', version: 3, validationStatus: 'pending', validationNotes: null, createdAt: now, project: { id: project.id, name: project.name }, conversation: { id: 'conversation-plan', title: 'Plan de publication' }, versions: [{ id: 'artifact-roadmap', version: 3, validationStatus: 'pending', createdAt: now }] },
  { id: 'artifact-budget', type: 'xlsx', title: 'Budget prévisionnel', fileName: 'budget.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 32184, inlinePreview: false, category: 'excel', version: 1, validationStatus: 'invalid', validationNotes: 'Une formule comporte une référence circulaire.', createdAt: now, project: { id: project.id, name: project.name }, conversation: null, versions: [{ id: 'artifact-budget', version: 1, validationStatus: 'invalid', createdAt: now }] },
]
const mapToolResult = {
  name: 'map_route',
  structuredContent: {
    schemaVersion: 1,
    kind: 'bob-map',
    title: 'Itinéraire Tour Eiffel → Musée du Louvre',
    markers: [
      { id: 'eiffel', label: 'Tour Eiffel', lat: 48.85837, lon: 2.294481, kind: 'origin' },
      { id: 'orsay', label: 'Musée d’Orsay', lat: 48.859961, lon: 2.326561, kind: 'place' },
      { id: 'louvre', label: 'Musée du Louvre', lat: 48.860611, lon: 2.337644, kind: 'destination' },
    ],
    route: {
      coordinates: [
        { lat: 48.85837, lon: 2.294481 },
        { lat: 48.86102, lon: 2.30918 },
        { lat: 48.859961, lon: 2.326561 },
        { lat: 48.860611, lon: 2.337644 },
      ],
      distanceMeters: 3800,
      durationSeconds: 2940,
      mode: 'walking',
    },
    attribution: '© OpenStreetMap contributors',
  },
}

const messages = Array.from({ length: 18 }, (_, index) => ({
  id: `message-${index + 1}`, conversationId: 'conversation-active', author: index % 2 === 0 ? 'user' : 'assistant', content: index === 3 ? '## Résultat\n\n- Accents : **é, è, à, ç, œ**\n- Symboles : → ✓ ± €\n\n| Élément | État |\n| --- | --- |\n| Synchronisation | ✅ Active |\n| Contrôle distant | ✅ Sécurisé |\n\n```ts\nconst bob = "prêt";\n```' : index === 1 ? 'Voici l’itinéraire et trois points d’intérêt.' : index % 2 === 0 ? `Échange utilisateur ${index + 1}` : `Réponse Bob ${index + 1}`, attachments: [], artifacts: index === 3 ? [
    { id: 'artifact-architecture-v2', type: 'svg', title: 'Architecture Cloud', fileName: 'architecture-v2.svg', mimeType: 'image/svg+xml', size: 714, inlinePreview: true },
    { id: 'artifact-document', type: 'pdf', title: 'Dossier d’architecture', fileName: 'dossier-architecture.pdf', mimeType: 'application/pdf', size: 245760, inlinePreview: false },
  ] : [], toolsUsed: index === 1 ? [mapToolResult] : [], createdAt: new Date(Date.now() - index * 60_000).toISOString(),
}))

const architectureSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 360"><rect width="760" height="360" fill="#f8fafc"/><g font-family="Arial" text-anchor="middle"><rect x="35" y="125" width="150" height="90" rx="18" fill="#dbeafe" stroke="#2563eb" stroke-width="3"/><text x="110" y="177" font-size="24" fill="#1e3a8a">iPhone</text><rect x="305" y="55" width="150" height="90" rx="18" fill="#ede9fe" stroke="#7c3aed" stroke-width="3"/><text x="380" y="107" font-size="22" fill="#4c1d95">Cloudflare</text><rect x="575" y="125" width="150" height="90" rx="18" fill="#dcfce7" stroke="#16a34a" stroke-width="3"/><text x="650" y="177" font-size="22" fill="#14532d">Bob Work</text><rect x="305" y="235" width="150" height="80" rx="18" fill="#fef3c7" stroke="#d97706" stroke-width="3"/><text x="380" y="283" font-size="22" fill="#78350f">SQLite</text><path d="M185 170H305M455 100L575 150M650 215L455 260" fill="none" stroke="#64748b" stroke-width="5" marker-end="url(#a)"/><defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#64748b"/></marker></defs></g></svg>`

function makeDemoPdf() {
  const stream = 'BT /F1 24 Tf 72 730 Td (Bob Mobile - Architecture) Tj 0 -42 Td /F1 13 Tf (Apercu PDF securise depuis Bob Work.) Tj ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let value = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(value)); value += `${index + 1} 0 obj\n${object}\nendobj\n` })
  const xref = Buffer.byteLength(value)
  value += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  value += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  value += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(value)
}
const demoPdf = makeDemoPdf()

function json(response, status, body) {
  response.writeHead(status, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Content-Type': 'application/json' })
  response.end(JSON.stringify(body))
}

function sse(response, type, payload) {
  response.write(`data: ${JSON.stringify({ type, payload, sentAt: new Date().toISOString() })}\n\n`)
}

function requestBody(request) {
  return new Promise(resolve => {
    let value = ''
    request.on('data', chunk => { value += chunk })
    request.on('end', () => { try { resolve(value ? JSON.parse(value) : {}) } catch { resolve({}) } })
  })
}

http.createServer(async (request, response) => {
  if (request.method === 'OPTIONS') return json(response, 200, {})
  if (request.headers.authorization !== `Bearer ${token}`) return json(response, 401, { error: 'Invalid test token' })
  const url = new URL(request.url ?? '/', 'http://localhost')
  if (url.pathname === '/api/v1/health') return json(response, 200, { status: 'ok', apiVersion: '1', bobAvailable: true })
  if (url.pathname === '/api/v1/bootstrap') return json(response, 200, { apiVersion: '1', bobAvailable: true, settings: { theme: 'dark', language: 'fr', defaultMode: 'agent', permissionPolicy: 'ask_for_important', sandboxMode: false, mcpEnabled: true, subagentsEnabled: true, webEnabled: true } })
  if (url.pathname === '/api/v1/events') {
    response.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    sse(response, 'connected', { apiVersion: '1' })
    const activity = setTimeout(() => sse(response, 'bob-activity', { sessionId: 'session-demo', conversationId: 'conversation-active', taskId: 'task-running', eventType: 'tool_started', title: 'Génération du schéma', content: 'Préparation du rendu SVG sécurisé.', toolName: 'architecture_renderer' }), 450)
    const tokenTimer = setTimeout(() => sse(response, 'bob-token', { sessionId: 'session-demo', conversationId: 'conversation-active', taskId: 'task-running', eventType: 'text', chunk: 'Le schéma est en cours de finalisation…', isFinal: false }), 900)
    const keepAlive = setInterval(() => response.write(': keep-alive\n\n'), 10_000)
    request.on('close', () => { clearTimeout(activity); clearTimeout(tokenTimer); clearInterval(keepAlive) })
    return
  }
  if (url.pathname === '/api/v1/sync') return json(response, 200, { syncedAt: new Date().toISOString(), projects: project ? [project] : [], conversations: conversations.filter(item => !item.conversation.archived), tasks })
  if (url.pathname === '/api/v1/projects') {
    if (request.method === 'POST') {
      const input = await requestBody(request)
      project = { ...project, ...input, id: project?.id ?? 'project-demo', updatedAt: new Date().toISOString(), allowedPlugins: [...(input.pluginIds ?? []), ...(input.skillSlugs ?? []).map(slug => `skill:${slug}`)], allowedIntegrations: input.integrationIds ?? [] }
      return json(response, 200, { project })
    }
    return json(response, 200, { projects: project ? [project] : [] })
  }
  const projectMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)$/)
  if (projectMatch) {
    if (!project || project.id !== projectMatch[1]) return json(response, 404, { error: 'Projet introuvable' })
    if (request.method === 'DELETE') { project = null; return json(response, 200, { deleted: true, projectId: projectMatch[1] }) }
    if (request.method === 'PATCH') {
      const input = await requestBody(request)
      const allowedPlugins = input.pluginIds || input.skillSlugs ? [...(input.pluginIds ?? project.allowedPlugins.filter(value => !value.startsWith('skill:'))), ...(input.skillSlugs ?? project.allowedPlugins.filter(value => value.startsWith('skill:')).map(value => value.slice(6))).map(slug => `skill:${slug}`)] : project.allowedPlugins
      project = { ...project, ...input, allowedPlugins, allowedIntegrations: input.integrationIds ?? project.allowedIntegrations, updatedAt: new Date().toISOString() }
      return json(response, 200, { project })
    }
  }
  if (url.pathname === '/api/v1/search') {
    const query = (url.searchParams.get('q') ?? '').toLowerCase()
    return json(response, 200, { conversations: conversations.filter(item => !item.conversation.archived && `${item.conversation.title} ${item.conversation.summary}`.toLowerCase().includes(query)).map(item => ({ ...item, matchSnippet: `Résultat dans les messages : ${query}` })) })
  }
  if (url.pathname === '/api/v1/conversations') {
    if (request.method === 'POST') return json(response, 200, { conversation: conversations[0].conversation })
    const archived = url.searchParams.get('archived') === 'true'
    return json(response, 200, { conversations: conversations.filter(item => Boolean(item.conversation.archived) === archived) })
  }
  const conversationMatch = url.pathname.match(/^\/api\/v1\/conversations\/([^/]+)$/)
  if (conversationMatch) {
    const index = conversations.findIndex(item => item.conversation.id === conversationMatch[1])
    if (index < 0) return json(response, 404, { error: 'Conversation introuvable' })
    if (request.method === 'DELETE') { conversations.splice(index, 1); return json(response, 200, { deleted: true, conversationId: conversationMatch[1] }) }
    if (request.method === 'PATCH') {
      const input = await requestBody(request)
      conversations[index].conversation = { ...conversations[index].conversation, ...input, projectId: input.projectId === '' ? null : input.projectId ?? conversations[index].conversation.projectId }
      return json(response, 200, { conversation: conversations[index].conversation })
    }
  }
  if (url.pathname === '/api/v1/tasks') return json(response, 200, { tasks })
  const taskMatch = url.pathname.match(/^\/api\/v1\/tasks\/([^/]+)$/)
  if (taskMatch) {
    const task = tasks.find(item => item.id === taskMatch[1])
    if (!task) return json(response, 404, { error: 'Tâche introuvable' })
    if (request.method === 'PATCH') { const input = await requestBody(request); task.pinned = Boolean(input.pinned); return json(response, 200, { task }) }
    return json(response, 200, { task, runs: [], events: [{ id: 'event-start', taskId: task.id, sequence: 1, type: 'task_started', title: 'Tâche démarrée', content: 'Validation du parcours mobile', createdAt: now }], inputs: [], outputs: [] })
  }
  if (url.pathname === '/api/v1/tasks/task-running/cancel' && request.method === 'POST') { tasks[0].state = 'cancelled'; return json(response, 200, { taskId: 'task-running', state: 'cancelled' }) }
  if (/\/api\/v1\/tasks\/[^/]+\/(retry|reply)/.test(url.pathname) && request.method === 'POST') return json(response, 200, { session: { sessionId: 'session-retry', taskId: 'task-running', userMessageId: 'message-retry', awaitingApproval: false } })
  if (url.pathname === '/api/v1/schedules') {
    if (request.method === 'POST') { const input = await requestBody(request); const schedule = { ...input, id: `schedule-${Date.now()}`, timezone: input.timezone ?? 'Europe/Paris', nextRun: new Date(Date.now() + 86400000).toISOString(), lastRun: null, offlineBehavior: input.offlineBehavior ?? 'run_on_wake', overlapPolicy: input.overlapPolicy ?? 'queue', state: 'active', createdAt: now, updatedAt: now }; schedules.unshift(schedule); scheduleRuns.set(schedule.id, []); return json(response, 200, { schedule }) }
    return json(response, 200, { schedules })
  }
  const scheduleMatch = url.pathname.match(/^\/api\/v1\/schedules\/([^/]+)(?:\/(state|run|runs))?$/)
  if (scheduleMatch) {
    const schedule = schedules.find(item => item.id === scheduleMatch[1])
    if (!schedule) return json(response, 404, { error: 'Planification introuvable' })
    if (scheduleMatch[2] === 'state') { const input = await requestBody(request); schedule.state = input.state; return json(response, 200, { schedule }) }
    if (scheduleMatch[2] === 'runs') return json(response, 200, { runs: scheduleRuns.get(schedule.id) ?? [] })
    if (scheduleMatch[2] === 'run') { const run = { id: `run-${Date.now()}`, scheduleId: schedule.id, taskId: 'task-running', scheduledFor: new Date().toISOString(), state: 'running', createdAt: new Date().toISOString() }; scheduleRuns.get(schedule.id)?.unshift(run); schedule.lastRun = run.scheduledFor; return json(response, 200, { taskId: 'task-running' }) }
    if (request.method === 'DELETE') { schedules = schedules.filter(item => item.id !== schedule.id); return json(response, 200, { deleted: true }) }
  }
  if (url.pathname === '/api/v1/approvals') return json(response, 200, { approvals })
  if (url.pathname === '/api/v1/approvals/approval-demo/resolve' && request.method === 'POST') { approvals = []; return json(response, 200, { approvalId: 'approval-demo', decision: 'approved' }) }
  if (url.pathname === '/api/v1/catalog') return json(response, 200, catalog)
  const pluginMatch = url.pathname.match(/^\/api\/v1\/plugins\/([^/]+)(?:\/(update))?$/)
  if (pluginMatch) {
    const plugin = catalog.plugins.find(item => item.id === pluginMatch[1])
    if (!plugin) return json(response, 404, { error: 'Plugin introuvable' })
    if (pluginMatch[2] === 'update' && request.method === 'POST') { if (plugin.availableVersion) plugin.version = plugin.availableVersion; plugin.availableVersion = null; plugin.canUpdate = false; return json(response, 200, { plugin }) }
    const input = await requestBody(request); Object.assign(plugin, input); return json(response, 200, { plugin })
  }
  const skillMatch = url.pathname.match(/^\/api\/v1\/skills\/([^/]+)$/)
  if (skillMatch) { const skill = catalog.skills.find(item => item.slug === skillMatch[1]); if (!skill) return json(response, 404, { error: 'Skill introuvable' }); const input = await requestBody(request); Object.assign(skill, input); return json(response, 200, { skill }) }
  const integrationMatch = url.pathname.match(/^\/api\/v1\/integrations\/([^/]+)$/)
  if (integrationMatch) { const integration = catalog.integrations.find(item => item.id === integrationMatch[1]); if (!integration) return json(response, 404, { error: 'Intégration introuvable' }); const input = await requestBody(request); integration.favorite = Boolean(input.favorite); return json(response, 200, { updated: true, integrationId: integration.id }) }
  if (url.pathname === '/api/v1/modes') return json(response, 200, { modes: [{ id: 'agent', name: 'Agent' }, { id: 'plan', name: 'Plan' }, { id: 'ask', name: 'Ask' }] })
  if (url.pathname === '/api/v1/slash-commands') return json(response, 200, { commands: [
    { name: 'help', description: 'Afficher les commandes Bob disponibles', source: 'bob', altNames: ['?'] },
    { name: 'clear', description: 'Effacer le contexte de la conversation', source: 'bob', altNames: ['reset'] },
    { name: 'compact', description: 'Compacter le contexte actuel', source: 'bob', altNames: [] },
  ] })
  if (url.pathname === '/api/v1/artifacts') {
    const query = (url.searchParams.get('q') ?? '').toLocaleLowerCase()
    const category = url.searchParams.get('category')
    const offset = Number(url.searchParams.get('cursor') ?? 0)
    const limit = Number(url.searchParams.get('limit') ?? 40)
    const projectId = url.searchParams.get('projectId')
    const filtered = artifacts.filter(artifact => artifact.id !== 'artifact-architecture-v1' && (!projectId || artifact.project?.id === projectId) && (!category || artifact.category === category) && (!query || `${artifact.title} ${artifact.fileName} ${artifact.project?.name ?? ''} ${artifact.conversation?.title ?? ''}`.toLocaleLowerCase().includes(query)))
    const page = filtered.slice(offset, offset + limit)
    return json(response, 200, { artifacts: page, nextCursor: offset + limit < filtered.length ? String(offset + limit) : null, hasMore: offset + limit < filtered.length, total: filtered.length })
  }
  const artifactMatch = url.pathname.match(/^\/api\/v1\/artifacts\/([^/]+)$/)
  if (artifactMatch) {
    const artifact = artifacts.find(item => item.id === artifactMatch[1])
    if (!artifact) return json(response, 404, { error: 'Artefact introuvable' })
    if (request.method === 'DELETE') { artifacts = artifacts.filter(item => item.id !== artifact.id); return json(response, 200, { deleted: true, artifactId: artifact.id }) }
    return json(response, 200, artifact)
  }
  if (/\/api\/v1\/artifacts\/artifact-architecture-v[12]\/content/.test(url.pathname)) {
    response.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'image/svg+xml', 'Cache-Control': 'private, no-store' })
    return response.end(architectureSvg)
  }
  if (url.pathname === '/api/v1/artifacts/artifact-document/content') {
    response.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/pdf', 'Content-Length': demoPdf.length, 'Cache-Control': 'private, no-store' })
    return response.end(demoPdf)
  }
  if (/\/api\/v1\/conversations\/[^/]+\/messages/.test(url.pathname)) {
    if (request.method === 'POST') return json(response, 200, { session: { sessionId: 'session-demo', taskId: 'task-running', userMessageId: 'message-new' } })
    const cursor = url.searchParams.get('cursor')
    const start = cursor ? Math.max(0, messages.findIndex(message => message.id === cursor) + 1) : 0
    const page = messages.slice(start, start + 8)
    const hasMore = start + 8 < messages.length
    return json(response, 200, { messages: page, nextCursor: hasMore ? page.at(-1)?.id : null, hasMore, taskState: 'running' })
  }
  return json(response, 404, { error: 'Not found' })
}).listen(8099, '0.0.0.0', () => console.log('Bob Mobile mock API: http://0.0.0.0:8099'))
