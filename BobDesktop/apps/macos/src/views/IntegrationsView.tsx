import { useEffect, useRef, useState, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useT } from '../i18n'
import { LoadErrorBanner } from '../components/LoadErrorBanner'
import { statusTone } from '../lib/statusTone'

import { useIntegrations } from '../hooks/useIntegrations'
import { useMcpServers } from '../hooks/useMcpServers'
import { useDbConnections } from '../hooks/useDbConnections'
import { useConnectorForms, slugifyName } from '../hooks/useConnectorForms'
import { testMcpServer } from '../lib/ipc'
import { errorMessage } from '../lib/errorMessage'

import { IntegrationsCatalogTab } from './IntegrationsTabs/IntegrationsCatalogTab'
import { ApisTab } from './IntegrationsTabs/ApisTab'
import { McpProtocolsTab } from './IntegrationsTabs/McpProtocolsTab'
import { DbConnectionsTab } from './IntegrationsTabs/DbConnectionsTab'
import { CATALOG } from './IntegrationsTabs/catalogData'

export type PageTab = 'integrations' | 'apis' | 'mcp' | 'db'
export type IntegrationFilter = 'all' | 'productivity' | 'developer'

export default function IntegrationsView() {
  const t = useT()
  const location = useLocation()
  const navigate = useNavigate()

  const [tab, setTab] = useState<PageTab>('integrations')
  const [filter, setFilter] = useState<IntegrationFilter>('all')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<unknown>(null)
  
  const [highlightKeyedApi, setHighlightKeyedApi] = useState(false)
  const [highlightProvider, setHighlightProvider] = useState<string | null>(null)
  const keyedApiPanelRef = useRef<HTMLElement | null>(null)

  const {
    servers,
    loadMcp,
    mcpTestBusy,
    setMcpTestBusy,
    classified,
  } = useMcpServers({ setStatus: (s) => setStatus(s) }) // will fix this circular dep by wrapping in a ref or moving state down

  const {
    connections: dbConnections,
    load: loadDb,
    persist: persistDb,
    toggle: toggleDb,
    remove: removeDb,
    test: testDb,
    testBusy: dbTestBusy,
  } = useDbConnections({ setStatus: (s) => setStatus(s) })

  const {
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
  } = useIntegrations({ reloadMcp: loadMcp })

  const {
    mcpForm,
    setMcpForm,
    publicApiForm,
    setPublicApiForm,
    apiKeyForm,
    setApiKeyForm,
    oauthMcpForm,
    setOauthMcpForm,
    persistMcp,
    persistPublicApi,
    persistApiKey,
    persistOauthMcp,
    editMcp,
    editPublicApi,
    editKeyedApi,
    cancelMcpEdit,
    cancelPublicApiEdit,
    cancelKeyedApiEdit,
  } = useConnectorForms({ setStatus, loadMcp, setTab })

  const reload = useCallback(async () => {
    setLoadError(null)
    setLoading(true)
    try {
      await Promise.all([refreshStatuses(), loadMcp(), loadDb()])
    } catch (error) {
      setLoadError(error)
    } finally {
      setLoading(false)
    }
  }, [refreshStatuses, loadMcp, loadDb])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    const state = location.state as {
      tab?: PageTab
      apiKeyPreset?: {
        name?: string
        envName?: string
        authMode?: 'bearer' | 'header' | 'env' | 'query'
        url?: string
        transport?: string
      }
      highlight?: string
    } | null
    if (!state) return
    if (state.tab === 'apis' || state.tab === 'mcp' || state.tab === 'integrations' || state.tab === 'db') {
      setTab(state.tab)
    }
    if (state.apiKeyPreset) {
      const preset = state.apiKeyPreset
      setApiKeyForm(current => ({
        ...current,
        name: slugifyName(preset.name || current.name || 'api'),
        url: preset.url ?? current.url,
        transport: preset.transport || current.transport,
        authMode: preset.authMode || 'env',
        envName: preset.envName || current.envName || 'API_KEY',
        secret: '',
      }))
      setHighlightKeyedApi(true)
      setStatus(
        preset.envName
          ? `Formulaire prérempli pour ${preset.envName}. Collez la clé puis enregistrez.`
          : 'Formulaire API prérempli. Collez la clé puis enregistrez.',
      )
    } else if (state.highlight === 'keyed-api') {
      setHighlightKeyedApi(true)
    } else if (state.highlight && state.highlight !== 'mcp') {
      setHighlightProvider(state.highlight)
      if (!state.tab) setTab('integrations')
    }
    navigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, location.state, navigate, setApiKeyForm, setStatus])

  useEffect(() => {
    if (!highlightKeyedApi || tab !== 'apis') return
    const timer = window.setTimeout(() => {
      keyedApiPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
    return () => window.clearTimeout(timer)
  }, [highlightKeyedApi, tab, loading])

  useEffect(() => {
    if (!highlightProvider || tab !== 'integrations') return
    const timer = window.setTimeout(() => {
      document
        .querySelector(`[data-provider="${highlightProvider}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 80)
    return () => window.clearTimeout(timer)
  }, [highlightProvider, tab, loading])

  const testServerMcp = async (name: string) => {
    setMcpTestBusy(name)
    try {
      const result = await testMcpServer(name)
      setStatus(result.ok ? `${name} : ${result.message}` : `${name} — échec : ${result.message}`)
      await loadMcp()
      await refreshStatuses()
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setMcpTestBusy(null)
    }
  }

  const testIntegrationMcp = async (integrationId: string, mcpName: string) => {
    if (!mcpName) return
    setMcpTestBusy(integrationId)
    try {
      const result = await testMcpServer(mcpName)
      setStatus(result.ok ? `${integrationId} : ${result.message}` : `${integrationId} — échec : ${result.message}`)
      await refreshStatuses()
      await loadMcp()
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setMcpTestBusy(null)
    }
  }

  const visible = filter === 'all'
    ? CATALOG
    : filter === 'developer'
      ? CATALOG.filter(item => item.group === 'developer')
      : CATALOG.filter(item => item.group === 'microsoft')

  const connectedCount = CATALOG.filter(item => statuses[item.id]?.connected).length
  const microsoftNeedsEntra = !loading && !loadError && CATALOG
    .filter(item => item.oauthProvider === 'microsoft')
    .every(item => {
      const info = statuses[item.id]
      return info && !info.connected && !info.oauthClientConfigured
    })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="topbar titlebar-drag" data-tauri-drag-region>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{t('integrations.title')}</span>
        {tab === 'integrations' && <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
          {connectedCount} connexion{connectedCount !== 1 ? 's' : ''} active{connectedCount !== 1 ? 's' : ''}
        </span>}
      </div>

      <div className="extensions-tabs">
        <button className={`filter-pill ${tab === 'integrations' ? 'active' : ''}`} onClick={() => setTab('integrations')}>{t('integrations.tabIntegrations')}</button>
        <button className={`filter-pill ${tab === 'apis' ? 'active' : ''}`} onClick={() => setTab('apis')}>{t('integrations.tabApis')}</button>
        <button className={`filter-pill ${tab === 'mcp' ? 'active' : ''}`} onClick={() => setTab('mcp')}>{t('integrations.tabMcp')}</button>
        <button className={`filter-pill ${tab === 'db' ? 'active' : ''}`} onClick={() => setTab('db')}>{t('integrations.tabDb')}</button>
      </div>

      <LoadErrorBanner
        error={loadError}
        onRetry={() => { void reload() }}
        fallback={t('integrations.loadFailed')}
      />
      {loading && !loadError ? (
        <div className="task-empty" style={{ marginTop: 24 }}>{t('common.loading')}</div>
      ) : null}

      {tab === 'integrations' && !loading && !loadError && (
        <IntegrationsCatalogTab
          filter={filter}
          setFilter={setFilter}
          microsoftNeedsEntra={microsoftNeedsEntra}
          visible={visible}
          statuses={statuses}
          pendingOAuth={pendingOAuth}
          connectingToken={connectingToken}
          connectPanelId={connectPanelId}
          oauthForms={oauthForms}
          tokenForms={tokenForms}
          highlightProvider={highlightProvider}
          deviceCode={deviceCode}
          mcpTestBusy={mcpTestBusy}
          setOauthForms={setOauthForms}
          setTokenForms={setTokenForms}
          handleConnect={handleConnect}
          handleSaveOAuthAndConnect={handleSaveOAuthAndConnect}
          handleConnectWithToken={handleConnectWithToken}
          handleDisconnect={handleDisconnect}
          openConnectPanel={openConnectPanel}
          setConnectPanelId={setConnectPanelId}
          setDeviceCode={setDeviceCode}
          setPendingOAuth={setPendingOAuth}
          testIntegrationMcp={testIntegrationMcp}
          oauthMcpForm={oauthMcpForm}
          setOauthMcpForm={setOauthMcpForm}
          persistOauthMcp={persistOauthMcp}
        />
      )}

      {tab === 'apis' && !loading && !loadError && (
        <ApisTab
          classified={classified}
          mcpTestBusy={mcpTestBusy}
          testServerMcp={testServerMcp}
          publicApiForm={publicApiForm}
          setPublicApiForm={setPublicApiForm}
          persistPublicApi={persistPublicApi}
          apiKeyForm={apiKeyForm}
          setApiKeyForm={setApiKeyForm}
          persistApiKey={persistApiKey}
          keyedApiPanelRef={keyedApiPanelRef}
          highlightKeyedApi={highlightKeyedApi}
          editPublicApi={editPublicApi}
          editKeyedApi={editKeyedApi}
          cancelPublicApiEdit={cancelPublicApiEdit}
          cancelKeyedApiEdit={cancelKeyedApiEdit}
        />
      )}

      {tab === 'mcp' && !loading && !loadError && (
        <McpProtocolsTab
          servers={servers}
          mcpTestBusy={mcpTestBusy}
          testServerMcp={testServerMcp}
          loadMcp={loadMcp}
          mcpForm={mcpForm}
          setMcpForm={setMcpForm}
          persistMcp={persistMcp}
          editMcp={editMcp}
          cancelMcpEdit={cancelMcpEdit}
        />
      )}

      {tab === 'db' && !loading && !loadError && (
        <DbConnectionsTab
          connections={dbConnections}
          testBusy={dbTestBusy}
          testConnection={testDb}
          load={loadDb}
          persist={persistDb}
          toggle={toggleDb}
          remove={removeDb}
        />
      )}

      {status && <div className={`settings-status settings-status--${statusTone(status)}`} role="status" aria-live="polite">{status}</div>}
    </div>
  )
}
