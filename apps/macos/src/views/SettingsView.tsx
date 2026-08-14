import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { open as openUrl } from '@tauri-apps/plugin-shell'
import { open as chooseFile, save as chooseSavePath } from '@tauri-apps/plugin-dialog'
import { listen } from '@tauri-apps/api/event'
import { relaunch } from '@tauri-apps/plugin-process'
import { useNavigate, useLocation } from 'react-router-dom'
import { bobAuthService, resolveSessionApiKeyStatus } from '../services/BobAuthService'
import { useAppStore } from '../stores/appStore'
import { errorMessage } from '../lib/errorMessage'
import {
  DEFAULT_APP_SETTINGS,
  getBobProfile, getPermissionGrants, getSettings, peekCachedSettings, getUsageStatus,
  getBobAuthSnapshot,
  hasSessionSecret,
  revokePermissionGrant, updateSettings, importConversations, exportConversations,
  openMacosPrivacyPane, getChromeControlStatus, getComputerUseStatus, testMcpServer,
  getNotificationAuthState, isNotificationAuthGranted, requestNotificationAuthorization,
  requestAccessibilityPermission, requestChromeAutomationPermission,
  installBobShell, openDataDir, exportDiagnostics, purgeAppCache,
  createDatabaseBackup, listDatabaseBackups, restoreDatabaseBackup, type DatabaseBackup,
  checkForUpdates, installAvailableUpdate, type UpdateCheckResult,
} from '../lib/ipc'
import type { AppSettings, BobAuthSnapshot, MacosChromeControlStatus, MacosComputerUseStatus, PermissionGrant, PluginMcpTestResult, ShellProfile, UsageStatus } from '@bob-work/shared-types'
import { UsageMeter } from '../components/UsageMeter/UsageMeter'
import { LoadErrorBanner } from '../components/LoadErrorBanner'
import { useT } from '../i18n'
import ModesView from './ModesView'
import { useAppDialog } from '../components/AppDialog'

const BobalyticsPanel = lazy(() => import('./BobalyticsPanel'))

type Tab = 'general' | 'bob' | 'instructions' | 'permissions' | 'tasks' | 'extensions' | 'modes' | 'appearance' | 'data'

function initialSettings(): AppSettings {
  return peekCachedSettings() ?? useAppStore.getState().settings ?? DEFAULT_APP_SETTINGS
}

