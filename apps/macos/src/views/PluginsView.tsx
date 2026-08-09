import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { comparePluginVersion, createPlugin, deletePlugin, getPluginExtensionStatus, getPluginMcpStatus, getPlugins, getPluginVersions, installPluginUpdate, rollbackPluginVersion, togglePlugin, updatePlugin } from '../lib/ipc'
import { errorMessage } from '../lib/errorMessage'
import { PluginIcon, resolvePluginIcon } from '../components/PluginIcon'
import type { Plugin, PluginCategory, PluginExtensionStatus, PluginMcpStatus, PluginScheduleTemplate, PluginVersion, PluginVersionDiff } from '@bob-work/shared-types'

type PluginFilter = 'all' | 'enabled' | 'disabled'
type Form = { name: string; description: string; instructions: string; category: PluginCategory }
type PluginMetadata = {
  builtin?: boolean
  icon?: string
  slug?: string
  requiresIntegration?: string
  agentic?: boolean
  instructions?: string
  content?: string
  capabilities?: string[]
  permissions?: Array<{ type?: string; description?: string }>
  mcpServers?: Record<string, unknown>
  integrations?: unknown[]
  browserExtensions?: unknown[]
  hooks?: unknown[]
  scheduledTaskTemplates?: unknown[]
  releaseNotes?: string
}

const EMPTY: Form = { name: '', description: '', instructions: '', category: 'recipe' }

const permissionLabel = (permission: { type?: string; description?: string }) => ({
  'file.read': 'Lire les fichiers que vous avez autorisés',
  'file.write': 'Créer et modifier des fichiers dans les emplacements autorisés',
  'file.delete': 'Demander votre accord avant de supprimer un fichier',
  'network.request': 'Accéder au service connecté lorsque vous l’autorisez',
  'command.execute': 'Demander votre accord avant d’exécuter une action locale',
  'mcp.connect': 'Utiliser les outils connectés fournis par ce plugin',
  'hook.execute': 'Exécuter les actions automatiques déclarées par ce plugin',
  'browser.control': 'Utiliser le navigateur uniquement avec votre autorisation',
}[permission.type ?? ''] ?? permission.description ?? 'Utiliser une autorisation déclarée par ce plugin')

const capabilityLabel = (capability: string) => {
  const [kind, action] = capability.split('.')
  const object = ({ document: 'des documents', docx: 'des documents Word', pptx: 'des présentations PowerPoint', xlsx: 'des classeurs Excel', onenote: 'des pages OneNote', formula: 'les formules', preview: 'les fichiers' } as Record<string, string>)[kind] ?? kind
  const verb = ({ read: 'Lire', create: 'Créer', edit: 'Modifier', convert: 'Convertir', write: 'Publier', prepare: 'Préparer', verify: 'Vérifier' } as Record<string, string>)[action] ?? (kind === 'preview' ? 'Prévisualiser' : 'Utiliser')
  return `${verb} ${object}`
}

const metadataOf = (plugin: Plugin) => plugin.manifest as unknown as PluginMetadata
const isEnabled = (plugin: Plugin) => plugin.installState === 'installed'
const nextPatchVersion = (version: string) => {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
  return match ? `${match[1]}.${match[2]}.${Number(match[3]) + 1}` : '1.0.1'
}

