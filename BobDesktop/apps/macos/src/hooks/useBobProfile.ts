import { useUsageUpdated } from "./useTauriEvents";

import { useCallback, useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { getBobProfile, getPermissionGrants, getUsageStatus, getBobAuthSnapshot, hasSessionSecret, installBobShell, revokePermissionGrant } from '../lib/ipc'
import { bobAuthService, resolveSessionApiKeyStatus } from '../services/BobAuthService'
import { useAppStore } from '../stores/appStore'
import type { BobAuthSnapshot, PermissionGrant, ShellProfile, UsageStatus } from '@bob-work/shared-types'
import { errorMessage } from '../lib/errorMessage'
import { useT } from '../i18n'

export const BOB_SETTINGS_POLL_INTERVAL_MS = 5_000

export function useBobProfile(tab: string, setStatus: (status: string) => void, showTransientStatus: (status: string) => void) {
  const t = useT()
  const { setBobStatus, setBobInfo } = useAppStore()
  
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
  const [usageLoading, setUsageLoading] = useState(true)
  const [grants, setGrants] = useState<PermissionGrant[]>([])
  const [grantsLoading, setGrantsLoading] = useState(true)
  const [grantsError, setGrantsError] = useState<unknown>(null)
  const [apiKey, setApiKey] = useState('')
  const [sessionKeyStatus, setSessionKeyStatus] = useState({ active: false, source: 'none' as 'session' | 'environment' | 'sso' | 'none', vaultKeyPresent: false })
  const [bobExtrasReady, setBobExtrasReady] = useState(false)
  const [installingBob, setInstallingBob] = useState(false)
  const authSnapshotRef = useRef(authSnapshot)
  const usageRef = useRef(usage)
  const grantsLoadingRef = useRef(grantsLoading)
  authSnapshotRef.current = authSnapshot
  usageRef.current = usage
  grantsLoadingRef.current = grantsLoading

  const refreshProfile = useCallback(async (announce = false, forceUsage = announce) => {
    if (announce || !authSnapshotRef.current) setProfileLoading(true)
    if (announce || usageRef.current === null) setUsageLoading(true)
    if (announce || grantsLoadingRef.current) setGrantsLoading(true)
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
    if (announce) showTransientStatus(t('settings.checkComplete'))
    return nextProfile
  }, [setBobInfo, setBobStatus, showTransientStatus, t])

  useEffect(() => {
    const idle = window.setTimeout(() => { void refreshProfile() }, 0)
    return () => window.clearTimeout(idle)
  }, [refreshProfile])

  useEffect(() => {
    if (tab !== 'bob') {
      setBobExtrasReady(false)
      return
    }
    const id = window.requestAnimationFrame(() => setBobExtrasReady(true))
    return () => window.cancelAnimationFrame(id)
  }, [tab])

  useEffect(() => {
    if (tab !== 'bob' && !installingBob) return
    const poll = window.setInterval(() => { void refreshProfile(false, false) }, BOB_SETTINGS_POLL_INTERVAL_MS)
    return () => window.clearInterval(poll)
  }, [tab, installingBob, refreshProfile])

  useUsageUpdated(setUsage)

  const install = async () => {
    if (installingBob) return
    setInstallingBob(true)
    setStatus(t('settings.bobInstalling'))
    try {
      await installBobShell()
      setStatus(t('settings.bobInstalled'))
      await refreshProfile()
    } catch (error) {
      setStatus(t('settings.bobInstallFailed', { error: errorMessage(error) }))
    } finally {
      setInstallingBob(false)
    }
  }

  const saveKey = async () => {
    if (!apiKey.trim()) return
    try {
      await bobAuthService.setSessionApiKey(apiKey.trim())
      setApiKey('')
      setStatus(t('settings.bobKeySaved'))
      await refreshProfile()
    } catch (error) { setStatus(errorMessage(error)) }
  }
  
  const revokeGrant = async (id: string) => {
    await revokePermissionGrant(id)
    setGrants(await getPermissionGrants())
  }

  return {
    profile,
    authSnapshot,
    profileLoading,
    usage,
    usageLoading,
    grants,
    grantsLoading,
    grantsError,
    apiKey,
    setApiKey,
    sessionKeyStatus,
    bobExtrasReady,
    refreshProfile,
    install,
    installingBob,
    saveKey,
    revokeGrant
  }
}
