import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  importBobModeYaml,
  installBobMode,
  listModeMarketplace,
  uninstallBobMode,
} from '../lib/ipc'
import { LoadErrorBanner } from '../components/LoadErrorBanner'
import { errorMessage } from '../lib/errorMessage'
import type { ModeCatalogEntry } from '@bob-work/shared-types'
import { useT } from '../i18n'
import { ModalOverlay, ModalPanel } from '../components/ModalOverlay'
import { useAppDialog } from '../components/AppDialog'

const DOCS_URL = 'https://bob.ibm.com/docs/shell/configuration/custom-modes-bobshell'

const CREATE_MODE_PROMPT =
  'Crée avec moi un mode Bob Shell personnalisé (pas un skill ni un plugin).\n\n'
  + 'Format cible : entrée YAML dans `~/.bob/settings/custom_modes.yaml` sous `customModes:` '
  + 'avec `slug`, `name`, `description`, `roleDefinition`, `whenToUse`, `customInstructions`, `groups`.\n\n'
  + 'Demande-moi l’objectif, les outils autorisés (read / edit / command / mcp / browser) et les règles de sécurité. '
  + 'Après validation, écris le fichier localement (fusionne sans écraser les autres modes) '
  + 'et dis-moi de rafraîchir la page Modes pour le voir dans le sélecteur du composer.'