export default function PluginsView() {
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<PluginFilter>('all')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [mcpRevision, setMcpRevision] = useState(0)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Plugin | null>(null)
  const [form, setForm] = useState<Form>(EMPTY)
  const [status, setStatus] = useState('')
  const navigate = useNavigate()

  const load = async () => {
    const next = await getPlugins()
    setPlugins(next)
    setLoading(false)
    return next
  }
  useEffect(() => { void load().catch(() => setLoading(false)) }, [])

  const selected = plugins.find(plugin => plugin.id === selectedId) ?? null
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    return plugins.filter(plugin => {
      if (filter === 'enabled' && !isEnabled(plugin)) return false
      if (filter === 'disabled' && isEnabled(plugin)) return false
      if (!query) return true
      return `${plugin.name} ${plugin.description}`.toLocaleLowerCase().includes(query)
    })
  }, [filter, plugins, search])

  const openEditor = (plugin?: Plugin) => {
    setEditing(plugin ?? null)
    setFormOpen(true)
    setStatus('')
    if (!plugin) { setForm(EMPTY); return }
    const manifest = metadataOf(plugin)
    setForm({
      name: plugin.name,
      description: plugin.description ?? '',
      instructions: manifest.instructions ?? manifest.content ?? '',
      category: plugin.category,
    })
  }

  const save = async () => {
    const version = editing ? nextPatchVersion(editing.version) : '1.0.0'
    const existing = editing ? metadataOf(editing) : null
    const manifest = {
      ...(editing?.manifest as unknown as Record<string, unknown> | undefined),
      name: form.name,
      slug: existing?.slug ?? form.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      version,
      description: form.description,
      category: form.category,
      instructions: form.instructions,
      permissions: existing?.permissions ?? [],
      capabilities: existing?.capabilities ?? ['prompt'],
      ...(editing ? { releaseNotes: `Instructions mises à jour depuis la version ${editing.version}.` } : {}),
    }
    const input = { name: form.name, version, description: form.description, scope: 'personal', category: form.category, manifest }
    try {
      if (editing) await updatePlugin(editing.id, input); else await createPlugin(input)
      setFormOpen(false); setEditing(null); setForm(EMPTY)
      const next = await load()
      const saved = next.find(plugin => plugin.name === form.name)
      if (saved) setSelectedId(saved.id)
      setStatus('Plugin enregistré et disponible pour Bob.')
    } catch (error) { setStatus(errorMessage(error)) }
  }

  const changeEnabled = async (plugin: Plugin, enabled: boolean) => {
    setTogglingId(plugin.id)
    setStatus('')
    setPlugins(current => current.map(item => item.id === plugin.id ? { ...item, installState: enabled ? 'installed' : 'disabled' } : item))
    try {
      await togglePlugin(plugin.id, enabled)
      setStatus(`${plugin.name} est maintenant ${enabled ? 'activé' : 'désactivé'}.`)
      setMcpRevision(value => value + 1)
    } catch (error) {
      setPlugins(current => current.map(item => item.id === plugin.id ? plugin : item))
      setStatus(errorMessage(error))
    } finally { setTogglingId(null) }
  }

  const removePlugin = async (plugin: Plugin) => {
    if (!confirm(`Supprimer « ${plugin.name} » ? Une copie de sauvegarde sera conservée.`)) return
    await deletePlugin(plugin.id)
    setSelectedId(null)
    await load()
  }

  return <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
    <div className="topbar titlebar-drag">
      <strong className="titlebar-no-drag">Plugins</strong>
      <div className="titlebar-no-drag" style={{ marginLeft: 'auto', display: 'flex', gap: 7 }}>
        <button className="secondary-btn" onClick={() => navigate('/chat', { state: { initialPrompt: 'Crée avec moi un plugin agentique Bob Work. Demande-moi son objectif, ses déclencheurs, ses entrées, ses sorties et les autorisations nécessaires. Après ma validation, crée le plugin complet et vérifie-le localement.', mode: 'plugin_builder' } })}>Créer avec Bob</button>
        <button className="btn-primary" onClick={() => openEditor()}>+ Nouveau plugin</button>
      </div>
    </div>

    <div className="extensions-content">
      <div className={`skills-workspace ${selected ? 'has-panel' : ''}`}>
        <section className="skills-browser">
          <div className="skills-toolbar">
            <div><h2>Vos plugins</h2><small>{plugins.filter(isEnabled).length} activés sur {plugins.length}</small></div>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['all', 'enabled', 'disabled'] as const).map(value => <button className={`filter-pill ${filter === value ? 'active' : ''}`} key={value} onClick={() => setFilter(value)}>{value === 'all' ? 'Tous' : value === 'enabled' ? 'Activés' : 'Désactivés'}</button>)}
            </div>
          </div>
          <div className="skill-search-wrap"><span aria-hidden="true">⌕</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Rechercher un plugin" aria-label="Rechercher un plugin" /></div>
          <p className="skills-help">Activez uniquement les plugins que Bob peut utiliser. Cliquez sur un plugin pour voir ce qu’il peut faire et les autorisations demandées.</p>
          <div className="skills-list">
            {loading ? <Empty text="Chargement…" /> : visible.length === 0 ? <Empty text={plugins.length ? 'Aucun résultat.' : 'Aucun plugin.'} /> : visible.map(plugin => {
              const manifest = metadataOf(plugin)
              const enabled = isEnabled(plugin)
              return <div className={`skill-list-row ${selectedId === plugin.id ? 'selected' : ''} ${enabled ? '' : 'disabled'}`} key={plugin.id}>
                <button className="skill-row-main" onClick={() => setSelectedId(plugin.id)}>
                  <PluginIcon icon={resolvePluginIcon(plugin)} size="md" className="skill-row-icon" />
                  <span className="skill-row-copy"><strong>{plugin.name}</strong><small>{plugin.description || 'Aucune description'}</small></span>
                  {plugin.availableVersion && <span className="plugin-update-badge">Mise à jour</span>}
                  <span className="skill-scope-badge">{manifest.builtin ? 'Intégré' : 'Personnel'}</span>
                </button>
                <label className="skill-switch" title={enabled ? 'Désactiver' : 'Activer'}>
                  <input type="checkbox" checked={enabled} disabled={togglingId === plugin.id} aria-label={`${enabled ? 'Désactiver' : 'Activer'} le plugin ${plugin.name}`} onChange={event => void changeEnabled(plugin, event.target.checked)} />
                  <span aria-hidden="true" />
                </label>
              </div>
            })}
          </div>
        </section>

        {selected && <PluginDetail plugin={selected} mcpRevision={mcpRevision} toggling={togglingId === selected.id} onClose={() => setSelectedId(null)} onToggle={enabled => void changeEnabled(selected, enabled)} onEdit={() => openEditor(selected)} onDelete={() => void removePlugin(selected)} onOpenIntegrations={() => navigate('/integrations')} onUseSchedule={template => navigate('/schedules', { state: { pluginTemplate: { ...template, pluginId: selected.id, pluginName: selected.name } } })} onVersionChanged={async message => { await load(); setMcpRevision(value => value + 1); setStatus(message) }} />}
      </div>
    </div>

    {formOpen && <div className="modal-overlay" onMouseDown={() => setFormOpen(false)}><div className="plugin-editor-modal" onMouseDown={event => event.stopPropagation()}>
      <h2>{editing ? 'Modifier le plugin' : 'Nouveau plugin'}</h2>
      <p className="settings-note">Décrivez simplement ce que Bob doit savoir faire. Les détails techniques sont gérés automatiquement.</p>
      <label>Nom<input value={form.name} onChange={event => setForm(value => ({ ...value, name: event.target.value }))} placeholder="Ex : Assistant contrats" /></label>
      <label>Description<input value={form.description} onChange={event => setForm(value => ({ ...value, description: event.target.value }))} placeholder="Quand et pourquoi utiliser ce plugin" /></label>
      <label>Instructions<textarea rows={12} value={form.instructions} onChange={event => setForm(value => ({ ...value, instructions: event.target.value }))} placeholder="Expliquez ce que Bob doit faire, les vérifications attendues et les limites à respecter…" /></label>
      <div className="settings-actions"><button className="secondary-btn" onClick={() => setFormOpen(false)}>Annuler</button><button className="btn-primary" disabled={!form.name || !form.description || !form.instructions} onClick={save}>Enregistrer</button></div>
    </div></div>}
    {status && <div className="settings-status">{status}</div>}
  </div>
}

