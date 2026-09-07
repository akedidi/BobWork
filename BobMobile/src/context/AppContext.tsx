import * as SecureStore from 'expo-secure-store'
import * as Notifications from 'expo-notifications'
import Constants from 'expo-constants'
import * as Device from 'expo-device'
import React, { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState } from 'react-native'
import EventSource, { type EventSourceListener } from 'react-native-sse'
import { ApiError, BobApi, CONNECTION_TIMEOUT_MS, parseConnectionLink } from '../api'
import { deviceLanguage, Language, translate, TranslationKey } from '../i18n'
import type { Approval, Bootstrap, Connection, LiveEnvelope, SyncSnapshot, UsageStatus } from '../types'

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
})

const CONNECTION_KEY = 'bob_mobile_connection_v1'
const LANGUAGE_KEY = 'bob_mobile_language_v1'
const UNREAD_KEY = 'bob_mobile_unread_conversations_v1'
const DEV_CONNECTION_LINK = __DEV__ ? process.env.EXPO_PUBLIC_BOB_MOBILE_DEV_LINK : undefined
const DEV_FORCE_CONNECTION = __DEV__ && process.env.EXPO_PUBLIC_BOB_MOBILE_DEV_FORCE_LINK === '1'
export const USAGE_REFRESH_INTERVAL_MS = 60_000

interface AppContextValue {
  ready: boolean
  connection: Connection | null
  api: BobApi | null
  bootstrap: Bootstrap | null
  usage: UsageStatus | null
  history: SyncSnapshot | null
  historyLoading: boolean
  historyError: boolean
  connected: boolean
  liveConnected: boolean
  liveEvents: LiveEnvelope[]
  approvals: Approval[]
  notificationConversationId: string | null
  unreadConversationIds: string[]
  language: Language
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
  connect: (link: string) => Promise<void>
  disconnect: () => Promise<void>
  setLanguage: (language: Language) => Promise<void>
  refreshBootstrap: () => Promise<void>
  refreshUsage: () => Promise<void>
  refreshHistory: () => Promise<void>
  refreshApprovals: () => Promise<void>
  clearNotificationTarget: () => void
  markConversationRead: (id: string) => void
  setActiveConversationId: (id: string | null) => void
}

export const AppContext = createContext<AppContextValue>(null as never)

