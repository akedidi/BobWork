import { useCallback, useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import {
  connectIntegrationSsh,
  connectIntegrationToken,
  disconnectIntegration,
  getIntegrationStatuses,
  getOAuthClientConfig,
  setOAuthClientConfig,
  startIntegrationOAuth,
} from '../lib/ipc'
import type { IntegrationConnectionStatus } from '../lib/ipc'
import { errorMessage } from '../lib/errorMessage'
import { useT } from '../i18n'
import { useAppDialog } from '../components/AppDialog'
import { CATALOG, IntegrationAuthMode, IntegrationDef } from '../views/IntegrationsTabs/catalogData'

export function isPkcePublicProvider(provider: string) {
  return provider === 'slack' || provider === 'microsoft'
}

export function defaultAuthMode(integration: IntegrationDef): IntegrationAuthMode {
  return integration.authModes?.[0] ?? 'oauth'
}

export function setupStatusMessage(integration: IntegrationDef, t: (key: string, params?: Record<string, string | number>) => string) {
  if (integration.oauthProvider === 'slack') return t('integrations.slackSetupStatus')
  if (integration.oauthProvider === 'microsoft') return t('integrations.microsoftSetupStatus')
  return t('integrations.oauthAppSetupStatus', { name: integration.name })
}

export function useIntegrations({ reloadMcp }: { reloadMcp?: () => Promise<void> } = {}) {
  const t = useT()
  const dialog = useAppDialog()

  const [statuses, setStatuses] = useState<Record<string, IntegrationConnectionStatus>>({})
  const [pendingOAuth, setPendingOAuth] = useState<string | null>(null)
  const [deviceCode, setDeviceCode] = useState<{ integrationId: string; userCode: string; verificationUri: string } | null>(null)
  const [connectPanelId, setConnectPanelId] = useState<string | null>(null)
  const [oauthForms, setOauthForms] = useState<Record<string, { clientId: string; clientSecret: string }>>({})
  const [tokenForms, setTokenForms] = useState<Record<string, { token: string; label: string }>>({})
  const [authModeForms, setAuthModeForms] = useState<Record<string, IntegrationAuthMode>>({})
  const [connectingToken, setConnectingToken] = useState<string | null>(null)
  const [connectingSsh, setConnectingSsh] = useState<string | null>(null)
  const [status, setStatus] = useState('')

  const statusTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!status) return
    if (statusTimerRef.current) window.clearTimeout(statusTimerRef.current)
    statusTimerRef.current = window.setTimeout(() => setStatus(''), 3500)
    return () => {
      if (statusTimerRef.current) window.clearTimeout(statusTimerRef.current)
    }
  }, [status])

  const refreshStatuses = useCallback(async () => {
    const next = await getIntegrationStatuses()
    setStatuses(Object.fromEntries(next.map(item => [item.integrationId, item])))
  }, [])

  useEffect(() => {
    let unlistenDone: (() => void) | null = null
    let unlistenError: (() => void) | null = null
    listen<IntegrationConnectionStatus>('integration-oauth-done', async event => {
      setPendingOAuth(null)
      setConnectingToken(null)
      setConnectingSsh(null)
      setConnectPanelId(null)
      setDeviceCode(null)
      const name = CATALOG.find(item => item.id === event.payload.integrationId)?.name ?? event.payload.integrationId
      setStatus(event.payload.accountLabel
        ? t('integrations.connectedReadyAccount', { name, account: event.payload.accountLabel })
        : t('integrations.connectedReady', { name }))
      await refreshStatuses()
      if (reloadMcp) await reloadMcp()
    }).then(fn => { unlistenDone = fn })
    
    listen<string>('integration-oauth-error', async event => {
      setPendingOAuth(null)
      setConnectingToken(null)
      setConnectingSsh(null)
      setDeviceCode(null)
      setStatus(event.payload)
      await refreshStatuses()
    }).then(fn => { unlistenError = fn })

    return () => { unlistenDone?.(); unlistenError?.() }
  }, [refreshStatuses, reloadMcp, t])

  const openConnectPanel = async (integration: IntegrationDef) => {
    setConnectPanelId(integration.id)
    setStatus('')
    setAuthModeForms(current => ({
      ...current,
      [integration.id]: current[integration.id] ?? defaultAuthMode(integration),
    }))
    const existing = await getOAuthClientConfig(integration.id).catch(() => null)
    setOauthForms(current => ({
      ...current,
      [integration.id]: {
        clientId: existing?.clientId ?? current[integration.id]?.clientId ?? '',
        clientSecret: existing?.clientSecret ?? current[integration.id]?.clientSecret ?? '',
      },
    }))
  }

  const handleStartOAuth = async (integration: IntegrationDef) => {
    setStatus('')
    setDeviceCode(null)
    try {
      setPendingOAuth(integration.id)
      setConnectPanelId(null)
      const result = await startIntegrationOAuth(integration.id)
      if (result.mode === 'device' && result.userCode && result.verificationUri) {
        setDeviceCode({
          integrationId: integration.id,
          userCode: result.userCode,
          verificationUri: result.verificationUri,
        })
        try { await navigator.clipboard.writeText(result.userCode) } catch { /* clipboard optional */ }
        setStatus(t('integrations.deviceCodePrompt', { name: integration.name }))
      } else if (result.mode === 'setup') {
        setPendingOAuth(null)
        setStatus(setupStatusMessage(integration, t))
        await openConnectPanel(integration)
      } else {
        setStatus(t('integrations.authorizeInBrowser', { name: integration.name }))
      }
    } catch (error) {
      setPendingOAuth(null)
      setStatus(errorMessage(error))
      const info = statuses[integration.id]
      if (!info?.oauthClientConfigured && !info?.deviceFlowAvailable) {
        await openConnectPanel(integration)
      }
    }
  }

  const handleConnect = async (integration: IntegrationDef) => {
    if (integration.tokenOnly) {
      await openConnectPanel(integration)
      return
    }
    const authMode = authModeForms[integration.id] ?? defaultAuthMode(integration)
    if (integration.authModes?.includes('ssh') && authMode === 'ssh') {
      await openConnectPanel(integration)
      return
    }
    if (integration.authModes?.includes('oauth') && integration.authModes.length > 1) {
      await openConnectPanel(integration)
      return
    }
    await handleStartOAuth(integration)
  }

  const handleSaveOAuthAndConnect = async (integration: IntegrationDef) => {
    const form = oauthForms[integration.id]
    if (!form?.clientId.trim()) {
      setStatus(t('integrations.enterClientId'))
      return
    }
    setStatus('')
    try {
      setPendingOAuth(integration.id)
      setConnectPanelId(null)
      await setOAuthClientConfig(
        integration.id,
        form.clientId.trim(),
        isPkcePublicProvider(integration.oauthProvider)
          ? undefined
          : (form.clientSecret.trim() || undefined),
      )
      await refreshStatuses()
      const result = await startIntegrationOAuth(integration.id)
      if (result.mode === 'web') {
        setStatus(t('integrations.authorizeInBrowser', { name: integration.name }))
      } else {
        setStatus(t('integrations.connectingNamed', { name: integration.name }))
      }
    } catch (error) {
      setPendingOAuth(null)
      setStatus(errorMessage(error))
    }
  }

  const handleConnectWithToken = async (integration: IntegrationDef) => {
    const form = tokenForms[integration.id]
    if (!form?.token.trim()) {
      setStatus(t('integrations.pasteValidToken'))
      return
    }
    setStatus('')
    try {
      setConnectingToken(integration.id)
      await connectIntegrationToken(
        integration.id,
        form.token.trim(),
        form.label.trim() || undefined,
      )
    } catch (error) {
      setConnectingToken(null)
      setStatus(errorMessage(error))
    }
  }

  const handleConnectWithSsh = async (integration: IntegrationDef) => {
    setStatus('')
    try {
      setConnectingSsh(integration.id)
      const form = tokenForms[integration.id]
      await connectIntegrationSsh(
        integration.id,
        form?.label.trim() || undefined,
      )
    } catch (error) {
      setConnectingSsh(null)
      setStatus(errorMessage(error))
    }
  }

  const handleDisconnect = async (integration: IntegrationDef) => {
    if (!await dialog.confirm({ message: t('integrations.disconnectConfirm', { name: integration.name }), confirmLabel: t('integrations.disconnect'), destructive: true })) return
    await disconnectIntegration(integration.id)
    await refreshStatuses()
    setConnectPanelId(current => (current === integration.id ? null : current))
    setStatus(t('integrations.disconnectedNamed', { name: integration.name }))
  }

  return {
    statuses,
    pendingOAuth,
    deviceCode,
    connectPanelId,
    oauthForms,
    tokenForms,
    authModeForms,
    connectingToken,
    connectingSsh,
    status,
    setStatus,
    setDeviceCode,
    setPendingOAuth,
    setConnectPanelId,
    setOauthForms,
    setTokenForms,
    setAuthModeForms,
    refreshStatuses,
    openConnectPanel,
    handleConnect,
    handleStartOAuth,
    handleSaveOAuthAndConnect,
    handleConnectWithToken,
    handleConnectWithSsh,
    handleDisconnect,
  }
}