function PluginDetail({ plugin, mcpRevision, toggling, onClose, onToggle, onEdit, onDelete, onOpenIntegrations, onUseSchedule, onVersionChanged }: {
  plugin: Plugin
  mcpRevision: number
  toggling: boolean
  onClose: () => void
  onToggle: (enabled: boolean) => void
  onEdit: () => void
  onDelete: () => void
  onOpenIntegrations: () => void
  onUseSchedule: (template: PluginScheduleTemplate) => void
  onVersionChanged: (message: string) => Promise<void>
}) {
  const manifest = metadataOf(plugin)
  const enabled = isEnabled(plugin)
  const capabilities = manifest.capabilities?.filter(value => value !== 'prompt').map(capabilityLabel) ?? []
  const permissions = manifest.permissions?.map(permissionLabel) ?? []
  return <aside className="skill-detail-panel" aria-label={`Détails du plugin ${plugin.name}`}>
    <div className="skill-panel-heading">
      <div className="skill-detail-title"><PluginIcon icon={resolvePluginIcon(plugin)} size="lg" className="skill-row-icon" /><div><h2>{plugin.name}</h2><small>{manifest.builtin ? 'Plugin intégré' : 'Plugin personnel'} · Version {plugin.version}</small></div></div>
      <button className="icon-btn" aria-label="Fermer les détails" onClick={onClose}>×</button>
    </div>
    <div className="skill-detail-status">
      <div><strong>{enabled ? 'Activé' : 'Désactivé'}</strong><small>{enabled ? 'Bob peut utiliser ce plugin.' : 'Bob n’utilisera pas ce plugin.'}</small></div>
      <label className="skill-switch"><input type="checkbox" checked={enabled} disabled={toggling} aria-label={`${enabled ? 'Désactiver' : 'Activer'} le plugin ${plugin.name}`} onChange={event => onToggle(event.target.checked)} /><span aria-hidden="true" /></label>
    </div>
    <section className="skill-detail-section"><h3>Description</h3><p>{plugin.description || 'Aucune description.'}</p></section>
    <section className="skill-detail-section"><h3>Ce plugin peut faire</h3>{capabilities.length ? <ul className="plugin-friendly-list">{capabilities.map(value => <li key={value}>{value}</li>)}</ul> : <p>Aider Bob à réaliser les demandes correspondant à sa description.</p>}</section>
    {manifest.mcpServers && <PluginMcpSection key={`${plugin.id}-${plugin.installState}-${mcpRevision}`} plugin={plugin} onOpenIntegrations={onOpenIntegrations} />}
    {(manifest.integrations || manifest.browserExtensions || manifest.hooks || manifest.scheduledTaskTemplates) && <PluginExtensionsSection key={`extensions-${plugin.id}-${plugin.installState}-${mcpRevision}`} plugin={plugin} onOpenIntegrations={onOpenIntegrations} onUseSchedule={onUseSchedule} />}
    <section className="skill-detail-section"><h3>Autorisations</h3>{permissions.length ? <ul className="plugin-friendly-list">{permissions.map(value => <li key={value}>{value}</li>)}</ul> : <p>Aucune autorisation supplémentaire.</p>}</section>
    <PluginVersionsSection plugin={plugin} onVersionChanged={onVersionChanged} />
    {manifest.requiresIntegration && <section className="skill-detail-section"><h3>Connexion</h3><p>Ce plugin nécessite un compte ou un service connecté.</p><button className="link-btn" onClick={onOpenIntegrations}>Gérer les connexions</button></section>}
    {!manifest.builtin && <div className="skill-panel-actions"><button className="secondary-btn" onClick={onEdit}>Modifier</button><button className="danger-link" onClick={onDelete}>Supprimer</button></div>}
  </aside>
}

