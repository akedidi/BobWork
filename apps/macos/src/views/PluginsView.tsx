import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { open, save as chooseSavePath } from '@tauri-apps/plugin-dialog'
import { comparePluginVersion, createPlugin, deletePlugin, exportPluginZip, getPluginExtensionStatus, getPluginMcpStatus, getPluginResourceStatus, getPlugins, getPluginVersions, importPluginZip, installPluginUpdate, rollbackPluginVersion, testPluginMcp, togglePlugin, updatePlugin, validatePlugin } from '../lib/ipc'
import { errorMessage } from '../lib/errorMessage'
import { LoadErrorBanner } from '../components/LoadErrorBanner'
import { PluginIcon, inferPluginIcon, resolvePluginIcon } from '../components/PluginIcon'
import { isBuiltinPlugin, sortPluginsForDisplay } from '../lib/builtinCatalog'
import { useT } from '../i18n'
import { useAppStore } from '../stores/appStore'
import { PLUGIN_CONVERSATION_PROMPT } from '../lib/pluginBuilder'
import type { Plugin, PluginCategory, PluginExtensionStatus, PluginMcpStatus, PluginMcpTestResult, PluginResourceStatus, PluginScheduleTemplate, PluginVersion, PluginVersionDiff } from '@bob-work/shared-types'
import { useAppDialog } from '../components/AppDialog'
import { statusTone } from '../lib/statusTone'
import { ModalOverlay, ModalPanel } from '../components/ModalOverlay'

type PluginFilter = 'all' | 'enabled' | 'disabled'
type Form = { name: string; description: string; instructions: string; category: PluginCategory }
type PluginsLocationState = { selectPluginId?: string; openCommissioning?: boolean }
type OpenIntegrationsOpts = { tab?: string; highlight?: string; provider?: string }
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
  integrations?: Array<{ provider?: string; displayName?: string; authType?: string; optional?: boolean }>
  browserExtensions?: Array<{ id?: string; displayName?: string; capability?: string; required?: boolean }>
  hooks?: unknown[]
  scheduledTaskTemplates?: unknown[]
  releaseNotes?: string
  connectorStrategy?: { tiers?: Array<{ id?: string; kind?: string; provider?: string; required?: boolean; auth?: string }>; explored?: string[]; fallback?: string }
  resources?: Array<{ kind?: string; label?: string; optional?: boolean; provider?: string; notes?: string }>
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
  'browser.control': 'Contrôler le bureau ou le navigateur avec votre autorisation',
}[permission.type ?? ''] ?? permission.description ?? 'Utiliser une autorisation déclarée par ce plugin')

const capabilityLabel = (capability: string) => {
  const [kind, action] = capability.split('.')
  const object = ({ document: 'des documents', docx: 'des documents Word', pptx: 'des présentations PowerPoint', xlsx: 'des classeurs Excel', onenote: 'des pages OneNote', formula: 'les formules', preview: 'les fichiers' } as Record<string, string>)[kind] ?? kind
  const verb = ({ read: 'Lire', create: 'Créer', edit: 'Modifier', convert: 'Convertir', write: 'Publier', prepare: 'Préparer', verify: 'Vérifier' } as Record<string, string>)[action] ?? (kind === 'preview' ? 'Prévisualiser' : 'Utiliser')
  return `${verb} ${object}`
}

const metadataOf = (plugin: Plugin) => plugin.manifest as unknown as PluginMetadata
const isEnabled = (plugin: Plugin) => plugin.installState === 'installed'
/** Catalog builtins (id `builtin-*`) cannot be deleted; agentic/personal copies can. */
const isProtectedBuiltin = (plugin: Plugin) => isBuiltinPlugin(plugin)
const pluginKindLabel = (plugin: Plugin) => {
  const manifest = metadataOf(plugin)
  if (isProtectedBuiltin(plugin)) return 'Intégré'
  if (manifest.agentic) return 'Agentique'
  return 'Personnel'
}
const nextPatchVersion = (version: string) => {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
  return match ? `${match[1]}.${match[2]}.${Number(match[3]) + 1}` : '1.0.1'
}

