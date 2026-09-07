import { useCallback, useEffect, useRef, useState } from 'react'
import { getSettings, peekCachedSettings, updateSettings, checkForUpdates, installAvailableUpdate, type UpdateCheckResult, getNotificationAuthState, isNotificationAuthGranted, requestNotificationAuthorization, openMacosPrivacyPane, listDatabaseBackups, type DatabaseBackup, getChromeControlStatus, getComputerUseStatus, testMcpServer } from '../lib/ipc'
import { useAppStore } from '../stores/appStore'
import { DEFAULT_APP_SETTINGS } from '../lib/ipc'
import type { AppSettings, MacosChromeControlStatus, MacosComputerUseStatus, PluginMcpTestResult } from '@bob-work/shared-types'
import { useT } from '../i18n'
import { errorMessage } from '../lib/errorMessage'
import { useLocation } from 'react-router-dom'

type Tab = 'general' | 'bob' | 'instructions' | 'memory' | 'permissions' | 'tasks' | 'extensions' | 'runtimes' | 'remote' | 'ssh' | 'modes' | 'appearance' | 'data'

export function useSettingsData() {
  const t = useT()
  const location = useLocation()
  const initialTab = (location.state as { tab?: Tab } | null)?.tab
  const [tab, setTab] = useState<Tab>(initialTab ?? 'general')

  useEffect(() => {
    const next = (location.state as { tab?: Tab } | null)?.tab
    if (next) setTab(next)
  }, [location.state])

  const initialSettings = () => peekCachedSettings() ?? useAppStore.getState().settings ?? DEFAULT_APP_SETTINGS
  const [settings, setSettings] = useState<AppSettings>(initialSettings)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [settingsHydrated, setSettingsHydrated] = useState(
    () => Boolean(peekCachedSettings() ?? useAppStore.getState().settings),
  )
  const settingsDirtyRef = useRef(false)

  const [databaseBackups, setDatabaseBackups] = useState<DatabaseBackup[]>([])
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
  const [status, setStatus] = useState('')

  const skipNextSaveRef = useRef(true)
  const saveTimerRef = useRef<number | null>(null)
  const pendingSavesRef = useRef<AppSettings[]>([])
  const saveInFlightRef = useRef(false)
  const latestSettingsRef = useRef<AppSettings>(settings)
  const lastPersistedSettingsRef = useRef<AppSettings>(initialSettings())
  const statusTimerRef = useRef<number | null>(null)

  const showTransientStatus = useCallback((message: string) => {
    setStatus(message)
    if (statusTimerRef.current) window.clearTimeout(statusTimerRef.current)
    statusTimerRef.current = window.setTimeout(() => setStatus(''), 2500)
  }, [])

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

  useEffect(() => {
    if (tab !== 'data') return
    void listDatabaseBackups()
      .then(setDatabaseBackups)
      .catch(error => setStatus(errorMessage(error)))
  }, [tab])

  useEffect(() => {
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
  }, [])

  useEffect(() => {
    getNotificationAuthState()
      .then(state => {
        setNotificationBundleHint(state === 'unavailable' ? t('settings.notificationsUnavailable') : '')
      })
      .catch(() => setNotificationBundleHint(''))
  }, [t])

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
      void testMcpServer('bob-work-computer-use').then(setComputerUseTools).catch(() => setComputerUseTools(null))
    } else {
      setComputerUseTools(null)
    }
    if (settings?.chromeControlEnabled) {
      void testMcpServer('bob-work-chrome-control').then(setChromeTools).catch(() => setChromeTools(null))
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
    pendingSavesRef.current.push(nextSettings)
    if (saveInFlightRef.current) return
    saveInFlightRef.current = true
    void (async () => {
      try {
        while (pendingSavesRef.current.length > 0) {
          const pending = pendingSavesRef.current.shift()
          if (!pending) break
          await persistSettings(pending)
        }
      } finally {
        saveInFlightRef.current = false
        if (pendingSavesRef.current.length > 0) enqueueSettingsSave(pendingSavesRef.current.shift()!)
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
      if (JSON.stringify(lastPersistedSettingsRef.current) === JSON.stringify(settings)) return
      enqueueSettingsSave(settings)
    }, 400)
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    }
  }, [settings, settingsHydrated, enqueueSettingsSave])

  const change = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    settingsDirtyRef.current = true
    const next = { ...latestSettingsRef.current, [key]: value }
    latestSettingsRef.current = next
    setSettings(next)
    if (key === 'theme') {
      const dark = value === 'dark' || (value === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.classList.toggle('dark', dark)
    }
    if (key === 'theme' || key === 'language' || key === 'remoteControlEnabled' || key === 'mcpGatewayEnabled' || key === 'mcpGatewayTools') {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
      enqueueSettingsSave(next)
    }
  }

  return {
    tab,
    setTab,
    settings,
    setSettings,
    settingsError,
    settingsHydrated,
    databaseBackups,
    setDatabaseBackups,
    settingsSearch,
    setSettingsSearch,
    exportFormat,
    setExportFormat,
    chromeStatus,
    chromeLoading,
    chromeError,
    computerUseStatus,
    computerUseLoading,
    computerUseError,
    computerUseTools,
    chromeTools,
    notificationBundleHint,
    updateInfo,
    updateBusy,
    status,
    setStatus,
    showTransientStatus,
    checkUpdate,
    installUpdate,
    refreshChromeStatus,
    refreshComputerUseStatus,
    change
  }
}