function PluginVersionsSection({ plugin, onVersionChanged }: { plugin: Plugin; onVersionChanged: (message: string) => Promise<void> }) {
  const [versions, setVersions] = useState<PluginVersion[]>([])
  const [diff, setDiff] = useState<PluginVersionDiff | null>(null)
  const [busyVersion, setBusyVersion] = useState<string | null>(null)
  const [error, setError] = useState('')

  const loadVersions = async () => setVersions(await getPluginVersions(plugin.id))
  useEffect(() => {
    setDiff(null)
    setError('')
    void loadVersions().catch(error => setError(errorMessage(error)))
  }, [plugin.id, plugin.version, plugin.availableVersion])

  const inspect = async (version: string) => {
    setError('')
    try { setDiff(await comparePluginVersion(plugin.id, version)) } catch (error) { setError(errorMessage(error)) }
  }
  const change = async (version: string, update: boolean) => {
    if (!update && !confirm(`Restaurer la version ${version} de « ${plugin.name} » ? Vos connexions et l’état activé/désactivé seront conservés.`)) return
    setBusyVersion(version)
    setError('')
    try {
      if (update) await installPluginUpdate(plugin.id, version)
      else await rollbackPluginVersion(plugin.id, version)
      await onVersionChanged(update ? `${plugin.name} a été mis à jour vers la version ${version}.` : `${plugin.name} utilise de nouveau la version ${version}.`)
      setDiff(null)
      await loadVersions()
    } catch (error) { setError(errorMessage(error)) } finally { setBusyVersion(null) }
  }

  const available = versions.find(version => version.state === 'available')
  return <section className="skill-detail-section plugin-versions" aria-label="Versions du plugin">
    <h3>Versions</h3>
    {available && <div className="plugin-update-card">
      <div><strong>Version {available.version} disponible</strong><small>{available.releaseNotes || 'Une nouvelle version locale a été détectée.'}</small></div>
      <div className="plugin-version-actions"><button className="link-btn" onClick={() => void inspect(available.version)}>Voir les changements</button><button className="btn-primary compact" disabled={busyVersion === available.version} onClick={() => void change(available.version, true)}>{busyVersion === available.version ? 'Installation…' : 'Mettre à jour'}</button></div>
    </div>}
    {diff && <div className="plugin-version-diff" aria-label={`Changements de la version ${diff.toVersion}`}>
      <strong>{diff.fromVersion} → {diff.toVersion}</strong>
      <ul>{diff.changes.map(change => <li key={change}>{change}</li>)}</ul>
      {diff.warnings.map(warning => <p className="plugin-version-warning" key={warning}>{warning}</p>)}
    </div>}
    <div className="plugin-version-list">
      {versions.map(version => <div className="plugin-version-row" key={version.version}>
        <div><strong>Version {version.version}</strong><small>{version.state === 'current' ? 'Version utilisée actuellement' : version.state === 'available' ? 'Prête à être installée' : formatVersionDate(version.installedAt || version.createdAt)}</small></div>
        {version.state === 'current' ? <span className="plugin-current-version">Actuelle</span> : version.state === 'available' ? null : <div className="plugin-version-actions"><button className="link-btn" onClick={() => void inspect(version.version)}>Comparer</button><button className="secondary-btn compact" disabled={busyVersion === version.version} onClick={() => void change(version.version, false)}>Restaurer</button></div>}
      </div>)}
    </div>
    {error && <p className="plugin-version-warning">{error}</p>}
  </section>
}