export default function PluginsView() {
  const t = useT()
  const dialog = useAppDialog()
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [filter, setFilter] = useState<PluginFilter>('all')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [mcpRevision, setMcpRevision] = useState(0)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Plugin | null>(null)
  const [form, setForm] = useState<Form>(EMPTY)
  const [status, setStatus] = useState('')
  const statusTimerRef = useRef<number | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const locationState = (location.state ?? null) as PluginsLocationState | null

  const startPluginChat = () => {
    setFormOpen(false)
    useAppStore.getState().setBuilderSession({
      kind: 'plugin_builder',
      brief: PLUGIN_CONVERSATION_PROMPT,
      guided: false,
    })
    navigate('/chat', { state: { mode: 'plugin_builder' } })
  }

  const startPluginWizard = () => {
    setFormOpen(false)
    navigate('/plugins/new')
  }

  const load = async () => {
    setLoadError(null)
    try {
      const next = await getPlugins()
      setPlugins(next)
      return next
    } catch (error) {
      setLoadError(error)
      throw error
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load().catch(() => {}) }, [])

  useEffect(() => {
    if (!locationState?.selectPluginId) return
    setSelectedId(locationState.selectPluginId)
  }, [locationState?.selectPluginId])

  // Toast éphémère (succès / erreur d’action) — aligné sur Intégrations.
  useEffect(() => {
    if (!status) return
    if (statusTimerRef.current) window.clearTimeout(statusTimerRef.current)
    statusTimerRef.current = window.setTimeout(() => setStatus(''), 3500)
    return () => {
      if (statusTimerRef.current) window.clearTimeout(statusTimerRef.current)
    }
  }, [status])

  const selected = plugins.find(plugin => plugin.id === selectedId) ?? null
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    const filtered = plugins.filter(plugin => {
      if (filter === 'enabled' && !isEnabled(plugin)) return false
      if (filter === 'disabled' && isEnabled(plugin)) return false
      if (!query) return true
      return `${plugin.name} ${plugin.description}`.toLocaleLowerCase().includes(query)
    })
    return sortPluginsForDisplay(filtered)
  }, [filter, plugins, search])

  const openInstructionsEditor = (plugin?: Plugin) => {
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

  const openEditor = (plugin?: Plugin) => {
    if (!plugin) {
      startPluginChat()
      return
    }
    const manifest = metadataOf(plugin)
    if (isProtectedBuiltin(plugin) || manifest.agentic) {
      setStatus(
        manifest.agentic
          ? `${plugin.name} est un plugin agentique : pour le faire évoluer, utilisez « Créer avec Bob » ou demandez à Bob de le mettre à jour.`
          : `${plugin.name} est un plugin intégré : seules l’activation et la version se gèrent ici.`,
      )
      return
    }
    openInstructionsEditor(plugin)
  }

  const save = async () => {
    const version = editing ? nextPatchVersion(editing.version) : '1.0.0'
    const existing = editing ? metadataOf(editing) : null
    const slug = existing?.slug ?? form.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const icon = existing?.icon?.trim()
      || inferPluginIcon(slug, form.name, form.description)
    const manifest = {
      ...(editing?.manifest as unknown as Record<string, unknown> | undefined),
      name: form.name,
      slug,
      version,
      description: form.description,
      category: form.category,
      instructions: form.instructions,
      icon,
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
      setStatus(editing
        ? 'Plugin enregistré et disponible pour Bob.'
        : 'Plugin instructions enregistré. Pour un plugin avec outils MCP/CLI/APIs, utilisez plutôt « Créer avec Bob ».')
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
    if (!await dialog.confirm({ message: t('plugins.deleteConfirm', { name: plugin.name }), confirmLabel: t('common.delete'), destructive: true })) return
    try {
      await deletePlugin(plugin.id)
      setSelectedId(null)
      await load()
      setStatus(`${plugin.name} a été supprimé.`)
    } catch (error) {
      setStatus(errorMessage(error))
    }
  }

  const importZip = async () => {
    setStatus('')
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: 'Importer un plugin (.zip)',
        filters: [{ name: 'ZIP', extensions: ['zip'] }],
      })
      const path = typeof selected === 'string' ? selected : Array.isArray(selected) ? selected[0] : null
      if (!path) return
      const imported = await importPluginZip(path)
      await load()
      setSelectedId(imported.id)
      setStatus(`${imported.name} a été importé.`)
    } catch (error) {
      setStatus(errorMessage(error))
    }
  }

  return <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
    <div className="topbar titlebar-drag" data-tauri-drag-region>
      <strong>{t('plugins.title')}</strong>
      <div className="titlebar-no-drag" style={{ marginLeft: 'auto', display: 'flex', gap: 7 }}>
        <button type="button" className="secondary-btn" onClick={() => void importZip()}>Importer .zip</button>
        <button type="button" className="secondary-btn" onClick={startPluginWizard}>Assistant guidé</button>
        <button className="btn-primary" onClick={startPluginChat}>+ Nouveau plugin</button>
      </div>
    </div>

    <div className="extensions-content">
      <LoadErrorBanner error={loadError} onRetry={() => { setLoading(true); void load().catch(() => {}) }} fallback={t('plugins.loadFailed')} />
      <div className={`skills-workspace ${selected ? 'has-panel' : ''}`}>
        <section className="skills-browser">
          <div className="skills-toolbar">
            <div><h2>Vos plugins</h2><small>{plugins.filter(isEnabled).length} activés sur {plugins.length}</small></div>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['all', 'enabled', 'disabled'] as const).map(value => <button className={`filter-pill ${filter === value ? 'active' : ''}`} key={value} onClick={() => setFilter(value)}>{value === 'all' ? 'Tous' : value === 'enabled' ? 'Activés' : 'Désactivés'}</button>)}
            </div>
          </div>
          <div className="skill-search-wrap"><span aria-hidden="true">⌕</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Rechercher un plugin" aria-label="Rechercher un plugin" /></div>
          <p className="skills-help">« + Nouveau plugin » ouvre le chat : décrivez l’idée, Bob génère le bundle. L’assistant guidé et l’import .zip restent optionnels. Le badge <strong>Intégré</strong> marque les plugins natifs — ils ne peuvent pas être supprimés.</p>
          <div className="skills-list">
            {loadError ? null : loading ? <Empty text="Chargement…" /> : visible.length === 0 ? <Empty text={plugins.length ? t('plugins.noneFound') : t('plugins.empty')} /> : visible.map(plugin => {
              const enabled = isEnabled(plugin)
              const canDelete = !isProtectedBuiltin(plugin)
              return <div className={`skill-list-row ${selectedId === plugin.id ? 'selected' : ''} ${enabled ? '' : 'disabled'}`} key={plugin.id}>
                <button className="skill-row-main" onClick={() => setSelectedId(plugin.id)}>
                  <PluginIcon icon={resolvePluginIcon(plugin)} size="md" className="skill-row-icon" />
                  <span className="skill-row-copy"><strong>{plugin.name}</strong><small>{plugin.description || 'Aucune description'}</small></span>
                  <span className="skill-row-badges">
                    {plugin.availableVersion && <span className="plugin-update-badge">Mise à jour</span>}
                    <span className="skill-scope-badge">{pluginKindLabel(plugin)}</span>
                  </span>
                </button>
                {canDelete && (
                  <button
                    type="button"
                    className="skill-row-delete-btn"
                    title={`Supprimer ${plugin.name}`}
                    aria-label={`Supprimer le plugin ${plugin.name}`}
                    onClick={event => {
                      event.stopPropagation()
                      void removePlugin(plugin)
                    }}
                  >
                    Supprimer
                  </button>
                )}
                <label className="skill-switch" title={enabled ? 'Désactiver' : 'Activer'}>
                  <input type="checkbox" checked={enabled} disabled={togglingId === plugin.id} aria-label={`${enabled ? 'Désactiver' : 'Activer'} le plugin ${plugin.name}`} onChange={event => void changeEnabled(plugin, event.target.checked)} />
                  <span aria-hidden="true" />
                </label>
              </div>
            })}
          </div>
        </section>

        {selected && <PluginDetail plugin={selected} mcpRevision={mcpRevision} toggling={togglingId === selected.id} openCommissioning={Boolean(locationState?.openCommissioning && locationState.selectPluginId === selected.id)} onClose={() => setSelectedId(null)} onToggle={enabled => void changeEnabled(selected, enabled)} onEdit={() => openEditor(selected)} onDelete={() => void removePlugin(selected)} onStatus={setStatus} onOpenIntegrations={opts => navigate('/integrations', { state: { tab: opts?.tab ?? 'integrations', highlight: opts?.highlight ?? opts?.provider } })} onUseSchedule={template => navigate('/schedules', { state: { pluginTemplate: { ...template, pluginId: selected.id, pluginName: selected.name } } })} onVersionChanged={async (message, expectedVersion) => {
          const next = await load()
          setMcpRevision(value => value + 1)
          const refreshed = next.find(item => item.id === selected.id)
          if (expectedVersion && refreshed && refreshed.version !== expectedVersion) {
            setStatus(`${refreshed.name} est resté en version ${refreshed.version} (retour à ${expectedVersion} non appliqué).`)
            return
          }
          setStatus(message)
        }} />}
      </div>
    </div>

    {formOpen && (
      <ModalOverlay onClose={() => setFormOpen(false)}>
        <ModalPanel className="plugin-editor-modal" aria-labelledby="plugin-editor-title">
          <h2 id="plugin-editor-title">{editing ? 'Modifier les instructions du plugin' : 'Modifier le plugin'}</h2>
          <p className="settings-note">
            Ce formulaire enregistre des consignes pour Bob, pas un bundle agentique avec MCP/CLI.
            Pour un vrai plugin avec outils, utilisez « Créer avec Bob ».
          </p>
          <label>Nom<input value={form.name} onChange={event => setForm(value => ({ ...value, name: event.target.value }))} placeholder="Ex : Assistant contrats" /></label>
          <label>
            Description
            <small style={{ display: 'block', marginTop: 3, color: 'var(--text-muted)', fontWeight: 400 }}>
              En 1–2 phrases : ce que le plugin fait pour l’utilisateur (pas la stack technique).
            </small>
            <input
              value={form.description}
              onChange={event => setForm(value => ({ ...value, description: event.target.value }))}
              placeholder="Ex. : Prépare un résumé de contrat et liste les clauses à vérifier"
            />
          </label>
          <label>Instructions<textarea rows={12} value={form.instructions} onChange={event => setForm(value => ({ ...value, instructions: event.target.value }))} placeholder="Expliquez ce que Bob doit faire, les vérifications attendues et les limites à respecter…" /></label>
          <div className="settings-actions">
            <button className="secondary-btn" onClick={() => setFormOpen(false)}>Retour</button>
            <button className="btn-primary" disabled={!form.name || !form.description || !form.instructions} onClick={() => void save()}>Enregistrer</button>
          </div>
        </ModalPanel>
      </ModalOverlay>
    )}
    {status && <div className={`settings-status settings-status--${statusTone(status)}`} role="status" aria-live="polite">{status}</div>}
  </div>
}

