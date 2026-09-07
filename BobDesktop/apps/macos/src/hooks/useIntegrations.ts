import { useCallback, useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import {
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
import { CATALOG, IntegrationDef } from '../views/IntegrationsTabs/catalogData'

export function isPkcePublicProvider(provider: string) {
  return provider === 'slack' || provider === 'microsoft' || provider === 'monday'
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
  const [connectingToken, setConnectingToken] = useState<string | null>(null)
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
      setDeviceCode(null)
      setStatus(event.payload)
      await refreshStatuses()
    }).then(fn => { unlistenError = fn })

    return () => { unlistenDone?.(); unlistenError?.() }
  }, [refreshStatuses, reloadMcp, t])

  const openConnectPanel = async (integration: IntegrationDef) => {
    setConnectPanelId(integration.id)
    setStatus('')
    const existing = await getOAuthClientConfig(integration.id).catch(() => null)
    setOauthForms(current => ({
      ...current,
      [integration.id]: {
        clientId: existing?.clientId ?? current[integration.id]?.clientId ?? '',
        clientSecret: existing?.clientSecret ?? current[integration.id]?.clientSecret ?? '',
      },
    }))
  }

  const handleConnect = async (integration: IntegrationDef) => {
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
        if (integration.oauthProvider !== 'monday') {
          await openConnectPanel(integration)
        }
      } else {
        setStatus(t('integrations.authorizeInBrowser', { name: integration.name }))
      }
    } catch (error) {
      setPendingOAuth(null)
      setStatus(errorMessage(error))
      const info = statuses[integration.id]
      if (integration.oauthProvider !== 'monday' && !info?.oauthClientConfigured && !info?.deviceFlowAvailable) {
        await openConnectPanel(integration)
      }
    }
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
    connectingToken,
    status,
    setStatus,
    setDeviceCode,
    setPendingOAuth,
    setConnectPanelId,
    setOauthForms,
    setTokenForms,
    refreshStatuses,
    openConnectPanel,
    handleConnect,
    handleSaveOAuthAndConnect,
    handleConnectWithToken,
    handleDisconnect,
  }
}
