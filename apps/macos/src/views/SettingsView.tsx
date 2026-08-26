import { useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useT } from '../i18n'
import { useSettingsData } from '../hooks/useSettingsData'
import { useBobProfile } from '../hooks/useBobProfile'
import { normalizeSettingsSearch } from './SettingsTabs/SettingsShared'

import GeneralSettingsTab from './SettingsTabs/GeneralSettingsTab'
import BobSettingsTab from './SettingsTabs/BobSettingsTab'
import InstructionsSettingsTab from './SettingsTabs/InstructionsSettingsTab'
import PermissionsSettingsTab from './SettingsTabs/PermissionsSettingsTab'
import TasksSettingsTab from './SettingsTabs/TasksSettingsTab'
import ExtensionsSettingsTab from './SettingsTabs/ExtensionsSettingsTab'
import RemoteSettingsTab from './SettingsTabs/RemoteSettingsTab'
import ModesSettingsTab from './SettingsTabs/ModesSettingsTab'
import AppearanceSettingsTab from './SettingsTabs/AppearanceSettingsTab'
import DataSettingsTab from './SettingsTabs/DataSettingsTab'

export default function SettingsView() {
  const t = useT()

  const {
    tab, setTab,
    settings, setSettings, settingsError, settingsHydrated,
    databaseBackups, setDatabaseBackups,
    settingsSearch, setSettingsSearch,
    exportFormat, setExportFormat,
    chromeStatus, chromeLoading, chromeError,
    computerUseStatus, computerUseLoading, computerUseError,
    computerUseTools, chromeTools,
    notificationBundleHint, updateInfo, updateBusy,
    status, setStatus, showTransientStatus,
    checkUpdate, installUpdate, refreshChromeStatus, refreshComputerUseStatus, change
  } = useSettingsData()

  const {
    profile, authSnapshot, profileLoading,
    usage, usageLoading,
    grants, grantsLoading, grantsError,
    apiKey, setApiKey, sessionKeyStatus,
    bobExtrasReady, refreshProfile, install, saveKey, revokeGrant
  } = useBobProfile(tab, setStatus, showTransientStatus)

  const tabs = useMemo(() => [
    { id: 'general' as const, label: t('settings.tabGeneral'), keywords: 'mode démarrage ouverture session barre menus notifications système enable disable activer désactiver' },
    { id: 'bob' as const, label: t('settings.tabBob'), keywords: 'clé api inférence session temporaire consommation crédits installation authentification bobalytics bobcoins adoption' },
    { id: 'instructions' as const, label: t('settings.tabInstructions'), keywords: 'prompt défaut personnalisées consignes projet réponse contexte conversations mémoire cross chatgpt' },
    { id: 'permissions' as const, label: t('settings.tabPermissions'), keywords: 'autorisations approbation fichiers terminal réseau applications révoquer sandbox bac à sable' },
    { id: 'tasks' as const, label: t('settings.tabTasks'), keywords: 'planification historique coût tours limites rétention réveil' },
    { id: 'extensions' as const, label: t('settings.tabExtensions'), keywords: 'extensions accès contrôle mcp intégrations plugins skills sous-agents subagents orchestrateur web ordinateur chrome accessibilité automatisation' },
    { id: 'remote' as const, label: t('settings.tabRemote'), keywords: 'mobile télécommande remote control cloudflare tunnel lien copier téléphone' },
    { id: 'modes' as const, label: t('settings.tabModes'), keywords: 'modes bob shell catalogue custom_modes yaml agent plan ask télécharger installer importer' },
    { id: 'appearance' as const, label: t('settings.tabAppearance'), keywords: 'thème clair sombre dark light français english español taille texte dictée enregistrement audio micro système conserver animations' },
    { id: 'data' as const, label: t('settings.tabData'), keywords: 'import export conversations chatgpt claude cowork télémétrie diagnostic dossier cache purge nettoyer' },
  ], [t])

  const visibleTabs = useMemo(() => {
    const query = normalizeSettingsSearch(settingsSearch)
    if (!query) return tabs
    return tabs.filter(item => normalizeSettingsSearch(`${item.label} ${item.keywords}`).includes(query))
  }, [settingsSearch, tabs])

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

  const tabProps = {
    t, settings, change, settingsError, updateInfo, updateBusy, checkUpdate, installUpdate,
    notificationBundleHint, usageLoading, usage, profileLoading, installationFound, installationLabel,
    authReady, authMethod, profile, authSnapshot, sessionKeyStatus, install, refreshProfile,
    apiKey, setApiKey, saveKey, bobExtrasReady, grantsLoading, grants, grantsError, revokeGrant,
    chromeLoading, chromeStatus, chromeError, refreshChromeStatus, chromeTools,
    computerUseLoading, computerUseStatus, computerUseError, refreshComputerUseStatus, computerUseTools,
    exportFormat, setExportFormat, databaseBackups, setStatus, setDatabaseBackups, showTransientStatus
  }

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
          {tab === 'general' && <GeneralSettingsTab {...tabProps} />}
          {tab === 'bob' && <BobSettingsTab {...tabProps} />}
          {tab === 'instructions' && <InstructionsSettingsTab {...tabProps} />}
          {tab === 'permissions' && <PermissionsSettingsTab {...tabProps} />}
          {tab === 'tasks' && <TasksSettingsTab {...tabProps} />}
          {tab === 'extensions' && <ExtensionsSettingsTab {...tabProps} />}
          {tab === 'remote' && <RemoteSettingsTab {...tabProps} />}
          {tab === 'modes' && <ModesSettingsTab {...tabProps} />}
          {tab === 'appearance' && <AppearanceSettingsTab {...tabProps} />}
          {tab === 'data' && <DataSettingsTab {...tabProps} />}
          {status && <div className="settings-status">{status}</div>}
        </div>
        {visibleTabs.length === 0 && <div className="settings-no-results"><span>⌕</span><h1>{t('settings.searchEmptyTitle')}</h1><p>{t('settings.searchEmptyHint')}</p></div>}
      </main>
    </div>
  )
}