function PluginDetail({ plugin, mcpRevision, toggling, openCommissioning, onClose, onToggle, onEdit, onDelete, onStatus, onOpenIntegrations, onUseSchedule, onVersionChanged }: {
  plugin: Plugin
  mcpRevision: number
  toggling: boolean
  openCommissioning?: boolean
  onClose: () => void
  onToggle: (enabled: boolean) => void
  onEdit: () => void
  onDelete: () => void
  onStatus: (message: string) => void
  onOpenIntegrations: (opts?: OpenIntegrationsOpts) => void
  onUseSchedule: (template: PluginScheduleTemplate) => void
  onVersionChanged: (message: string, expectedVersion?: string) => Promise<void>
}) {
  const navigate = useNavigate()
  const manifest = metadataOf(plugin)
  const enabled = isEnabled(plugin)
  const protectedBuiltin = isProtectedBuiltin(plugin)
  const capabilities = manifest.capabilities?.filter(value => value !== 'prompt').map(capabilityLabel) ?? []
  const permissions = manifest.permissions?.map(permissionLabel) ?? []

  const exportZip = async () => {
    const slug = manifest.slug?.trim() || plugin.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || plugin.id
    try {
      const destination = await chooseSavePath({
        defaultPath: `${slug}.zip`,
        filters: [{ name: 'ZIP', extensions: ['zip'] }],
        title: `Exporter « ${plugin.name} »`,
      })
      if (!destination) return
      await exportPluginZip(plugin.id, destination)
      onStatus(`${plugin.name} a été exporté.`)
    } catch (error) {
      onStatus(errorMessage(error))
    }
  }

  return <aside className="skill-detail-panel" aria-label={`Détails du plugin ${plugin.name}`}>
    <div className="skill-panel-heading">
      <div className="skill-detail-title"><PluginIcon icon={resolvePluginIcon(plugin)} size="lg" className="skill-row-icon" /><div><h2>{plugin.name}</h2><small>{pluginKindLabel(plugin)} · Version {plugin.version}</small></div></div>
      <button className="icon-btn" aria-label="Fermer les détails" onClick={onClose}>×</button>
    </div>
    <div className="skill-detail-status">
      <div><strong>{enabled ? 'Activé' : 'Désactivé'}</strong><small>{enabled ? 'Bob peut utiliser ce plugin.' : 'Bob n’utilisera pas ce plugin.'}</small></div>
      <label className="skill-switch"><input type="checkbox" checked={enabled} disabled={toggling} aria-label={`${enabled ? 'Désactiver' : 'Activer'} le plugin ${plugin.name}`} onChange={event => onToggle(event.target.checked)} /><span aria-hidden="true" /></label>
    </div>
    <div className="skill-panel-actions">
      {!protectedBuiltin && <>
        {!manifest.agentic && <button type="button" className="secondary-btn" onClick={onEdit}>Modifier</button>}
        {manifest.agentic && (
          <button
            type="button"
            className="secondary-btn"
            onClick={() => {
              const brief = `Mets à jour le plugin agentique « ${plugin.name} » (id ${plugin.id}). Demande-moi les changements souhaités. Conserve ou corrige la description pour qu’elle reste fonctionnelle (bénéfice utilisateur, pas jargon MCP/CLI). Puis régénère/ajuste le bundle local et vérifie-le.`
              useAppStore.getState().setBuilderSession({ kind: 'plugin_builder', brief, guided: false })
              navigate('/chat', { state: { mode: 'plugin_builder', initialPrompt: brief } })
            }}
          >
            Faire évoluer avec Bob
          </button>
        )}
        <button type="button" className="secondary-btn" onClick={() => void exportZip()}>Exporter .zip</button>
        <button type="button" className="secondary-btn plugin-delete-btn" onClick={onDelete}>Supprimer</button>
      </>}
      {protectedBuiltin && <p className="settings-note" style={{ margin: 0 }}>Plugin intégré : désactivation possible, suppression impossible.</p>}
    </div>
    <PluginCommissioningSection plugin={plugin} autoStart={openCommissioning} />
    <section className="skill-detail-section"><h3>Description</h3><p>{plugin.description || 'Aucune description.'}</p></section>
    <PluginResourcesSection
      pluginId={plugin.id}
      manifest={manifest}
      description={plugin.description}
      revision={mcpRevision}
      onConfigureResource={target => {
        navigate('/integrations', {
          state: {
            tab: target.tab,
            apiKeyPreset: target.envKey
              ? {
                  name: target.label,
                  envName: target.envKey,
                  authMode: 'env' as const,
                  url: target.url || '',
                  transport: 'http',
                }
              : undefined,
            highlight: target.tab === 'mcp' ? 'mcp' : target.tab === 'apis' ? 'keyed-api' : undefined,
          },
        })
      }}
    />
    <section className="skill-detail-section"><h3>Ce plugin peut faire</h3>{capabilities.length ? <ul className="plugin-friendly-list">{capabilities.map(value => <li key={value}>{value}</li>)}</ul> : <p>Aider Bob à réaliser les demandes correspondant à sa description.</p>}</section>
    {manifest.mcpServers && <PluginMcpSection key={`${plugin.id}-${plugin.installState}-${mcpRevision}`} plugin={plugin} onOpenIntegrations={onOpenIntegrations} />}
    {(Boolean(manifest.integrations?.length) || Boolean(manifest.browserExtensions?.length) || Boolean(manifest.hooks?.length) || Boolean(manifest.scheduledTaskTemplates?.length)) && <PluginExtensionsSection key={`extensions-${plugin.id}-${plugin.installState}-${mcpRevision}`} plugin={plugin} onOpenIntegrations={onOpenIntegrations} onUseSchedule={onUseSchedule} />}
    <section className="skill-detail-section"><h3>Autorisations</h3>{permissions.length ? <ul className="plugin-friendly-list">{permissions.map(value => <li key={value}>{value}</li>)}</ul> : <p>Aucune autorisation supplémentaire.</p>}</section>
    <PluginVersionsSection plugin={plugin} onVersionChanged={onVersionChanged} />
    <ManifestReadOnlySection plugin={plugin} />
    {manifest.requiresIntegration && <section className="skill-detail-section"><h3>Connexion</h3><p>Ce plugin nécessite un compte ou un service connecté.</p><button className="link-btn" onClick={() => onOpenIntegrations({ tab: 'integrations' })}>Gérer les connexions</button></section>}
  </aside>
}