async function verifyConnection(api: BobApi) {
  const [health, bootstrap, history, usage] = await Promise.all([
    api.health(CONNECTION_TIMEOUT_MS),
    api.bootstrap(CONNECTION_TIMEOUT_MS),
    api.sync(CONNECTION_TIMEOUT_MS),
    api.usage(CONNECTION_TIMEOUT_MS).catch(() => null),
  ])
  if (health.status !== 'ok' || health.apiVersion !== bootstrap.apiVersion) {
    throw new ApiError('api-unavailable')
  }
  return { bootstrap, history, usage }
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  const [connection, setConnection] = useState<Connection | null>(null)
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null)
  const [usage, setUsage] = useState<UsageStatus | null>(null)
  const [history, setHistory] = useState<SyncSnapshot | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState(false)
  const [apiConnected, setApiConnected] = useState(false)
  const [liveConnected, setLiveConnected] = useState(false)
  const [liveEvents, setLiveEvents] = useState<LiveEnvelope[]>([])
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [notificationConversationId, setNotificationConversationId] = useState<string | null>(null)
  const [unreadConversationIds, setUnreadConversationIds] = useState<string[]>([])
  const [language, setLanguageState] = useState<Language>(deviceLanguage())
  const syncing = useRef(false)
  const pushToken = useRef<string | null>(null)
  const activeConversationId = useRef<string | null>(null)

  useEffect(() => {
    void Promise.all([SecureStore.getItemAsync(CONNECTION_KEY), SecureStore.getItemAsync(LANGUAGE_KEY), SecureStore.getItemAsync(UNREAD_KEY)]).then(async ([storedConnection, storedLanguage, storedUnread]) => {
      if (storedUnread) {
        try { setUnreadConversationIds(JSON.parse(storedUnread) as string[]) } catch { /* ignore stale local state */ }
      }
      if (storedConnection && !DEV_FORCE_CONNECTION) {
        try {
          const restored = JSON.parse(storedConnection) as Connection
          setConnection(restored)
          const restoredApi = new BobApi(restored)
          const { bootstrap: remote, history: snapshot, usage: remoteUsage } = await verifyConnection(restoredApi)
          setBootstrap(remote)
          setUsage(remoteUsage)
          setHistory(snapshot)
          setApiConnected(true)
          setHistoryError(false)
          if (!storedLanguage && (remote.settings.language === 'fr' || remote.settings.language === 'en' || remote.settings.language === 'es')) {
            setLanguageState(remote.settings.language)
          }
        } catch {
          // Never display an old in-memory snapshot as if it still represented
          // the Mac. A Cloudflare quick-tunnel URL changes when Bob Work is
          // restarted, so the saved link may legitimately need replacing.
          setHistory(null)
          setApiConnected(false)
          setHistoryError(true)
        }
      } else if (DEV_CONNECTION_LINK) {
        // A development link is only a first-launch convenience. It must never
        // replace a connection explicitly saved by the user, otherwise the
        // simulator can silently display another Bob Work instance.
        const previewConnection = parseConnectionLink(DEV_CONNECTION_LINK)
        setConnection(previewConnection)
        const previewApi = new BobApi(previewConnection)
        const { bootstrap: remote, history: snapshot, usage: remoteUsage } = await verifyConnection(previewApi)
        setBootstrap(remote)
        setUsage(remoteUsage)
        setHistory(snapshot)
        setApiConnected(true)
        setHistoryError(false)
        if (!storedLanguage && (remote.settings.language === 'fr' || remote.settings.language === 'en' || remote.settings.language === 'es')) {
          setLanguageState(remote.settings.language)
        }
      }
      if (storedLanguage === 'fr' || storedLanguage === 'en' || storedLanguage === 'es') {
        setLanguageState(storedLanguage)
      }
    }).catch(() => {
      // A stale development preview link must never surface as an unhandled
      // error or prevent the user from reconnecting manually.
      setHistory(null)
      setApiConnected(false)
      setHistoryError(true)
    }).finally(() => setReady(true))
  }, [])

  useEffect(() => {
    if (ready) void SecureStore.setItemAsync(UNREAD_KEY, JSON.stringify(unreadConversationIds))
  }, [ready, unreadConversationIds])

  const api = useMemo(() => connection ? new BobApi(connection) : null, [connection])
  const t = useCallback((key: TranslationKey, params?: Record<string, string | number>) => translate(language, key, params), [language])

  const refreshHistory = useCallback(async () => {
    if (!api || syncing.current) return
    syncing.current = true
    setHistoryLoading(true)
    try {
      const [health, snapshot] = await Promise.all([api.health(), api.sync()])
      if (health.status !== 'ok') throw new ApiError('api-unavailable')
      setHistory(snapshot)
      setHistoryError(false)
      setApiConnected(true)
    } catch {
      // Bob Work/SQLite is the only source of truth. Keeping an older list on
      // screen while the Mac is unreachable made stale conversations look like
      // a second mobile history.
      setHistory(null)
      setHistoryError(true)
      setApiConnected(false)
      setLiveConnected(false)
    } finally {
      syncing.current = false
      setHistoryLoading(false)
    }
  }, [api])

  useEffect(() => {
    if (!api) return
    void refreshHistory()
    const timer = setInterval(() => void refreshHistory(), 4000)
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void refreshHistory()
    })
    return () => {
      clearInterval(timer)
      subscription.remove()
    }
  }, [api, refreshHistory])

  const refreshBootstrap = useCallback(async () => {
    if (!api) return
    try { setBootstrap(await api.bootstrap()) }
    catch {
      setApiConnected(false)
      setLiveConnected(false)
      setHistory(null)
      setHistoryError(true)
    }
  }, [api])

  const refreshUsage = useCallback(async () => {
    if (!api) return
    try { setUsage(await api.usage()) }
    catch { /* Keep the last timestamped snapshot during a transient tunnel error. */ }
  }, [api])

  useEffect(() => {
    if (!api) return
    const timer = setInterval(() => void refreshBootstrap(), 15_000)
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void refreshBootstrap()
    })
    return () => {
      clearInterval(timer)
      subscription.remove()
    }
  }, [api, refreshBootstrap])

  useEffect(() => {
    if (!api) return
    void refreshUsage()
    const timer = setInterval(() => void refreshUsage(), USAGE_REFRESH_INTERVAL_MS)
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void refreshUsage()
    })
    return () => {
      clearInterval(timer)
      subscription.remove()
    }
  }, [api, refreshUsage])

  const refreshApprovals = useCallback(async () => {
    if (!api) return
    try { setApprovals(await api.approvals()) } catch { /* the live stream will retry */ }
  }, [api])

  useEffect(() => {
    if (!api) {
      setLiveConnected(false)
      setLiveEvents([])
      setApprovals([])
      return
    }
    if (Device.isDevice) void Notifications.getPermissionsAsync().then(permission => {
      if (!permission.granted && permission.canAskAgain) return Notifications.requestPermissionsAsync()
      return permission
    }).then(async permission => {
      if (!permission?.granted || !Device.isDevice) return
      const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId
      if (typeof projectId !== 'string' || !projectId) return
      const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data
      pushToken.current = token
      await api.registerPushToken({ token, platform: Device.osName ?? undefined, deviceName: Device.modelName ?? undefined, language })
    }).catch(() => undefined)
    void refreshApprovals()

    const events = new EventSource(api.eventsUrl(), {
      headers: { Authorization: `Bearer ${connection?.accessToken ?? ''}` },
      pollingInterval: 2000,
      // The server emits a keep-alive every 10 seconds. A bounded timeout makes
      // a dead tunnel observable while still allowing normal quiet periods.
      timeout: 25_000,
    })
    const onOpen: EventSourceListener<never, 'open'> = () => setLiveConnected(true)
    const onError: EventSourceListener<never, 'error'> = () => setLiveConnected(false)
    const onMessage: EventSourceListener<never, 'message'> = event => {
      if (!event.data) return
      try {
        const envelope = JSON.parse(event.data) as LiveEnvelope
        setLiveEvents(current => [envelope, ...current].slice(0, 160))
        const payload = envelope.payload && typeof envelope.payload === 'object' ? envelope.payload as Record<string, unknown> : {}
        if (envelope.type === 'connected') setLiveConnected(true)
        if (['task-updated', 'bob-session-done', 'conversation-updated', 'conversation-messages-changed', 'project-updated', 'artifacts-updated', 'schedule-updated'].includes(envelope.type)) {
          void refreshHistory()
        }
        if (envelope.type === 'approval-required' || envelope.type === 'approval-resolved') {
          void refreshApprovals()
        }
        if (envelope.type === 'approval-required' && !pushToken.current) {
          const body = typeof payload.humanDescription === 'string' ? payload.humanDescription : translate(language, 'notificationApproval')
          void Notifications.scheduleNotificationAsync({
            content: { title: translate(language, 'notificationApproval'), body: body.slice(0, 180), data: { taskId: payload.taskId } },
            trigger: null,
          }).catch(() => undefined)
        }
        if (envelope.type === 'bob-session-done' && !pushToken.current) {
          const success = payload.success === true
          const content = typeof payload.fullOutput === 'string' ? payload.fullOutput : typeof payload.error === 'string' ? payload.error : ''
          void Notifications.scheduleNotificationAsync({
            content: {
              title: translate(language, success ? 'notificationTaskDone' : 'notificationTaskFailed'),
              body: content.trim().slice(0, 180) || translate(language, success ? 'taskCompleted' : 'taskFailed'),
              data: { conversationId: payload.conversationId, taskId: payload.taskId },
            },
            trigger: null,
          }).catch(() => undefined)
        }
        if (envelope.type === 'bob-session-done' && typeof payload.conversationId === 'string' && payload.conversationId !== activeConversationId.current) {
          setUnreadConversationIds(current => current.includes(payload.conversationId as string) ? current : [...current, payload.conversationId as string])
        }
      } catch { /* ignore malformed live envelopes and keep the stream open */ }
    }
    events.addEventListener('open', onOpen)
    events.addEventListener('message', onMessage)
    events.addEventListener('error', onError)
    return () => {
      events.removeAllEventListeners()
      events.close()
      setLiveConnected(false)
    }
  }, [api, connection?.accessToken, language, refreshApprovals, refreshHistory])

  useEffect(() => {
    const response = Notifications.addNotificationResponseReceivedListener(event => {
      const value = event.notification.request.content.data?.conversationId
      if (typeof value === 'string') setNotificationConversationId(value)
    })
    void Notifications.getLastNotificationResponseAsync().then(event => {
      const value = event?.notification.request.content.data?.conversationId
      if (typeof value === 'string') setNotificationConversationId(value)
    }).catch(() => undefined)
    return () => response.remove()
  }, [])

  const connect = useCallback(async (link: string) => {
    const next = parseConnectionLink(link)
    const nextApi = new BobApi(next)
    const { bootstrap: remote, history: snapshot, usage: remoteUsage } = await verifyConnection(nextApi)
    const storedLanguage = await SecureStore.getItemAsync(LANGUAGE_KEY)
    await SecureStore.setItemAsync(CONNECTION_KEY, JSON.stringify(next))
    setConnection(next)
    setBootstrap(remote)
    setUsage(remoteUsage)
    setHistory(snapshot)
    setHistoryError(false)
    setApiConnected(true)
    if (!storedLanguage && (remote.settings.language === 'fr' || remote.settings.language === 'en' || remote.settings.language === 'es')) {
      setLanguageState(remote.settings.language)
    }
  }, [])

  const disconnect = useCallback(async () => {
    if (api && pushToken.current) {
      await api.unregisterPushToken({ token: pushToken.current }).catch(() => undefined)
      pushToken.current = null
    }
    await SecureStore.deleteItemAsync(CONNECTION_KEY)
    setConnection(null)
    setBootstrap(null)
    setUsage(null)
    setHistory(null)
    setHistoryError(false)
    setApiConnected(false)
    setLiveEvents([])
    setApprovals([])
    setNotificationConversationId(null)
    setUnreadConversationIds([])
    activeConversationId.current = null
    await SecureStore.deleteItemAsync(UNREAD_KEY)
  }, [api])

  const setLanguage = useCallback(async (next: Language) => {
    await SecureStore.setItemAsync(LANGUAGE_KEY, next)
    setLanguageState(next)
  }, [])

  const clearNotificationTarget = useCallback(() => setNotificationConversationId(null), [])
  const markConversationRead = useCallback((id: string) => setUnreadConversationIds(current => current.filter(value => value !== id)), [])
  const setActiveConversationId = useCallback((id: string | null) => {
    activeConversationId.current = id
    if (id) setUnreadConversationIds(current => current.filter(value => value !== id))
  }, [])

  // The status shown in the main UI represents access to Bob Work's API and
  // SQLite snapshot. The SSE state remains separate for live task streaming.
  const connected = Boolean(connection && apiConnected)

  return (
    <AppContext.Provider value={{ ready, connection, api, bootstrap, usage, history, historyLoading, historyError, connected, liveConnected, liveEvents, approvals, notificationConversationId, unreadConversationIds, language, t, connect, disconnect, setLanguage, refreshBootstrap, refreshUsage, refreshHistory, refreshApprovals, clearNotificationTarget, markConversationRead, setActiveConversationId }}>
      {children}
    </AppContext.Provider>
  )
}