function PluginExtensionsSection({ plugin, onOpenIntegrations, onUseSchedule }: { plugin: Plugin; onOpenIntegrations: () => void; onUseSchedule: (template: PluginScheduleTemplate) => void }) {
  const [status, setStatus] = useState<PluginExtensionStatus | null>(null)
  useEffect(() => {
    let active = true
    void getPluginExtensionStatus(plugin.id)
      .then(value => { if (active) setStatus(value) })
      .catch(() => { if (active) setStatus({ integrations: [], browserExtensions: [], hooks: [], scheduledTaskTemplates: [] }) })
    return () => { active = false }
  }, [plugin.id])
  if (!status) return <section className="skill-detail-section"><p>Vérification des extensions du plugin…</p></section>
  return <>
    {status.integrations.length > 0 && <section className="skill-detail-section" aria-label="Connexions du plugin">
      <h3>Connexions</h3>
      <div className="plugin-mcp-list">{status.integrations.map(integration => <div className="plugin-mcp-card" key={integration.provider}>
        <div className="plugin-mcp-heading"><strong>{integration.name}</strong><span className={`plugin-mcp-state ${['connected','configured'].includes(integration.state) ? 'connected' : ''}`}>{integration.state === 'connected' ? 'Connecté' : integration.state === 'configured' ? 'MCP actif' : integration.state === 'disabled' ? 'Désactivé' : 'À connecter'}</span></div>
        <p>{integration.message}</p>
        {integration.scopes.length > 0 && <small>Accès demandé : {integration.scopes.join(', ')}</small>}
      </div>)}</div>
      <button className="link-btn" onClick={onOpenIntegrations}>Gérer les connexions</button>
    </section>}
    {status.browserExtensions.length > 0 && <section className="skill-detail-section" aria-label="Capacités navigateur du plugin">
      <h3>Navigateur</h3>
      <div className="plugin-mcp-list">{status.browserExtensions.map(extension => <div className="plugin-mcp-card" key={extension.id}>
        <div className="plugin-mcp-heading"><strong>{extension.name}</strong><span className={`plugin-mcp-state ${extension.state === 'ready' ? 'connected' : ''}`}>{extension.state === 'ready' ? 'Prêt' : extension.state === 'disabled' ? 'Désactivé' : 'Outil requis'}</span></div>
        <p>{extension.message}</p>
      </div>)}</div>
      <button className="link-btn" onClick={onOpenIntegrations}>Configurer les outils</button>
    </section>}
    {status.hooks.length > 0 && <section className="skill-detail-section" aria-label="Actions automatiques du plugin">
      <h3>Actions automatiques</h3>
      <ul className="plugin-friendly-list">{status.hooks.map(hook => <li key={hook.id}>{hook.name} · {hook.enabled ? hookEventLabel(hook.event) : 'désactivée'}</li>)}</ul>
      <p>Ces actions locales s’exécutent uniquement quand vous utilisez ce plugin et après autorisation.</p>
    </section>}
    {status.scheduledTaskTemplates.length > 0 && <section className="skill-detail-section" aria-label="Automatisations proposées par le plugin">
      <h3>Automatisations</h3>
      <div className="plugin-mcp-list">{status.scheduledTaskTemplates.map(template => <div className="plugin-mcp-card" key={template.id}>
        <div className="plugin-mcp-heading"><strong>{template.name}</strong><button className="link-btn" onClick={() => onUseSchedule(template)}>Planifier</button></div>
        {template.description && <p>{template.description}</p>}
      </div>)}</div>
    </section>}
  </>
}