function PluginVersionsSection({ plugin, onVersionChanged }: { plugin: Plugin; onVersionChanged: (message: string, expectedVersion?: string) => Promise<void> }) {
  const dialog = useAppDialog()
  const t = useT()
  const [versions, setVersions] = useState<PluginVersion[]>([])
  const [diff, setDiff] = useState<PluginVersionDiff | null>(null)
  const [busyVersion, setBusyVersion] = useState<string | null>(null)
  const [error, setError] = useState('')
  const protectedBuiltin = isProtectedBuiltin(plugin)
  const canRestore = !protectedBuiltin

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
    if (!update && !canRestore) return
    if (!update && !await dialog.confirm({ message: t('plugins.restoreConfirm', { version, name: plugin.name }), confirmLabel: t('plugins.restore') })) return
    setBusyVersion(version)
    setError('')
    try {
      const updated = update
        ? await installPluginUpdate(plugin.id, version)
        : await rollbackPluginVersion(plugin.id, version)
      if (updated.version !== version) {
        throw new Error(`${plugin.name} est resté en version ${updated.version} (cible ${version} non appliquée).`)
      }
      await onVersionChanged(
        update ? `${plugin.name} a été mis à jour vers la version ${version}.` : `${plugin.name} utilise de nouveau la version ${version}.`,
        version,
      )
      setDiff(null)
      await loadVersions()
    } catch (error) {
      const message = errorMessage(error)
      setError(message)
      await onVersionChanged(`Mise à jour impossible : ${message}`)
    } finally { setBusyVersion(null) }
  }

  const available = versions.find(version => version.state === 'available')
  return <section className="skill-detail-section plugin-versions" aria-label="Versions du plugin">
    <h3>Versions</h3>
    {protectedBuiltin && <p className="settings-note">Plugin intégré : la version livrée avec Bob Work est conservée ; les anciennes versions restent consultables.</p>}
    {available && <div className="plugin-update-card">
      <div><strong>Version {available.version} disponible</strong><small>{available.releaseNotes || 'Une nouvelle version locale a été détectée.'}</small></div>
      <div className="plugin-version-actions"><button type="button" className="link-btn" onClick={() => void inspect(available.version)}>Voir les changements</button><button type="button" className="btn-primary compact" disabled={busyVersion === available.version} onClick={() => void change(available.version, true)}>{busyVersion === available.version ? 'Installation…' : 'Mettre à jour'}</button></div>
    </div>}
    {diff && <div className="plugin-version-diff" aria-label={`Changements de la version ${diff.toVersion}`}>
      <strong>{diff.fromVersion} → {diff.toVersion}</strong>
      <ul>{diff.changes.map(change => <li key={change}>{change}</li>)}</ul>
      {diff.warnings.map(warning => <p className="plugin-version-warning" key={warning}>{warning}</p>)}
    </div>}
    <div className="plugin-version-list">
      {versions.map(version => <div className="plugin-version-row" key={version.version}>
        <div><strong>Version {version.version}</strong><small>{version.state === 'current' ? 'Version utilisée actuellement' : version.state === 'available' ? 'Prête à être installée' : formatVersionDate(version.installedAt || version.createdAt)}</small></div>
        {version.state === 'current' ? <span className="plugin-current-version">Actuelle</span> : version.state === 'available' ? <div className="plugin-version-actions"><button type="button" className="btn-primary compact" disabled={busyVersion === version.version} onClick={() => void change(version.version, true)}>{busyVersion === version.version ? 'Installation…' : 'Mettre à jour'}</button></div> : <div className="plugin-version-actions"><button type="button" className="link-btn" onClick={() => void inspect(version.version)}>Comparer</button>{canRestore && <button type="button" className="secondary-btn compact" disabled={busyVersion === version.version} onClick={() => void change(version.version, false)}>Restaurer</button>}</div>}
      </div>)}
    </div>
    {error && <p className="plugin-version-warning" role="alert">{error}</p>}
  </section>
}

