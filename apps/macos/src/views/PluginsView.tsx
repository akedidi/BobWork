import { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { open } from '@tauri-apps/plugin-dialog'
import { deletePlugin, importPluginZip, togglePlugin, updatePlugin } from '../lib/ipc'
import { errorMessage } from '../lib/errorMessage'
import { LoadErrorBanner } from '../components/LoadErrorBanner'
import { PluginIcon, resolvePluginIcon } from '../components/PluginIcon'
import { useT } from '../i18n'
import type { Plugin } from '@bob-work/shared-types'
import { isEnabled, isProtectedBuiltin, metadataOf, nextPatchVersion, pluginKindLabel } from '../lib/pluginUtils'
import { usePluginsData, usePluginFilter, usePluginEditor } from '../hooks/usePlugins'
import { useTransientStatus } from '../hooks/useTransientStatus'
import { PluginEditorModal } from '../components/Plugins/PluginEditorModal'
import PluginDetail from '../components/Plugins/PluginDetail'

type PluginsLocationState = { selectPluginId?: string; openCommissioning?: boolean }
type OpenIntegrationsOpts = { tab?: string; highlight?: string; provider?: string }

function Empty({ text }: { text: string }) {
  return <div className="skills-empty">{text}</div>
}

export default function PluginsView() {
  const t = useT()
  const navigate = useNavigate()
  const location = useLocation()
  const locationState = (location.state ?? null) as PluginsLocationState | null

  const { plugins, loading, loadError, mcpRevision, incrementMcpRevision, reload } = usePluginsData()
  const { filter, setFilter, search, setSearch, visiblePlugins } = usePluginFilter(plugins)
  
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Plugin | null>(null)
  const [status, setStatus] = useTransientStatus(3500)
  
  const { form, setForm, resetForm, startPluginChat, startPluginWizard } = usePluginEditor(setFormOpen, setEditing, setStatus)

  useEffect(() => {
    if (!locationState?.selectPluginId) return
    setSelectedId(locationState.selectPluginId)
  }, [locationState?.selectPluginId])

  const selected = plugins.find(plugin => plugin.id === selectedId) ?? null

  const openInstructionsEditor = (plugin?: Plugin) => {
    setEditing(plugin ?? null)
    setFormOpen(true)
    setStatus('')
    if (!plugin) { resetForm(); return }
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
    const manifest = {
      ...(editing?.manifest as unknown as Record<string, unknown> | undefined),
      name: form.name,
      slug,
      version,
      description: form.description,
      category: form.category,
      instructions: form.instructions,
      permissions: existing?.permissions ?? [],
      capabilities: existing?.capabilities ?? ['prompt'],
    }

    try {
      if (editing) {
        // Need to pass the original plugin object props if expected by IPC
        // BUT updatePlugin expects { manifest } in this app version
        await updatePlugin(editing.id, { name: form.name, version, category: form.category, manifest })
      }
      setFormOpen(false)
      await reload()
      setStatus(editing ? `${form.name} a été mis à jour.` : `${form.name} a été créé.`)
    } catch (error) {
      setStatus(errorMessage(error))
    }
  }

  const changeEnabled = async (plugin: Plugin, enable: boolean) => {
    setTogglingId(plugin.id)
    try {
      await togglePlugin(plugin.id, enable)
      await reload()
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setTogglingId(null)
    }
  }

  const removePlugin = async (plugin: Plugin) => {
    try {
      await deletePlugin(plugin.id)
      setSelectedId(null)
      await reload()
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
      await reload()
      setSelectedId(imported.id)
      setStatus(`${imported.name} a été importé.`)
    } catch (error) {
      setStatus(errorMessage(error))
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="topbar titlebar-drag" data-tauri-drag-region>
        <strong>{t('plugins.title')}</strong>
        <div className="titlebar-no-drag" style={{ marginLeft: 'auto', display: 'flex', gap: 7 }}>
          <button type="button" className="secondary-btn" onClick={() => void importZip()}>Importer .zip</button>
          <button type="button" className="secondary-btn" onClick={startPluginWizard}>Assistant guidé</button>
          <button className="btn-primary" onClick={startPluginChat}>+ Nouveau plugin</button>
        </div>
      </div>

      <div className="extensions-content">
        <LoadErrorBanner error={loadError} onRetry={() => { void reload() }} fallback={t('plugins.loadFailed')} />
        <div className={`skills-workspace ${selected ? 'has-panel' : ''}`}>
          <section className="skills-browser">
            <div className="skills-toolbar">
              <div><h2>Vos plugins</h2><small>{plugins.filter(isEnabled).length} activés sur {plugins.length}</small></div>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['all', 'enabled', 'disabled'] as const).map(value => (
                  <button className={`filter-pill ${filter === value ? 'active' : ''}`} key={value} onClick={() => setFilter(value)}>
                    {value === 'all' ? 'Tous' : value === 'enabled' ? 'Activés' : 'Désactivés'}
                  </button>
                ))}
              </div>
            </div>
            <div className="skill-search-wrap"><span aria-hidden="true">⌕</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Rechercher un plugin" aria-label="Rechercher un plugin" /></div>
            <p className="skills-help">« + Nouveau plugin » ouvre le chat : décrivez l’idée, Bob génère le bundle. L’assistant guidé et l’import .zip restent optionnels. Le badge <strong>Intégré</strong> marque les plugins natifs — ils ne peuvent pas être supprimés.</p>
            <div className="skills-list">
              {loadError ? null : loading ? <Empty text="Chargement…" /> : visiblePlugins.length === 0 ? <Empty text={plugins.length ? t('plugins.noneFound') : t('plugins.empty')} /> : visiblePlugins.map(plugin => {
                const enabled = isEnabled(plugin)
                const canDelete = !isProtectedBuiltin(plugin)
                return (
                  <div className={`skill-list-row ${selectedId === plugin.id ? 'selected' : ''} ${enabled ? '' : 'disabled'}`} key={plugin.id}>
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
                )
              })}
            </div>
          </section>

          {selected && (
            <PluginDetail
              plugin={selected}
              mcpRevision={mcpRevision}
              toggling={togglingId === selected.id}
              openCommissioning={Boolean(locationState?.openCommissioning && locationState.selectPluginId === selected.id)}
              onClose={() => setSelectedId(null)}
              onToggle={enabled => void changeEnabled(selected, enabled)}
              onEdit={() => openEditor(selected)}
              onDelete={() => void removePlugin(selected)}
              onStatus={setStatus}
              onOpenIntegrations={(opts?: OpenIntegrationsOpts) => navigate('/integrations', { state: { tab: opts?.tab ?? 'integrations', highlight: opts?.highlight ?? opts?.provider } })}
              onUseSchedule={(template: any) => navigate('/schedules', { state: { pluginTemplate: { ...template, pluginId: selected.id, pluginName: selected.name } } })}
              onVersionChanged={async (message: string, expectedVersion?: string) => {
                const next = await reload()
                incrementMcpRevision()
                const refreshed = next.find((item: Plugin) => item.id === selected.id)
                if (expectedVersion && refreshed && refreshed.version !== expectedVersion) {
                  setStatus(`${refreshed.name} est resté en version ${refreshed.version} (retour à ${expectedVersion} non appliqué).`)
                  return
                }
                setStatus(message)
              }}
            />
          )}
        </div>
      </div>

      <PluginEditorModal
        formOpen={formOpen}
        editing={editing}
        form={form}
        setFormOpen={setFormOpen}
        setForm={setForm}
        onSave={save}
      />
      {status && <div className="settings-status">{status}</div>}
    </div>
  )
}