export default function SettingsView() {
  const t = useT()
  const dialog = useAppDialog()
  const location = useLocation()
  const initialTab = (location.state as { tab?: Tab } | null)?.tab
  const [tab, setTab] = useState<Tab>(initialTab ?? 'general')

  useEffect(() => {
    const next = (location.state as { tab?: Tab } | null)?.tab
    if (next) setTab(next)
  }, [location.state])


  const [settings, setSettings] = useState<AppSettings>(initialSettings)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [settingsHydrated, setSettingsHydrated] = useState(
    () => Boolean(peekCachedSettings() ?? useAppStore.getState().settings),
  )
  const settingsDirtyRef = useRef(false)
  const [profile, setProfile] = useState<ShellProfile | null>(null)
  const [authSnapshot, setAuthSnapshot] = useState<BobAuthSnapshot | null>(() => {
    const info = useAppStore.getState().bobInfo
    if (!info) return null
    return {
      found: info.found,
      path: info.path,
      version: info.version,
      authenticated: info.authenticated,
      authenticationMethod: info.authenticated ? 'sso_session_detected' : 'required',
    }
  })
  const [profileLoading, setProfileLoading] = useState(() => !useAppStore.getState().bobInfo)
  const [usage, setUsage] = useState<UsageStatus | null>(null)
  const [databaseBackups, setDatabaseBackups] = useState<DatabaseBackup[]>([])
  const [usageLoading, setUsageLoading] = useState(true)
  const [grants, setGrants] = useState<PermissionGrant[]>([])
  const [grantsLoading, setGrantsLoading] = useState(true)
  const [grantsError, setGrantsError] = useState<unknown>(null)
  const [apiKey, setApiKey] = useState('')
  const [sessionKeyStatus, setSessionKeyStatus] = useState({ active: false, source: 'none' as 'session' | 'environment' | 'sso' | 'none', vaultKeyPresent: false })
  const [status, setStatus] = useState('')
  const [settingsSearch, setSettingsSearch] = useState('')
  const [exportFormat, setExportFormat] = useState<'chatgpt' | 'claude-cowork' | 'bob-work-export-v1'>('chatgpt')
  const [chromeStatus, setChromeStatus] = useState<MacosChromeControlStatus | null>(null)
  const [chromeLoading, setChromeLoading] = useState(false)
  const [chromeError, setChromeError] = useState<unknown>(null)
  const [computerUseStatus, setComputerUseStatus] = useState<MacosComputerUseStatus | null>(null)
  const [computerUseLoading, setComputerUseLoading] = useState(false)
  const [computerUseError, setComputerUseError] = useState<unknown>(null)
  const [computerUseTools, setComputerUseTools] = useState<PluginMcpTestResult | null>(null)
  const [chromeTools, setChromeTools] = useState<PluginMcpTestResult | null>(null)
  const [notificationBundleHint, setNotificationBundleHint] = useState('')
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [bobExtrasReady, setBobExtrasReady] = useState(false)
  const navigate = useNavigate()
  const { setBobStatus, setBobInfo } = useAppStore()
  const skipNextSaveRef = useRef(true)
  const saveTimerRef = useRef<number | null>(null)
  const pendingSaveRef = useRef<AppSettings | null>(null)
  const saveInFlightRef = useRef(false)
  const latestSettingsRef = useRef<AppSettings>(settings)
  const lastPersistedSettingsRef = useRef<AppSettings>(initialSettings())
  const statusTimerRef = useRef<number | null>(null)

  const tabs = useMemo(() => [
    { id: 'general' as const, label: t('settings.tabGeneral'), keywords: 'mode démarrage ouverture session barre menus notifications système enable disable activer désactiver' },
    { id: 'bob' as const, label: t('settings.tabBob'), keywords: 'clé api inférence session temporaire consommation crédits installation authentification bobalytics bobcoins adoption' },
    { id: 'instructions' as const, label: t('settings.tabInstructions'), keywords: 'prompt défaut personnalisées consignes projet réponse contexte conversations mémoire cross chatgpt' },
    { id: 'permissions' as const, label: t('settings.tabPermissions'), keywords: 'autorisations approbation fichiers terminal réseau applications révoquer sandbox bac à sable' },
    { id: 'tasks' as const, label: t('settings.tabTasks'), keywords: 'planification historique coût tours limites rétention réveil' },
    { id: 'extensions' as const, label: t('settings.tabExtensions'), keywords: 'extensions accès contrôle mcp intégrations plugins skills sous-agents subagents orchestrateur web ordinateur chrome accessibilité automatisation' },
    { id: 'modes' as const, label: t('settings.tabModes'), keywords: 'modes bob shell catalogue custom_modes yaml agent plan ask télécharger installer importer' },
    { id: 'appearance' as const, label: t('settings.tabAppearance'), keywords: 'thème clair sombre dark light français english español taille texte dictée animations' },
    { id: 'data' as const, label: t('settings.tabData'), keywords: 'import export conversations chatgpt claude cowork télémétrie diagnostic dossier cache purge nettoyer' },
  ], [t])

  const checkUpdate = async () => {
    setUpdateBusy(true)
    try {
      const result = await checkForUpdates()
      setUpdateInfo(result)
      setStatus(result.available
        ? t('settings.updateAvailable', { version: result.version ?? '' })
        : t('settings.updateCurrent'))
    } catch (error) {
      setStatus(errorMessage(error, t('settings.updateCheckFailed')))
    } finally {
      setUpdateBusy(false)
    }
  }

  const installUpdate = async () => {
    setUpdateBusy(true)
    setStatus(t('settings.updateInstalling'))
    try {
      await installAvailableUpdate()
    } catch (error) {
      setStatus(errorMessage(error, t('settings.updateInstallFailed')))
      setUpdateBusy(false)
    }
  }

  const visibleTabs = useMemo(() => {
    const query = normalizeSettingsSearch(settingsSearch)
    if (!query) return tabs
    return tabs.filter(item => normalizeSettingsSearch(`${item.label} ${item.keywords}`).includes(query))
  }, [settingsSearch, tabs])

  useEffect(() => {
    if (tab !== 'data') return
    void listDatabaseBackups()
      .then(setDatabaseBackups)
      .catch(error => setStatus(errorMessage(error)))
  }, [tab])

  const refreshProfile = async (announce = false, forceUsage = announce) => {
    // Soft refresh: keep existing rows visible instead of blanking the Bob tab.
    if (announce || !authSnapshot) setProfileLoading(true)
    if (announce || usage === null) setUsageLoading(true)
    if (announce || grantsLoading) setGrantsLoading(true)
    const startedAt = Date.now()

    const snapshotPromise = Promise.all([
      getBobAuthSnapshot().catch(() => null),
      hasSessionSecret('ibm_api_key').catch(() => false),
    ]).then(([nextSnapshot, sessionActive]) => {
      setAuthSnapshot(nextSnapshot)
      setSessionKeyStatus(resolveSessionApiKeyStatus(nextSnapshot, sessionActive))
      if (nextSnapshot) {
        setBobInfo({
          found: nextSnapshot.found,
          path: nextSnapshot.path,
          version: nextSnapshot.version,
          authenticated: nextSnapshot.authenticated,
        })
        setBobStatus(!nextSnapshot.found ? 'not_found' : !nextSnapshot.authenticated ? 'unauthenticated' : 'ready')
      }
      return { snapshot: nextSnapshot, vaultFromIpc: sessionActive }
    })

    // Cached usage on open; force only on explicit refresh. Avoid blocking Settings with gateway round-trips.
    const usagePromise = getUsageStatus(forceUsage)
      .catch(() => null)
      .then(nextUsage => {
        setUsage(nextUsage)
        return nextUsage
      })
      .finally(() => setUsageLoading(false))
    const grantsPromise = getPermissionGrants()
      .then(nextGrants => {
        setGrants(nextGrants)
        setGrantsError(null)
        return nextGrants
      })
      .catch(error => {
        setGrantsError(error)
        return [] as PermissionGrant[]
      })
      .finally(() => setGrantsLoading(false))

    let snapshot: BobAuthSnapshot | null = null
    let vaultFromIpc = false
    try {
      const auth = await snapshotPromise
      snapshot = auth.snapshot
      vaultFromIpc = auth.vaultFromIpc
    } finally {
      if (announce) {
        const elapsed = Date.now() - startedAt
        if (elapsed < 450) await new Promise(resolve => window.setTimeout(resolve, 450 - elapsed))
      }
      setProfileLoading(false)
    }

    // Defer slow `bob` CLI profile probe so the shell paints first.
    void Promise.all([usagePromise, grantsPromise])
    const nextProfile = await getBobProfile().catch(() => null)
    setProfile(nextProfile)
    const methodSource = nextProfile
      ? {
          authenticated: nextProfile.detection.authenticated,
          authenticationMethod: nextProfile.authenticationMethod,
        }
      : snapshot
    setSessionKeyStatus(resolveSessionApiKeyStatus(methodSource, vaultFromIpc))
    if (announce) showTransientStatus('Vérification terminée')
    return nextProfile
  }

  const installationFound = profile?.detection.found ?? authSnapshot?.found ?? false
  const installationLabel = installationFound
    ? `Bob Shell ${profile?.detection.version ?? authSnapshot?.version ?? ''}`.trim()
    : profileLoading ? 'Vérification…' : 'Non installé'
  const authReady = sessionKeyStatus.active
    || profile?.detection.authenticated
    || authSnapshot?.authenticated
    || false
  const authMethod = profile?.authenticationMethod
    ?? authSnapshot?.authenticationMethod
    ?? (sessionKeyStatus.source === 'environment'
      ? 'api_key_environment'
      : sessionKeyStatus.source === 'sso'
        ? 'sso_session_detected'
        : sessionKeyStatus.source === 'session'
          ? 'api_key_session'
          : 'required')

  useEffect(() => {
    // Prefer cached settings for first paint; revalidate in the background.
    const hadCache = Boolean(peekCachedSettings())
    getSettings({ force: hadCache })
      .then(next => {
        if (!settingsDirtyRef.current) {
          skipNextSaveRef.current = true
          latestSettingsRef.current = next
          setSettings(next)
          useAppStore.getState().setSettings(next)
        }
        setSettingsError(null)
        setSettingsHydrated(true)
      })
      .catch(error => {
        setSettingsHydrated(true)
        if (!hadCache && !settingsDirtyRef.current) setSettingsError(String(error))
      })
    // Defer Bob/CLI probes until after the settings shell paints.
    const idle = window.setTimeout(() => { void refreshProfile() }, 0)
    return () => window.clearTimeout(idle)
  }, [])

  useEffect(() => {
    if (tab !== 'bob') {
      setBobExtrasReady(false)
      return
    }
    // Paint Bob Shell cards first; mount Bobalytics on the next frame.
    const id = window.requestAnimationFrame(() => setBobExtrasReady(true))
    return () => window.cancelAnimationFrame(id)
  }, [tab])

  useEffect(() => {
    getNotificationAuthState()
      .then(state => {
        setNotificationBundleHint(state === 'unavailable' ? t('settings.notificationsUnavailable') : '')
      })
      .catch(() => setNotificationBundleHint(''))
  }, [t])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | null = null
    listen<UsageStatus>('usage-updated', event => {
      if (!disposed) setUsage(event.payload)
    }).then(fn => {
      if (disposed) fn(); else unlisten = fn
    })
    return () => { disposed = true; unlisten?.() }
  }, [])

  useEffect(() => {
    if (!settingsSearch.trim() || visibleTabs.some(item => item.id === tab)) return
    if (visibleTabs[0]) setTab(visibleTabs[0].id)
  }, [settingsSearch, tab, visibleTabs])

  useEffect(() => {
    if (tab !== 'extensions') return
    setChromeLoading(true)
    setComputerUseLoading(true)
    setChromeError(null)
    setComputerUseError(null)
    getChromeControlStatus()
      .then(status => {
        setChromeError(null)
        setChromeStatus(status)
      })
      .catch(error => {
        setChromeStatus(null)
        setChromeError(error)
      })
      .finally(() => setChromeLoading(false))
    getComputerUseStatus()
      .then(status => {
        setComputerUseError(null)
        setComputerUseStatus(status)
      })
      .catch(error => {
        setComputerUseStatus(null)
        setComputerUseError(error)
      })
      .finally(() => setComputerUseLoading(false))
    if (settings?.computerUseEnabled) {
      testMcpServer('bob-work-computer-use').then(setComputerUseTools).catch(() => setComputerUseTools(null))
    } else {
      setComputerUseTools(null)
    }
    if (settings?.chromeControlEnabled) {
      testMcpServer('bob-work-chrome-control').then(setChromeTools).catch(() => setChromeTools(null))
    } else {
      setChromeTools(null)
    }
  }, [tab, settings?.chromeControlEnabled, settings?.computerUseEnabled])

  const refreshChromeStatus = async () => {
    setChromeLoading(true)
    setChromeError(null)
    try {
      setChromeStatus(await getChromeControlStatus())
      setChromeError(null)
    } catch (error) {
      setChromeStatus(null)
      setChromeError(error)
    }
    finally { setChromeLoading(false) }
  }

  const refreshComputerUseStatus = async () => {
    setComputerUseLoading(true)
    setComputerUseError(null)
    try {
      setComputerUseStatus(await getComputerUseStatus())
      setComputerUseError(null)
    } catch (error) {
      setComputerUseStatus(null)
      setComputerUseError(error)
    }
    finally { setComputerUseLoading(false) }
  }

  const showTransientStatus = useCallback((message: string) => {
    setStatus(message)
    if (statusTimerRef.current) window.clearTimeout(statusTimerRef.current)
    statusTimerRef.current = window.setTimeout(() => setStatus(''), 2500)
  }, [])

  const persistSettings = useCallback(async (nextSettings: AppSettings) => {
    try {
      const toSave = nextSettings
      if (nextSettings.notificationsEnabled && !lastPersistedSettingsRef.current.notificationsEnabled) {
        try {
          let state = await getNotificationAuthState()
          if (state === 'unavailable') {
            setNotificationBundleHint(t('settings.notificationsUnavailable'))
          } else if (!isNotificationAuthGranted(state)) {
            state = await requestNotificationAuthorization()
            if (!isNotificationAuthGranted(state) && state === 'denied') {
              void openMacosPrivacyPane('notifications').catch(() => undefined)
            }
          }
        } catch {
          /* tauri dev / no .app: UN unavailable — still persist in-app toggle */
          setNotificationBundleHint(t('settings.notificationsUnavailable'))
        }
      }
      await updateSettings(toSave)
      lastPersistedSettingsRef.current = toSave
      window.dispatchEvent(new CustomEvent('bob-settings-updated', { detail: toSave }))
      showTransientStatus(t('settings.saved'))
    } catch (error) { setStatus(String(error)) }
  }, [showTransientStatus, t])

  const enqueueSettingsSave = useCallback((nextSettings: AppSettings) => {
    // Full snapshots are persisted, so intermediate snapshots must be
    // coalesced. Otherwise a burst of controls can leave many stale writes in
    // front of the latest value (and make the UI appear not to save).
    pendingSaveRef.current = nextSettings
    if (saveInFlightRef.current) return
    saveInFlightRef.current = true
    void (async () => {
      try {
        while (pendingSaveRef.current) {
          const pending = pendingSaveRef.current
          pendingSaveRef.current = null
          await persistSettings(pending)
        }
      } finally {
        saveInFlightRef.current = false
        // A setting may have changed between the loop condition and finally.
        const pending = pendingSaveRef.current
        if (pending) enqueueSettingsSave(pending)
      }
    })()
  }, [persistSettings])

  useEffect(() => {
    if (!settingsHydrated) return
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false
      return
    }
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      enqueueSettingsSave(settings)
    }, 400)
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    }
  }, [settings, settingsHydrated, enqueueSettingsSave])

  const change = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    settingsDirtyRef.current = true
    // Selects can fire twice before React commits a render (notably theme then
    // language). Build from the latest user intent so the second save cannot
    // restore a stale value from the previous render.
    const next = { ...latestSettingsRef.current, [key]: value }
    latestSettingsRef.current = next
    setSettings(next)
    if (key === 'theme') applyTheme(String(value))
    if (key === 'theme' || key === 'language') {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
      enqueueSettingsSave(next)
    }
  }

  const install = async () => {
    setStatus('Téléchargement et vérification SHA-256 de Bob Shell…')
    try { await installBobShell(); setStatus('Bob Shell installé.'); await refreshProfile() }
    catch (error) { setStatus(`Installation impossible : ${String(error)}`) }
  }

  const saveKey = async () => {
    if (!apiKey.trim()) return
    try {
      await bobAuthService.setSessionApiKey(apiKey.trim())
      setApiKey('')
      setStatus('Clé IBM Bob enregistrée dans le coffre local chiffré.')
      await refreshProfile()
    } catch (error) { setStatus(errorMessage(error)) }
  }

  const loadingLabel = t('common.loading')

  return (
    <div className="settings-shell">
      <div
        className="titlebar-drag"
        data-tauri-drag-region
        aria-hidden="true"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 52, zIndex: 1 }}
      />
      <nav className="settings-nav">
        <h2>{t('settings.title')}</h2>
        <div className="settings-search">
          <span aria-hidden="true">⌕</span>
          <input autoComplete="off" aria-label={t('settings.searchPlaceholder')} placeholder={t('settings.searchPlaceholder')} value={settingsSearch} onChange={event => setSettingsSearch(event.target.value)} />
          {settingsSearch && <button aria-label={t('settings.clearSearch')} onClick={() => setSettingsSearch('')}>×</button>}
        </div>
        {visibleTabs.map(item => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>{item.label}</button>)}
        {visibleTabs.length === 0 && <p className="settings-search-empty">{t('settings.searchEmpty')}</p>}
      </nav>
      <main className="settings-content">
        {settingsError && <p className="settings-note" role="alert">{settingsError}</p>}
        <div style={{ display: visibleTabs.length > 0 ? 'contents' : 'none' }}>
        {tab === 'general' && <>
          <Heading title={t('settings.generalHeading')} description={t('settings.generalDesc')} />
          <Card>
            <SettingsFields settings={settings} error={null} loadingLabel={loadingLabel}>
              {s => <>
                <SelectRow title={t('settings.defaultMode')} description={t('settings.defaultModeDesc')} value={s.defaultMode} onChange={value => change('defaultMode', value)}>
                  <option value="agent">Agent</option><option value="plan">Plan</option><option value="ask">Ask</option>
                  {profile?.modes.filter(mode => !['agent', 'plan', 'ask'].includes(mode.slug)).map(mode => <option key={mode.slug} value={mode.slug}>{mode.name}</option>)}
                </SelectRow>
                <ToggleRow title={t('settings.launchAtLogin')} description={t('settings.launchAtLoginDesc')} value={s.launchAtLogin} onChange={value => change('launchAtLogin', value)} />
                <ToggleRow title={t('settings.menuBarIcon')} description={t('settings.menuBarIconDesc')} value={s.menuBarEnabled} onChange={value => change('menuBarEnabled', value)} />
              </>}
            </SettingsFields>
          </Card>
          <Heading title={t('settings.updatesHeading')} description={t('settings.updatesDesc')} />
          <Card>
            {updateInfo && (
              <StatusRow
                title={t('settings.currentVersion')}
                value={updateInfo.currentVersion}
                ok={!updateInfo.available}
              />
            )}
            {updateInfo?.available && (
              <>
                <StatusRow title={t('settings.availableVersion')} value={updateInfo.version ?? '—'} ok />
                {updateInfo.notes && <p className="settings-note">{updateInfo.notes}</p>}
              </>
            )}
            <div className="settings-actions">
              <button className="secondary-btn" disabled={updateBusy} onClick={() => void checkUpdate()}>
                {updateBusy ? t('common.loading') : t('settings.checkUpdates')}
              </button>
              {updateInfo?.available && (
                <button className="btn-primary" disabled={updateBusy} onClick={() => void installUpdate()}>
                  {t('settings.installAndRestart')}
                </button>
              )}
            </div>
          </Card>
          <Heading title={t('settings.notificationsHeading')} description={t('settings.notificationsDesc')} />
          <Card>
            <SettingsFields settings={settings} error={settingsError} loadingLabel={loadingLabel}>
              {s => <>
                <ToggleRow
                  title={t('settings.notificationsEnabled')}
                  description={t('settings.notificationsEnabledDesc')}
                  value={s.notificationsEnabled}
                  onChange={value => change('notificationsEnabled', value)}
                />
                <ToggleRow
                  title={t('settings.notifyTaskComplete')}
                  description={t('settings.notifyTaskCompleteDesc')}
                  value={s.notifyTaskComplete}
                  onChange={value => change('notifyTaskComplete', value)}
                  disabled={!s.notificationsEnabled}
                />
                <p className="settings-note">{t('settings.notificationsHint')}</p>
                {notificationBundleHint && <p className="settings-note" role="status">{notificationBundleHint}</p>}
              </>}
            </SettingsFields>
          </Card>
        </>}

        {tab === 'bob' && <>
          <Heading title="IBM Bob Shell" description="Bob Work pilote l’installation locale et injecte la clé API uniquement dans le processus bob run." />
          {(usageLoading || usage?.available) && (
            <Card title="Consommation Bobcoins">
              {usageLoading ? (
                <SectionLoader label={loadingLabel} />
              ) : (
                <>
                  <UsageMeter usage={usage} />
                  {usage?.instanceLabel && <p className="settings-note">{usage.instanceLabel}</p>}
                </>
              )}
            </Card>
          )}
          <Card>
            <StatusRow title="Installation" value={installationLabel} ok={profileLoading ? undefined : installationFound} loading={profileLoading} />
            <StatusRow
              title="Authentification · bob run"
              value={authReady
                ? authenticationLabel(authMethod)
                : profileLoading ? 'Vérification…' : 'Authentification requise'}
              ok={profileLoading ? undefined : authReady}
              loading={profileLoading && !authReady}
            />
            <StatusRow title="Emplacement" value={profile?.detection.path ?? authSnapshot?.path ?? (profileLoading ? loadingLabel : '—')} loading={profileLoading && !profile && !authSnapshot} />
            <div className="settings-actions">
              {!installationFound && !profileLoading && <button type="button" className="btn-primary" onClick={install}>Installer la version officielle</button>}
              <button
                type="button"
                className="btn-primary"
                disabled={profileLoading}
                aria-busy={profileLoading}
                onClick={() => void refreshProfile(true)}
              >
                {profileLoading
                  ? <><span className="task-spinner" aria-hidden="true" />Vérification…</>
                  : 'Revérifier'}
              </button>
            </div>
          </Card>
          <Card title="Clé IBM Bob">
            <p className="settings-note">
              Si vous êtes déjà connecté à IBM Bob (IDE / Shell), Bob Work réutilise cette session pour <code>bob run</code> et les Bobcoins.
              Vous pouvez aussi enregistrer une clé d’inférence dans le coffre local chiffré (injection uniquement dans le processus <code>bob run</code>).
            </p>
            <StatusRow
              title="Coffre local"
              value={profileLoading ? loadingLabel : sessionKeyStatus.vaultKeyPresent ? 'Clé d’inférence présente' : 'Aucune clé enregistrée'}
              ok={profileLoading ? undefined : sessionKeyStatus.vaultKeyPresent}
              loading={profileLoading}
            />
            {!profileLoading && sessionKeyStatus.source === 'environment' && (
              <StatusRow title="Environnement" value="Clé fournie au lancement de l’app" ok />
            )}
            {!profileLoading && (sessionKeyStatus.source === 'sso' || (sessionKeyStatus.active && !sessionKeyStatus.vaultKeyPresent && sessionKeyStatus.source !== 'environment')) && (
              <StatusRow title="Session IBM Bob" value="SSO détectée (~/.bob/settings/auth-secrets.json)" ok />
            )}
            {sessionKeyStatus.vaultKeyPresent && <div className="settings-actions">
              <button className="danger-link" onClick={async () => { await bobAuthService.clearSessionApiKey(); setStatus('Clé effacée du coffre local.'); await refreshProfile() }}>Effacer du coffre</button>
            </div>}
            <div className="vault-secret-fields">
              <strong>
                {sessionKeyStatus.vaultKeyPresent
                  ? 'Remplacer la clé enregistrée'
                  : 'Enregistrer une clé IBM Bob'}
              </strong>
              <input type="password" aria-label={t('onboarding.apiKeyLabel')} value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={t('onboarding.apiKeyLabel')} />
              <button className="btn-primary" disabled={!apiKey.trim()} onClick={() => void saveKey()}>Enregistrer dans le coffre</button>
            </div>
            <button className="link-btn" onClick={() => openUrl('https://bob.ibm.com/')}>Ouvrir bob.ibm.com ↗</button>
          </Card>
          <div className="settings-warning">La clé et les jetons d’intégration restent disponibles après redémarrage de Bob Work tant qu’ils n’ont pas été effacés du coffre. Les planifications peuvent donc réutiliser ces secrets, y compris lorsque l’écran est verrouillé.</div>
          {!usageLoading && !usage?.available && (
            <Card title="Consommation Bobcoins">
              <UsageMeter usage={usage} />
              <p className="settings-note">{usage?.message ?? 'Indisponible'}</p>
              <div className="settings-actions">
                <button className="secondary-btn" onClick={() => void refreshProfile(false, true)}>Actualiser</button>
              </div>
            </Card>
          )}
          {!usageLoading && usage?.available && (
            <div className="settings-actions">
              <button className="secondary-btn" onClick={() => void refreshProfile(false, true)}>Actualiser la consommation</button>
            </div>
          )}
          {bobExtrasReady ? (
            <Suspense fallback={<SectionLoader label={loadingLabel} />}>
              <BobalyticsPanel />
            </Suspense>
          ) : (
            <SectionLoader label={loadingLabel} />
          )}
        </>}

        {tab === 'instructions' && <>
          <Heading title="Instructions personnalisées" description="Ajoutées localement au début de chaque demande, avant les instructions propres au projet." />
          <Card>
            <SettingsFields settings={settings} error={settingsError} loadingLabel={loadingLabel}>
              {s => (
                <textarea className="settings-textarea" rows={12} value={s.globalInstructions} onChange={event => change('globalInstructions', event.target.value)} placeholder="Ex. Répondre en français, citer les sources et demander confirmation avant un envoi externe…" />
              )}
            </SettingsFields>
          </Card>
          <Heading title={t('settings.contextHeading')} description={t('settings.contextDesc')} />
          <Card>
            <SettingsFields settings={settings} error={settingsError} loadingLabel={loadingLabel}>
              {s => <>
                <ToggleRow
                  title={t('settings.crossConversationContext')}
                  description={t('settings.crossConversationContextDesc')}
                  value={s.crossConversationContext}
                  onChange={value => change('crossConversationContext', value)}
                />
                <p className="settings-note">{t('settings.crossConversationContextHint')}</p>
              </>}
            </SettingsFields>
          </Card>
        </>}

        {tab === 'permissions' && <>
          <Heading title={t('settings.permissionsHeading')} description={t('settings.permissionsDesc')} />
          <Card>
            <SettingsFields settings={settings} error={settingsError} loadingLabel={loadingLabel}>
              {s => <>
                <ToggleRow
                  title={t('settings.sandboxMode')}
                  description={t('settings.sandboxModeDesc')}
                  value={s.sandboxMode}
                  onChange={value => change('sandboxMode', value)}
                />
                <SelectRow
                  title={t('settings.permissionPolicy')}
                  description={t('settings.permissionPolicyDesc')}
                  value={s.permissionPolicy}
                  onChange={value => change('permissionPolicy', value)}
                >
                  <option value="always_ask">{t('settings.policyAlwaysAsk')}</option>
                  <option value="ask_for_modifications">{t('settings.policyAskModifications')}</option>
                  <option value="ask_for_important">{t('settings.policyAskImportant')}</option>
                  <option value="never_ask">{t('settings.policyNeverAsk')}</option>
                </SelectRow>
                <p className="settings-note">{t('settings.permissionPolicyHint')}</p>
                <p className="settings-warning">{t('settings.scheduledPolicyHint')}</p>
              </>}
            </SettingsFields>
          </Card>
          <Card title={t('settings.macosPermissionsHeading')}>
            <p className="settings-note">{t('settings.macosPermissionsDesc')}</p>
            <div className="settings-actions">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => {
                  void (async () => {
                    try {
                      const current = await getNotificationAuthState()
                      if (current === 'unavailable') {
                        setStatus(t('settings.notificationsUnavailable'))
                        return
                      }
                      if (isNotificationAuthGranted(current)) {
                        await requestNotificationAuthorization()
                        showTransientStatus(t('settings.notificationsTestSent'))
                        return
                      }
                      const state = await requestNotificationAuthorization()
                      if (isNotificationAuthGranted(state)) {
                        showTransientStatus(t('settings.notificationsGranted'))
                        return
                      }
                      showTransientStatus(t('settings.notificationsDenied'))
                      if (state === 'denied') {
                        void openMacosPrivacyPane('notifications').catch(() => undefined)
                      }
                    } catch (error) {
                      setStatus(errorMessage(error))
                    }
                  })()
                }}
              >
                {t('settings.requestNotifications')}
              </button>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => {
                  void openMacosPrivacyPane('notifications').catch(error => setStatus(errorMessage(error)))
                }}
              >
                {t('settings.openNotificationsSettings')}
              </button>
            </div>
          </Card>
          <Card title={grantsLoading ? 'Autorisations mémorisées' : `Autorisations mémorisées (${grants.length})`}>
            {grantsLoading ? (
              <SectionLoader label={loadingLabel} />
            ) : grantsError ? (
              <p className="settings-note" role="alert">{errorMessage(grantsError, t('settings.grantsLoadFailed'))}</p>
            ) : grants.length === 0 ? (
              <p className="settings-note">Aucune autorisation persistante. Choisissez « Pour cette tâche » ou « Toujours » dans une carte d’approbation pour en créer.</p>
            ) : grants.map(grant => (
              <div className="grant-row" key={grant.id}>
                <div><strong>{grant.actionType}</strong><small>{grant.scope} · {grant.resource}</small></div>
                <button className="danger-link" onClick={async () => { await revokePermissionGrant(grant.id); setGrants(await getPermissionGrants()) }}>Révoquer</button>
              </div>
            ))}
          </Card>
          <p className="settings-note">
            {t('settings.scheduledPolicyHint')}
          </p>
        </>}

        {tab === 'tasks' && <>
          <Heading title="Tâches et planifié" description="Limites d’exécution et conservation de l’historique." />
          <Card>
            <SettingsFields settings={settings} error={settingsError} loadingLabel={loadingLabel}>
              {s => <>
                <NumberRow title="Nombre maximal de tours" value={s.maxTurns} min={1} onChange={value => change('maxTurns', value)} />
                <NumberRow title="Coût maximal par tâche (0 = limite Bob)" value={s.maxCost} min={0} step={0.1} onChange={value => change('maxCost', value)} />
                <NumberRow title="Conserver l’historique (jours)" value={s.taskRetentionDays} min={1} onChange={value => change('taskRetentionDays', value)} />
              </>}
            </SettingsFields>
          </Card>
          <p className="settings-note">{t('settings.notificationsTasksNote')}</p>
          <div className="settings-warning">Les tâches continuent écran verrouillé si le Mac reste éveillé et Bob Work actif. Elles ne peuvent pas s’exécuter pendant l’extinction ou le sommeil profond ; « Exécuter au réveil » rattrape alors l’occurrence.</div>
        </>}

        {tab === 'extensions' && <>
          <Heading title="Accès et contrôle" description="MCP, sous-agents / orchestrateur, web, Computer Use et Chrome. Les skills se gèrent dans la barre latérale (Skills) — ce n’est pas cet onglet." />
          <Card>
            <SettingsFields settings={settings} error={settingsError} loadingLabel={loadingLabel}>
              {s => <>
                <ToggleRow title="Serveurs MCP" value={s.mcpEnabled} onChange={value => change('mcpEnabled', value)} />
                <ToggleRow
                  title="Sous-agents / orchestrateur"
                  description={profile && !profile.supportsSubagents
                    ? 'Ce Bob Shell n’expose pas les sous-agents (--disable-subagents). Mettez à jour Bob Shell pour les activer.'
                    : 'Autorise Bob Shell à lancer des sous-agents. Désactiver ajoute --disable-subagents à bob run.'}
                  value={s.subagentsEnabled}
                  onChange={value => change('subagentsEnabled', value)}
                  disabled={Boolean(profile && !profile.supportsSubagents)}
                />
                <ToggleRow title="Accès web" description="Soumis aux permissions et aux capacités réellement disponibles dans Bob Shell." value={s.webEnabled} onChange={value => change('webEnabled', value)} />
                <ToggleRow
                  title="Contrôle de l’ordinateur"
                  description="Installe le MCP bob-work-computer-use. Les clics et la saisie passent par l’app Bob Work — autorisez Bob Work (pas python3) dans Accessibilité."
                  value={s.computerUseEnabled}
                  onChange={value => change('computerUseEnabled', value)}
                  disabled={s.sandboxMode}
                />
                <ToggleRow
                  title="Contrôle de Chrome"
                  description="Installe le MCP bob-work-chrome-control. L’Automatisation Chrome est demandée pour Bob Work (pas le CLI)."
                  value={s.chromeControlEnabled}
                  onChange={value => change('chromeControlEnabled', value)}
                  disabled={s.sandboxMode}
                />
                {s.sandboxMode && <p className="settings-note">{t('settings.sandboxBlocksElevated')}</p>}
              </>}
            </SettingsFields>
          </Card>
          {settings?.computerUseEnabled && computerUseLoading && !computerUseStatus && !computerUseError && (
            <Card title="Statut Computer Use">
              <SectionLoader label={loadingLabel} />
            </Card>
          )}
          {settings?.computerUseEnabled && computerUseError && !computerUseStatus && (
            <Card title="Statut Computer Use">
              <LoadErrorBanner
                error={computerUseError}
                onRetry={() => void refreshComputerUseStatus()}
                fallback={t('settings.computerUseLoadFailed')}
              />
            </Card>
          )}
          {settings?.computerUseEnabled && computerUseStatus && <Card title="Statut Computer Use">
            <StatusRow title="Serveur MCP intégré" value={computerUseStatus.mcpEnabled ? 'bob-work-computer-use actif' : computerUseStatus.mcpConfigured ? 'Configuré mais désactivé' : 'Non configuré'} ok={computerUseStatus.mcpEnabled} />
            <StatusRow title="Accessibilité macOS" value={computerUseAccessibilityLabel(computerUseStatus.accessibility)} ok={computerUseStatus.accessibility === 'granted'} />
            <StatusRow
              title="Outils MCP"
              value={computerUseTools?.ok
                ? `${computerUseTools.tools.length} outil${computerUseTools.tools.length > 1 ? 's' : ''} : ${computerUseTools.tools.join(', ')}`
                : computerUseTools
                  ? computerUseTools.message
                  : computerUseStatus.mcpEnabled ? 'Test en cours…' : 'Activez le MCP pour lister les outils'}
              ok={Boolean(computerUseTools?.ok)}
            />
            <p className="settings-note">{computerUseStatus.accessibilityMessage}</p>
            <div className="settings-actions">
              <button
                className="secondary-btn"
                onClick={() => {
                  void (async () => {
                    try {
                      const trusted = await requestAccessibilityPermission()
                      showTransientStatus(
                        trusted
                          ? t('settings.accessibilityGranted')
                          : t('settings.accessibilityPrompted'),
                      )
                      await refreshComputerUseStatus()
                      if (!trusted) {
                        void openMacosPrivacyPane('accessibility').catch(() => undefined)
                      }
                    } catch (error) {
                      setStatus(errorMessage(error))
                    }
                  })()
                }}
              >
                {t('settings.requestAccessibility')}
              </button>
              <button className="secondary-btn" onClick={() => void refreshComputerUseStatus()}>Revérifier</button>
            </div>
          </Card>}
          {settings?.chromeControlEnabled && chromeLoading && !chromeStatus && !chromeError && (
            <Card title="Statut Chrome">
              <SectionLoader label={loadingLabel} />
            </Card>
          )}
          {settings?.chromeControlEnabled && chromeError && !chromeStatus && (
            <Card title="Statut Chrome">
              <LoadErrorBanner
                error={chromeError}
                onRetry={() => void refreshChromeStatus()}
                fallback={t('settings.chromeLoadFailed')}
              />
            </Card>
          )}
          {settings?.chromeControlEnabled && chromeStatus && <Card title="Statut Chrome">
            <StatusRow title="Google Chrome" value={chromeStatus.chromeInstalled ? 'Installé' : 'Non installé'} ok={chromeStatus.chromeInstalled} />
            <StatusRow title="Serveur MCP intégré" value={chromeStatus.mcpEnabled ? 'bob-work-chrome-control actif' : chromeStatus.mcpConfigured ? 'Configuré mais désactivé' : 'Non configuré'} ok={chromeStatus.mcpEnabled} />
            <StatusRow
              title="Outils MCP"
              value={chromeTools?.ok
                ? `${chromeTools.tools.length} outil${chromeTools.tools.length > 1 ? 's' : ''} : ${chromeTools.tools.join(', ')}`
                : chromeTools
                  ? chromeTools.message
                  : chromeStatus.mcpEnabled ? 'Test en cours…' : 'Activez le MCP pour lister les outils'}
              ok={Boolean(chromeTools?.ok)}
            />
            <StatusRow title="Automatisation macOS" value={chromeAutomationLabel(chromeStatus.automation)} ok={chromeStatus.automation === 'granted'} />
            <p className="settings-note">{chromeStatus.automationMessage}</p>
            <div className="settings-actions">
              <button
                className="secondary-btn"
                onClick={() => {
                  void (async () => {
                    try {
                      await requestChromeAutomationPermission()
                      showTransientStatus(t('settings.automationGranted'))
                      await refreshChromeStatus()
                    } catch (error) {
                      setStatus(errorMessage(error))
                      void openMacosPrivacyPane('automation').catch(() => undefined)
                      await refreshChromeStatus()
                    }
                  })()
                }}
              >
                {t('settings.requestAutomation')}
              </button>
              <button className="secondary-btn" onClick={() => void refreshChromeStatus()}>Revérifier</button>
            </div>
          </Card>}
          <div className="settings-actions">
            <button className="secondary-btn" onClick={() => void openMacosPrivacyPane('accessibility').catch(error => setStatus(errorMessage(error)))}>
              Ouvrir Accessibilité (Réglages Système)
            </button>
            <button className="secondary-btn" onClick={() => void openMacosPrivacyPane('automation').catch(error => setStatus(errorMessage(error)))}>
              Ouvrir Automatisation (Réglages Système)
            </button>
          </div>
          <div className="settings-actions"><button className="btn-primary" onClick={() => navigate('/skills')}>Gérer les skills</button><button className="secondary-btn" onClick={() => navigate('/integrations')}>Gérer les intégrations et MCP</button><button className="secondary-btn" onClick={() => navigate('/plugins')}>Gérer les plugins</button></div>
        </>}

        {tab === 'modes' && <>
          <Heading title={t('modes.title')} description={t('settings.modesDesc')} />
          <ModesView embedded />
        </>}

        {tab === 'appearance' && <>
          <Heading title={t('settings.appearanceHeading')} description={t('settings.appearanceDesc')} />
          <Card>
            <SettingsFields settings={settings} error={settingsError} loadingLabel={loadingLabel}>
              {s => <>
                <SelectRow title={t('settings.theme')} value={s.theme} onChange={value => change('theme', value as AppSettings['theme'])}><option value="system">{t('settings.themeSystem')}</option><option value="light">{t('settings.themeLight')}</option><option value="dark">{t('settings.themeDark')}</option></SelectRow>
                <SelectRow title={t('settings.language')} value={s.language} onChange={value => change('language', value)}>
                  <option value="auto">{t('settings.languageAuto')}</option>
                  <option value="fr">{t('settings.languageFr')}</option>
                  <option value="en">{t('settings.languageEn')}</option>
                  <option value="es">{t('settings.languageEs')}</option>
                </SelectRow>
                <p className="settings-note">{t('settings.languageHint')}</p>
                <NumberRow title={t('settings.fontSize')} value={s.fontSize} min={12} onChange={value => change('fontSize', value)} />
                <ToggleRow title={t('settings.reducedMotion')} value={s.reducedMotion} onChange={value => change('reducedMotion', value)} />
                <ToggleRow title={t('settings.voiceOnDevice')} description={t('settings.voiceOnDeviceDesc')} value={s.voiceOnDevice} onChange={value => change('voiceOnDevice', value)} />
              </>}
            </SettingsFields>
          </Card>
        </>}

        {tab === 'data' && <>
          <Heading title={t('settings.localDataHeading')} description={t('settings.localDataDesc')} />
          <Card>
            <SelectRow
              title={t('settings.exportFormat')}
              description={t('settings.exportFormatDesc')}
              value={exportFormat}
              onChange={value => setExportFormat(value as typeof exportFormat)}
            >
              <option value="chatgpt">ChatGPT (conversations.json)</option>
              <option value="claude-cowork">Claude / Cowork</option>
              <option value="bob-work-export-v1">Bob Work (complet)</option>
            </SelectRow>
            <div className="settings-actions">
              <button className="secondary-btn" onClick={async () => {
                const path = await chooseFile({ multiple: false, directory: false, filters: [{ name: 'Export conversations JSON', extensions: ['json'] }] })
                if (typeof path === 'string') { const result = await importConversations(path); setStatus(t('settings.importComplete', { conversations: result.conversations, messages: result.messages, format: result.detectedFormat })) }
              }}>{t('settings.importConversations')}</button>
              <button className="secondary-btn" onClick={async () => {
                const defaultPath = exportFormat === 'chatgpt'
                  ? 'conversations.json'
                  : exportFormat === 'claude-cowork'
                    ? 'claude-conversations.json'
                    : 'bob-work-conversations.json'
                const path = await chooseSavePath({ defaultPath, filters: [{ name: 'JSON', extensions: ['json'] }] })
                if (path) {
                  const result = await exportConversations(path, exportFormat)
                  const label = exportFormat === 'chatgpt'
                    ? 'ChatGPT'
                    : exportFormat === 'claude-cowork'
                      ? 'Claude / Cowork'
                      : 'Bob Work'
                  setStatus(t('settings.exportComplete', { conversations: result.conversations, messages: result.messages, format: label }))
                }
              }}>{t('settings.exportConversations')}</button>
              <button className="secondary-btn" onClick={() => { void openDataDir() }}>{t('settings.openDataFolder')}</button>
              <button className="secondary-btn" onClick={async () => setStatus(t('settings.diagnosticExported', { path: await exportDiagnostics() }))}>{t('settings.exportDiagnostic')}</button>
            </div>
          </Card>
          <Card title={t('settings.backupsHeading')}>
            <p className="settings-note">{t('settings.backupsDesc')}</p>
            <div className="settings-actions">
              <button className="secondary-btn" onClick={async () => {
                try {
                  const backup = await createDatabaseBackup()
                  setDatabaseBackups(await listDatabaseBackups())
                  setStatus(t('settings.backupCreated', { name: backup.name }))
                } catch (error) {
                  setStatus(errorMessage(error))
                }
              }}>{t('settings.createBackup')}</button>
            </div>
            {databaseBackups.length > 0 && <div className="settings-list">
              {databaseBackups.map(backup => <div className="settings-list-row" key={backup.name}>
                <div><strong>{backup.name}</strong><small>{(backup.sizeBytes / (1024 * 1024)).toFixed(1)} MB</small></div>
                <button className="secondary-btn" onClick={async () => {
                  if (!await dialog.confirm({ message: t('settings.restoreConfirm', { name: backup.name }), confirmLabel: t('settings.restoreBackup'), destructive: true })) return
                  try {
                    await restoreDatabaseBackup(backup.name)
                    await relaunch()
                  } catch (error) {
                    setStatus(errorMessage(error))
                  }
                }}>{t('settings.restoreBackup')}</button>
              </div>)}
            </div>}
          </Card>
          <Card title={t('settings.cacheHeading')}>
            <p className="settings-note">{t('settings.cacheDesc')}</p>
            <div className="settings-actions">
              <button
                className="secondary-btn"
                onClick={() => {
                  void (async () => {
                    try {
                      if (!await dialog.confirm({ message: t('settings.cachePurgeConfirm'), confirmLabel: t('settings.cachePurge'), destructive: true })) return
                      const result = await purgeAppCache()
                      const mb = (result.freedBytes / (1024 * 1024)).toFixed(1)
                      setStatus(
                        t('settings.cachePurged')
                          .replace('{mb}', mb)
                          .replace('{count}', String(result.clearedPaths.length)),
                      )
                    } catch (error) {
                      setStatus(errorMessage(error))
                    }
                  })()
                }}
              >
                {t('settings.purgeCache')}
              </button>
            </div>
          </Card>
        </>}

        {status && <div className="settings-status">{status}</div>}
        </div>
        {visibleTabs.length === 0 && <div className="settings-no-results"><span>⌕</span><h1>{t('settings.searchEmptyTitle')}</h1><p>{t('settings.searchEmptyHint')}</p></div>}
      </main>
    </div>
  )
}