function resourceKindLabel(kind: string) {
  return ({
    oauth: 'OAuth',
    mcp: 'MCP',
    'api-public': 'API publique',
    'api-key': 'API + clé',
    'web-search': 'Recherche web',
    'bob-llm': 'LLM Bob',
    'computer-use': 'Computer Use',
    chrome: 'Contrôle Chrome',
    'stdio-cli': 'CLI locale',
  } as Record<string, string>)[kind] ?? kind
}

function resourceStateLabel(state: string) {
  return ({
    ready: 'Prêt',
    needs_key: 'Clé API manquante',
    needs_setup: 'À configurer',
    inactive: 'Non utilisé',
    always_on: 'Toujours actif',
  } as Record<string, string>)[state] ?? state
}

function resourceStateClass(state: string) {
  if (state === 'ready' || state === 'always_on') return 'connected'
  if (state === 'needs_key') return 'needs-key'
  if (state === 'needs_setup') return 'needs-setup'
  if (state === 'inactive') return 'inactive'
  return ''
}

function collectPluginResources(manifest: PluginMetadata, description?: string | null) {
  const items: Array<{ key: string; kind: string; label: string; optional: boolean; notes?: string }> = []
  const push = (kind: string, label: string, optional = false, notes?: string) => {
    const key = `${kind}:${label}`
    if (items.some(item => item.key === key)) return
    items.push({ key, kind, label, optional, notes })
  }

  const declaredResources = (manifest.resources ?? []).filter(resource => resource?.label || resource?.kind)
  // Prefer an explicit `resources` list when present — otherwise the same
  // connectors were also mirrored in integrations / mcpServers / connectorStrategy
  // and the detail panel looked redundant.
  if (declaredResources.length > 0) {
    for (const resource of declaredResources) {
      push(
        resource.kind || 'mcp',
        resource.label || resource.provider || resource.kind || 'Ressource',
        Boolean(resource.optional),
        resource.notes,
      )
    }
    return items
  }

  for (const integration of manifest.integrations ?? []) {
    push(
      integration.authType === 'token' ? 'api-key' : 'oauth',
      integration.displayName || integration.provider || 'Connexion',
      Boolean(integration.optional),
      integration.provider,
    )
  }
  for (const [id, server] of Object.entries(manifest.mcpServers ?? {})) {
    const entry = server as { displayName?: string; description?: string; url?: string; command?: string }
    push('mcp', entry.displayName || id, false, entry.description || entry.url || entry.command)
  }
  for (const extension of manifest.browserExtensions ?? []) {
    const kind = extension.capability === 'chrome' ? 'chrome' : extension.capability === 'computer_use' ? 'computer-use' : 'mcp'
    push(kind, extension.displayName || extension.id || kind, extension.required === false)
  }
  for (const tier of manifest.connectorStrategy?.tiers ?? []) {
    const kind = tier.kind?.includes('oauth')
      ? 'oauth'
      : tier.kind?.includes('open-api') || tier.kind === 'open-api'
        ? (tier.auth === 'token' || String(tier.provider || '').includes('finnhub') ? 'api-key' : 'api-public')
        : tier.kind?.includes('remote')
          ? 'mcp'
          : tier.kind?.includes('local') || tier.kind?.includes('cli')
            ? 'stdio-cli'
            : (tier.kind || 'mcp')
    push(kind, tier.provider || tier.id || kind, tier.required === false)
  }
  const permissions = manifest.permissions ?? []
  if (permissions.some(item => item.type === 'network.request')) {
    push('web-search', 'Recherche / réseau web Bob', true)
  }
  if (manifest.capabilities?.some(value => value.includes('llm') || value.includes('brief') || value.includes('synthesize'))) {
    push('bob-llm', 'LLM Bob (synthèse)', false)
  }
  if (description?.toLowerCase().includes('llm bob') || description?.toLowerCase().includes('synthèse')) {
    push('bob-llm', 'LLM Bob', false)
  }
  return items
}