export default function ModesView({ embedded = false }: { embedded?: boolean }) {
  const t = useT()
  const dialog = useAppDialog()
  const navigate = useNavigate()
  const [modes, setModes] = useState<ModeCatalogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [search, setSearch] = useState('')
  const [busySlug, setBusySlug] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importYaml, setImportYaml] = useState('')
  const statusTimerRef = useRef<number | null>(null)

  const load = async () => {
    setLoadError(null)
    try {
      const next = await listModeMarketplace()
      setModes(next)
      return next
    } catch (error) {
      setLoadError(error)
      return []
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  useEffect(() => {
    if (!status) return
    if (statusTimerRef.current) window.clearTimeout(statusTimerRef.current)
    statusTimerRef.current = window.setTimeout(() => setStatus(''), 3500)
    return () => {
      if (statusTimerRef.current) window.clearTimeout(statusTimerRef.current)
    }
  }, [status])

  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    if (!query) return modes
    return modes.filter(mode =>
      `${mode.name} ${mode.description ?? ''} ${mode.slug} ${mode.groups.join(' ')}`
        .toLocaleLowerCase()
        .includes(query),
    )
  }, [modes, search])

  const installed = visible.filter(mode => mode.installed)
  const catalog = visible.filter(mode => mode.catalog && !mode.installed)

  const install = async (slug: string) => {
    setBusySlug(slug)
    setStatus('')
    try {
      const mode = await installBobMode(slug)
      await load()
      window.dispatchEvent(new Event('bob-modes-updated'))
      setStatus(`Mode « ${mode.name} » installé. Disponible dans le sélecteur du composer.`)
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setBusySlug(null)
    }
  }

  const uninstall = async (mode: ModeCatalogEntry) => {
    if (mode.builtin) return
    if (!await dialog.confirm({ message: t('modes.uninstallConfirm', { name: mode.name }), confirmLabel: t('modes.uninstall'), destructive: true })) return
    setBusySlug(mode.slug)
    setStatus('')
    try {
      await uninstallBobMode(mode.slug)
      await load()
      window.dispatchEvent(new Event('bob-modes-updated'))
      setStatus(`Mode « ${mode.name} » retiré.`)
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setBusySlug(null)
    }
  }

  const importYamlMode = async () => {
    setBusySlug('import')
    setStatus('')
    try {
      const mode = await importBobModeYaml(importYaml)
      setImportOpen(false)
      setImportYaml('')
      await load()
      window.dispatchEvent(new Event('bob-modes-updated'))
      setStatus(`Mode « ${mode.name} » importé.`)
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setBusySlug(null)
    }
  }

  const renderCard = (mode: ModeCatalogEntry) => {
    const busy = busySlug === mode.slug
    return (
      <div className="mode-card" key={`${mode.source}:${mode.slug}`}>
        <div className="mode-card-main">
          <strong>{mode.name}</strong>
          <small>{mode.slug}</small>
          <p>{mode.description || 'Aucune description.'}</p>
          <div className="mode-card-meta">
            {mode.builtin ? <span className="skill-builtin-badge">Intégré</span> : null}
            {mode.catalog ? <span className="mode-catalog-badge">Catalogue</span> : null}
            {mode.groups.map(group => (
              <span key={group} className="mode-group-chip">{group}</span>
            ))}
          </div>
        </div>
        <div className="mode-card-actions">
          {mode.installed ? (
            mode.builtin ? (
              <span className="mode-card-hint">Toujours disponible</span>
            ) : (
              <button
                type="button"
                className="secondary-btn"
                disabled={busy}
                onClick={() => void uninstall(mode)}
              >
                Retirer
              </button>
            )
          ) : (
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => void install(mode.slug)}
            >
              {busy ? '…' : 'Télécharger'}
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={embedded ? 'modes-settings-panel' : undefined} style={embedded ? undefined : { display: 'flex', flexDirection: 'column', height: '100%' }}>
      {embedded ? null : (
        <div className="topbar titlebar-drag" data-tauri-drag-region>
          <strong>{t('modes.title')}</strong>
        </div>
      )}
      <LoadErrorBanner
        error={loadError}
        onRetry={() => { setLoading(true); void load() }}
        fallback={t('modes.loadFailed')}
      />
      <div className="extensions-content">
        <div className="skills-workspace">
          <section className="skills-browser">
            <div className="skills-toolbar">
              <div>
                {embedded ? null : <h2>{t('modes.title')}</h2>}
                <small>
                  {modes.filter(m => m.installed && !m.builtin).length} personnalisés ·{' '}
                  {modes.filter(m => m.catalog && !m.installed).length} à installer
                </small>
              </div>
              <div className="modes-toolbar-actions">
                <button className="secondary-btn" type="button" onClick={() => setImportOpen(true)}>
                  Importer YAML
                </button>
                <button
                  className="btn-primary"
                  type="button"
                  onClick={() => navigate('/chat', { state: { initialPrompt: CREATE_MODE_PROMPT } })}
                >
                  + Créer avec Bob
                </button>
              </div>
            </div>
            <div className="skill-search-wrap">
              <span aria-hidden="true">⌕</span>
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder={t('modes.searchPlaceholder')}
                aria-label={t('modes.searchPlaceholder')}
              />
            </div>
            <p className="skills-help">
              Les modes IBM Bob Shell sont des profils YAML (`customModes`) : outils autorisés + consignes.
              Bob Work propose un catalogue local (exemples docs IBM) à écrire dans{' '}
              <code>~/.bob/settings/custom_modes.yaml</code>. Il n’existe pas d’API marketplace distante IBM —
              télécharger = installer le YAML localement.{' '}
              <a href={DOCS_URL} target="_blank" rel="noreferrer">Documentation custom modes</a>
            </p>

            {loadError ? null : loading ? (
              <div className="settings-section-loader" role="status" aria-live="polite">
                <span className="task-spinner" aria-hidden="true" />
                {t('common.loading')}
              </div>
            ) : (
              <>
                <h3 className="modes-section-title">{t('modes.installed')}</h3>
                <div className="modes-grid">
                  {installed.length === 0 ? (
                    <div className="task-empty">{t('modes.emptyInstalled')}</div>
                  ) : (
                    installed.map(renderCard)
                  )}
                </div>

                <h3 className="modes-section-title">{t('modes.catalog')}</h3>
                <div className="modes-grid">
                  {catalog.length === 0 ? (
                    <div className="task-empty">{t('modes.emptyCatalog')}</div>
                  ) : (
                    catalog.map(renderCard)
                  )}
                </div>
              </>
            )}
          </section>
        </div>
        {status && <div className="settings-status">{status}</div>}
      </div>

      {importOpen && (
        <ModalOverlay onClose={() => setImportOpen(false)}>
          <ModalPanel className="plugin-editor-modal" aria-labelledby="mode-import-title">
            <h2 id="mode-import-title">Importer un mode YAML</h2>
            <p className="skills-help">
              Collez un objet mode (`slug`, `name`, …) ou un bloc <code>customModes:</code>.
            </p>
            <textarea
              rows={14}
              value={importYaml}
              onChange={event => setImportYaml(event.target.value)}
              placeholder={"slug: mon-mode\nname: Mon mode\ngroups:\n  - read"}
              aria-label="YAML du mode"
            />
            <div className="skill-panel-actions">
              <button
                className="btn-primary"
                type="button"
                disabled={!importYaml.trim() || busySlug === 'import'}
                onClick={() => void importYamlMode()}
              >
                Installer
              </button>
              <button className="secondary-btn" type="button" onClick={() => setImportOpen(false)}>
                Annuler
              </button>
            </div>
          </ModalPanel>
        </ModalOverlay>
      )}
    </div>
  )
}