function Heading({ title, description }: { title: string; description: string }) { return <header className="settings-heading"><h1>{title}</h1><p>{description}</p></header> }
function Card({ title, children }: { title?: string; children: React.ReactNode }) { return <section className="settings-card">{title && <h2>{title}</h2>}{children}</section> }
function SectionLoader({ label }: { label: string }) {
  return (
    <div className="settings-section-loader" role="status" aria-live="polite">
      <span className="task-spinner" aria-hidden="true" />
      {label}
    </div>
  )
}
function SettingsFields({
  settings,
  error,
  loadingLabel,
  children,
}: {
  settings: AppSettings | null
  error: string | null
  loadingLabel: string
  children: (settings: AppSettings) => React.ReactNode
}) {
  if (!settings) {
    return error
      ? <p className="settings-note" role="alert">{error}</p>
      : <SectionLoader label={loadingLabel} />
  }
  return <>{children(settings)}</>
}
function RowText({ title, description }: { title: string; description?: string }) { return <div><strong>{title}</strong>{description && <small>{description}</small>}</div> }
function ToggleRow({ title, description, value, onChange, disabled }: { title: string; description?: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <div className={`settings-row${disabled ? ' is-disabled' : ''}`} aria-disabled={disabled || undefined}>
      <RowText title={title} description={description} />
      <label className="skill-switch settings-switch" title={value ? 'Désactiver' : 'Activer'}>
        <input
          type="checkbox"
          checked={value}
          disabled={disabled}
          aria-label={`${value ? 'Désactiver' : 'Activer'} ${title}`}
          onChange={event => onChange(event.target.checked)}
        />
        <span aria-hidden="true" />
      </label>
    </div>
  )
}
function SelectRow({ title, description, value, onChange, children }: { title: string; description?: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) { return <label className="settings-row"><RowText title={title} description={description} /><select value={value} onChange={event => onChange(event.target.value)}>{children}</select></label> }
function NumberRow({ title, value, min, step, onChange }: { title: string; value: number; min: number; step?: number; onChange: (value: number) => void }) { return <label className="settings-row"><RowText title={title} /><input className="settings-number" type="number" value={value} min={min} step={step} onChange={event => onChange(Number(event.target.value))} /></label> }
function StatusRow({ title, value, ok, loading }: { title: string; value: string; ok?: boolean; loading?: boolean }) {
  return (
    <div className="settings-row">
      <RowText title={title} />
      {loading ? (
        <span className="settings-row-loader" role="status">
          <span className="task-spinner" aria-hidden="true" />
          {value}
        </span>
      ) : (
        <span className={ok === undefined ? '' : ok ? 'status-ok' : 'status-bad'}>{value}</span>
      )}
    </div>
  )
}
function authenticationLabel(method: string) {
  return ({
    api_key_session: 'Clé enregistrée dans le coffre',
    api_key_environment: 'Clé fournie par l’environnement',
    sso_session_detected: 'Session IBM Bob Shell détectée',
    required: 'Authentification requise',
  }[method] ?? method)
}
function chromeAutomationLabel(automation: MacosChromeControlStatus['automation']) {
  return ({ granted: 'Accordée', denied: 'Refusée', chrome_missing: 'Chrome absent', unavailable: 'Indisponible', unknown: 'Inconnue' }[automation] ?? automation)
}
function computerUseAccessibilityLabel(accessibility: MacosComputerUseStatus['accessibility']) {
  return ({ granted: 'Accordée', denied: 'Refusée', unavailable: 'Indisponible', unknown: 'Inconnue' }[accessibility] ?? accessibility)
}
function applyTheme(theme: string) { const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches); document.documentElement.classList.toggle('dark', dark) }
function normalizeSettingsSearch(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim() }