function PluginResourcesSection({
  pluginId,
  manifest,
  description,
  revision,
  onConfigureResource,
}: {
  pluginId: string
  manifest: PluginMetadata
  description?: string | null
  revision: number
  onConfigureResource: (target: {
    tab: 'integrations' | 'apis' | 'mcp'
    label: string
    envKey?: string
    url?: string
  }) => void
}) {
  const [live, setLive] = useState<PluginResourceStatus[] | null>(null)
  useEffect(() => {
    let active = true
    void getPluginResourceStatus(pluginId)
      .then(value => { if (active) setLive(value) })
      .catch(() => { if (active) setLive([]) })
    return () => { active = false }
  }, [pluginId, revision])

  const fallback = collectPluginResources(manifest, description)
  if (live === null) {
    return <section className="skill-detail-section" aria-label="Sources du plugin"><h3>Sources</h3><p>Vérification de l’état des sources…</p></section>
  }
  if (live.length === 0 && fallback.length === 0) return null

  const rows = live.length > 0 ? live : fallback.map((resource, index) => ({
    id: `${resource.key}-${index}`,
    label: resource.label,
    kind: resource.kind,
    optional: resource.optional,
    state: resource.optional ? 'inactive' : 'ready',
    message: resource.notes || '',
    setupHint: null as string | null,
    configureTab: resource.kind === 'api-key' ? 'apis' : resource.kind === 'mcp' ? 'mcp' : resource.kind === 'oauth' ? 'integrations' : null,
    envKey: resource.notes?.match(/[A-Z][A-Z0-9_]{5,}/)?.[0] ?? null,
    configureUrl: null as string | null,
  }))

  return (
    <section className="skill-detail-section" aria-label="Sources du plugin">
      <h3>Sources</h3>
      <p className="settings-note" style={{ marginTop: 0 }}>
        Données et APIs utilisées par le plugin. Une source « API + clé » (ex. Finnhub) se configure dans Intégrations → APIs — ce n’est pas un serveur MCP séparé dans « Outils connectés ».
      </p>
      <div className="plugin-mcp-list">
        {rows.map(resource => {
          const tab = (resource.configureTab === 'apis' || resource.configureTab === 'mcp' || resource.configureTab === 'integrations')
            ? resource.configureTab
            : resource.kind === 'api-key'
              ? 'apis'
              : resource.kind === 'mcp'
                ? 'mcp'
                : null
          const showConfigure = Boolean(tab) && (
            resource.kind === 'api-key'
            || resource.kind === 'mcp'
            || resource.kind === 'oauth'
            || resource.state === 'needs_key'
            || resource.state === 'needs_setup'
            || resource.state === 'inactive'
          )
          const configureLabel = tab === 'apis'
            ? (resource.state === 'ready' ? 'Gérer dans APIs' : 'Configurer dans APIs')
            : tab === 'mcp'
              ? 'Configurer dans MCP'
              : 'Ouvrir Intégrations'
          return (
            <div className="plugin-mcp-card" key={resource.id}>
              <div className="plugin-mcp-heading">
                <strong>{resource.label}</strong>
                <span className={`plugin-mcp-state ${resourceStateClass(resource.state)}`}>
                  {resourceStateLabel(resource.state)}
                  {resource.optional ? ' · optionnel' : ''}
                </span>
              </div>
              <p>{resource.message || resourceKindLabel(resource.kind)}</p>
              {'setupHint' in resource && resource.setupHint && <p className="settings-note">{resource.setupHint}</p>}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 6 }}>
                <small>{resourceKindLabel(resource.kind)}</small>
                {showConfigure && tab && (
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => onConfigureResource({
                      tab,
                      label: resource.label,
                      envKey: resource.envKey || undefined,
                      url: resource.configureUrl || undefined,
                    })}
                  >
                    {tab === 'apis' ? configureLabel : tab === 'mcp' ? 'Configurer dans MCP' : 'Ouvrir Intégrations'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function PluginExtensionsSection({ plugin, onOpenIntegrations, onUseSchedule }: { plugin: Plugin; onOpenIntegrations: (opts?: OpenIntegrationsOpts) => void; onUseSchedule: (template: PluginScheduleTemplate) => void }) {
  const [status, setStatus] = useState<PluginExtensionStatus | null>(null)
  const [statusError, setStatusError] = useState<unknown>(null)
  useEffect(() => {
    let active = true
    setStatusError(null)
    void getPluginExtensionStatus(plugin.id)
      .then(value => { if (active) setStatus(value) })
      .catch(error => {
        if (!active) return
        setStatusError(error)
        setStatus({ integrations: [], browserExtensions: [], hooks: [], scheduledTaskTemplates: [] })
      })
    return () => { active = false }
  }, [plugin.id])
  if (!status) return <section className="skill-detail-section"><p>Vérification des extensions du plugin…</p></section>
  if (statusError) return <section className="skill-detail-section" role="alert"><p className="plugin-version-warning">{errorMessage(statusError, 'Impossible de charger les connexions du plugin.')}</p></section>
  return <>
    {status.integrations.length > 0 && <section className="skill-detail-section" aria-label="Connexions du plugin">
      <h3>Connexions</h3>
      <p className="settings-note" style={{ marginTop: 0 }}>
        Comptes à autoriser (OAuth / jeton) pour ce plugin — distinct des sources API publiques listées plus haut.
      </p>
      <div className="plugin-mcp-list">{status.integrations.map(integration => <div className="plugin-mcp-card" key={integration.provider}>
        <div className="plugin-mcp-heading"><strong>{integration.name}</strong><span className={`plugin-mcp-state ${integration.state === 'connected' ? 'connected' : integration.state === 'failed' ? 'failed' : integration.state === 'configured' ? 'configured' : ''}`} title={integration.message}>{integration.state === 'connected' ? 'Connecté' : integration.state === 'configured' ? 'Configuré (compte à vérifier)' : integration.state === 'failed' ? 'Test échoué' : integration.state === 'disabled' ? 'Désactivé' : 'À connecter'}</span></div>
        <p>{integration.message}</p>
        {integration.scopes.length > 0 && <small>Accès demandé : {integration.scopes.join(', ')}</small>}
        {integration.state !== 'connected' && (
          <button
            type="button"
            className="link-btn"
            onClick={() => onOpenIntegrations({ tab: 'integrations', highlight: integration.provider, provider: integration.provider })}
          >
            Connecter
          </button>
        )}
      </div>)}</div>
      <button className="link-btn" onClick={() => onOpenIntegrations({ tab: 'integrations' })}>Gérer les connexions</button>
    </section>}
    {status.browserExtensions.length > 0 && <section className="skill-detail-section" aria-label="Capacités navigateur du plugin">
      <h3>Navigateur</h3>
      <div className="plugin-mcp-list">{status.browserExtensions.map(extension => <div className="plugin-mcp-card" key={extension.id}>
        <div className="plugin-mcp-heading"><strong>{extension.name}</strong><span className={`plugin-mcp-state ${extension.state === 'ready' ? 'connected' : ''}`}>{extension.state === 'ready' ? 'Prêt' : extension.state === 'disabled' ? 'Désactivé' : 'Outil requis'}</span></div>
        <p>{extension.message}</p>
      </div>)}</div>
      <button className="link-btn" onClick={() => onOpenIntegrations({ tab: 'integrations' })}>Configurer les outils</button>
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

function PluginMcpSection({ plugin, onOpenIntegrations }: { plugin: Plugin; onOpenIntegrations: (opts?: OpenIntegrationsOpts) => void }) {
  const [servers, setServers] = useState<PluginMcpStatus[] | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResults, setTestResults] = useState<PluginMcpTestResult[] | null>(null)
  const [testError, setTestError] = useState('')
  const [statusError, setStatusError] = useState('')

  const refresh = () => getPluginMcpStatus(plugin.id)
    .then(value => { setServers(value); setStatusError('') })
    .catch(error => { setStatusError(errorMessage(error, 'Impossible de charger les outils MCP.')); setServers([]) })

  useEffect(() => {
    let active = true
    setStatusError('')
    void getPluginMcpStatus(plugin.id)
      .then(value => { if (active) setServers(value) })
      .catch(error => {
        if (!active) return
        setStatusError(errorMessage(error, 'Impossible de charger les outils MCP.'))
        setServers([])
      })
    return () => { active = false }
  }, [plugin.id])

  const runTest = async () => {
    setTesting(true)
    setTestError('')
    setTestResults(null)
    try {
      const results = await testPluginMcp(plugin.id)
      setTestResults(results)
      await refresh()
    } catch (error) {
      setTestError(errorMessage(error))
    } finally {
      setTesting(false)
    }
  }

  return <section className="skill-detail-section" aria-label="Outils connectés du plugin">
    <h3>Outils connectés</h3>
    <p className="settings-note" style={{ marginTop: 0 }}>
      Serveurs MCP exposés par ce plugin (outils appelables). Les APIs comme Stooq ou Finnhub sont listées dans Sources — Finnhub n’est pas un outil MCP séparé.
    </p>
    {servers === null ? <p>Vérification de la connexion…</p> : servers.length === 0 ? <p>Les outils de ce plugin restent à configurer.</p> : <div className="plugin-mcp-list">
      {servers.map(server => {
        const live = testResults?.find(item => item.id === server.id)
        const persisted = server.lastTest
        const result = live
          ? { ok: live.ok, message: live.message, testedAt: live.testedAt ?? undefined }
          : persisted
            ? { ok: persisted.ok, message: persisted.message, testedAt: persisted.testedAt }
            : null
        const stateClass = result ? (result.ok ? 'connected' : 'failed') : server.enabled ? 'configured' : 'untested'
        const stateLabel = result
          ? (result.ok ? 'Test réussi' : 'Échec')
          : server.enabled
            ? 'Installé · non testé'
            : server.configured
              ? 'Désactivé'
              : 'À configurer'
        return <div className="plugin-mcp-card" key={server.id}>
          <div className="plugin-mcp-heading">
            <strong>{server.name}</strong>
            <span className={`plugin-mcp-state ${stateClass}`} title={result?.testedAt ? `Testé le ${result.testedAt}` : undefined}>
              {stateLabel}
            </span>
          </div>
          {server.description && <p>{server.description}</p>}
          {server.tools.length > 0 && <ul className="plugin-friendly-list">{server.tools.map(tool => <li key={tool}>{tool.replace(/_/g, ' ')}</li>)}</ul>}
          {result && <p className={result.ok ? 'settings-note' : 'plugin-version-warning'} role={result.ok ? undefined : 'alert'}>{result.message}</p>}
        </div>
      })}
    </div>}
    <div className="skill-panel-actions">
      <button className="secondary-btn" disabled={testing || !servers?.length} onClick={() => void runTest()}>
        {testing ? 'Test en cours…' : 'Tester la connexion MCP'}
      </button>
      <button className="link-btn" onClick={() => onOpenIntegrations({ tab: 'integrations' })}>Gérer les connexions</button>
    </div>
    {statusError && <p className="plugin-version-warning" role="alert">{statusError}</p>}
    {testError && <p className="plugin-version-warning" role="alert">{testError}</p>}
  </section>
}

function PluginCommissioningSection({ plugin, autoStart }: { plugin: Plugin; autoStart?: boolean }) {
  type CheckLevel = 'ok' | 'warn' | 'error'
  type CheckItem = { id: string; label: string; level: CheckLevel; detail?: string }
  const [items, setItems] = useState<CheckItem[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const autoRanFor = useRef<string | null>(null)

  const run = async () => {
    setBusy(true)
    setError('')
    try {
      const checklist: CheckItem[] = []
      const validation = await validatePlugin(plugin.manifest)
      if (validation.valid && validation.errors.length === 0) {
        checklist.push({
          id: 'manifest',
          label: 'Manifeste',
          level: validation.warnings.length ? 'warn' : 'ok',
          detail: validation.warnings.length ? validation.warnings.join(' · ') : 'Valide',
        })
      } else {
        checklist.push({
          id: 'manifest',
          label: 'Manifeste',
          level: 'error',
          detail: validation.errors.join(' · ') || 'Validation échouée',
        })
      }

      const servers = await getPluginMcpStatus(plugin.id)
      if (servers.length === 0) {
        checklist.push({ id: 'mcp', label: 'Serveurs MCP', level: 'ok', detail: 'Aucun serveur MCP à vérifier' })
      } else {
        const notReady = servers.filter(server => !server.configured || !server.enabled)
        checklist.push({
          id: 'mcp',
          label: 'Serveurs MCP',
          level: notReady.length ? 'warn' : 'ok',
          detail: notReady.length
            ? `${notReady.length} serveur(s) à configurer ou activer`
            : `${servers.length} serveur(s) prêts`,
        })
        try {
          const results = await testPluginMcp(plugin.id)
          const failed = results.filter(result => !result.ok)
          checklist.push({
            id: 'mcp-test',
            label: 'Test MCP',
            level: failed.length ? 'error' : 'ok',
            detail: failed.length ? failed.map(result => result.message).join(' · ') : 'Connexion MCP OK',
          })
        } catch (testError) {
          checklist.push({ id: 'mcp-test', label: 'Test MCP', level: 'warn', detail: errorMessage(testError) })
        }
      }

      setItems(checklist)
    } catch (runError) {
      setError(errorMessage(runError))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    setItems(null)
    setError('')
    if (autoRanFor.current === plugin.id) autoRanFor.current = null
  }, [plugin.id])

  useEffect(() => {
    if (!autoStart || autoRanFor.current === plugin.id) return
    autoRanFor.current = plugin.id
    void run()
  }, [autoStart, plugin.id])

  const levelLabel = (level: CheckLevel) => (level === 'ok' ? 'OK' : level === 'warn' ? 'Attention' : 'Erreur')

  return <section className="skill-detail-section plugin-commissioning" aria-label="Mise en service du plugin">
    <h3>Mise en service</h3>
    <p className="settings-note" style={{ marginTop: 0 }}>
      Vérifie le manifeste, l’état des outils MCP, puis lance un test de connexion si besoin.
    </p>
    <button type="button" className="btn-primary compact" disabled={busy} onClick={() => void run()}>
      {busy ? 'Vérification…' : 'Lancer la mise en service'}
    </button>
    {error && <p className="plugin-version-warning" role="alert">{error}</p>}
    {items && <ul className="plugin-friendly-list">
      {items.map(item => (
        <li key={item.id}>
          <strong>{levelLabel(item.level)}</strong>
          {' · '}
          {item.label}
          {item.detail ? ` — ${item.detail}` : ''}
        </li>
      ))}
    </ul>}
  </section>
}

function ManifestReadOnlySection({ plugin }: { plugin: Plugin }) {
  const [expanded, setExpanded] = useState(false)
  return <section className="skill-detail-section" aria-label="Manifeste du plugin">
    <h3>
      <button type="button" className="link-btn" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
        Manifeste (lecture seule)
      </button>
    </h3>
    {expanded && <pre className="plugin-manifest-pre">{JSON.stringify(plugin.manifest, null, 2)}</pre>}
  </section>
}

function Empty({ text }: { text: string }) { return <div className="task-empty"><span>{text}</span></div> }
function hookEventLabel(event: string) { return ({ before_task: 'avant la tâche', after_task: 'après la tâche', task_error: 'en cas d’erreur' } as Record<string, string>)[event] ?? event }
function formatVersionDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Version précédente' : `Installée le ${new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(date)}`
}