function PluginMcpSection({ plugin, onOpenIntegrations }: { plugin: Plugin; onOpenIntegrations: () => void }) {
  const [servers, setServers] = useState<PluginMcpStatus[] | null>(null)
  useEffect(() => {
    let active = true
    void getPluginMcpStatus(plugin.id)
      .then(value => { if (active) setServers(value) })
      .catch(() => { if (active) setServers([]) })
    return () => { active = false }
  }, [plugin.id])

  return <section className="skill-detail-section" aria-label="Outils connectés du plugin">
    <h3>Outils connectés</h3>
    {servers === null ? <p>Vérification de la connexion…</p> : servers.length === 0 ? <p>Les outils de ce plugin restent à configurer.</p> : <div className="plugin-mcp-list">
      {servers.map(server => <div className="plugin-mcp-card" key={server.id}>
        <div className="plugin-mcp-heading"><strong>{server.name}</strong><span className={`plugin-mcp-state ${server.enabled ? 'connected' : ''}`}>{server.enabled ? 'Actif' : server.configured ? 'Désactivé' : 'À configurer'}</span></div>
        {server.description && <p>{server.description}</p>}
        {server.tools.length > 0 && <ul className="plugin-friendly-list">{server.tools.map(tool => <li key={tool}>{tool.replace(/_/g, ' ')}</li>)}</ul>}
      </div>)}
    </div>}
    <button className="link-btn" onClick={onOpenIntegrations}>Gérer les connexions</button>
  </section>
}

function Empty({ text }: { text: string }) { return <div className="task-empty"><span>{text}</span></div> }
function hookEventLabel(event: string) { return ({ before_task: 'avant la tâche', after_task: 'après la tâche', task_error: 'en cas d’erreur' } as Record<string, string>)[event] ?? event }
function formatVersionDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Version précédente' : `Installée le ${new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(date)}`
}
