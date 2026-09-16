// ============================================================
// Bob Work – MainLayout
// Shell principal + file d’approvals (affichage uniquement dans ChatView)
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import Sidebar from '../Sidebar/Sidebar'
import { LoadErrorBanner } from '../LoadErrorBanner'
import { completedTaskUnreadCount, useAppStore } from '../../stores/appStore'
import { getPendingApprovals, getSettings, listAppNotifications, takePendingNotificationOpen } from '../../lib/ipc'
import type { AppNotificationPayload } from '../../lib/ipc'
import { requestStartupPermissions } from '../../lib/startupPermissions'
import { useT } from '../../i18n'
import type { Approval, AppSettings } from '@bob-work/shared-types'

interface SessionDonePayload {
  sessionId?: string
  conversationId: string
  taskId?: string | null
  success?: boolean
  cancelled?: boolean
}

interface NotificationOpenPayload {
  conversationId?: string | null
  taskId?: string | null
}

export function ingestAppNotification(n: AppNotificationPayload | null | undefined) {
  if (!n?.id || !n.title) return
  const store = useAppStore.getState()
  store.pushNotification({
    id: n.id,
    title: n.title,
    body: n.body ?? '',
    kind: n.kind ?? 'info',
    createdAt: n.createdAt || new Date().toISOString(),
    taskId: n.taskId ?? null,
    conversationId: n.conversationId ?? null,
  })
}

export default function MainLayout() {
  const t = useT()
  const navigate = useNavigate()
  const location = useLocation()
  const locationRef = useRef(location.pathname)
  locationRef.current = location.pathname
  const [approvalsError, setApprovalsError] = useState<unknown>(null)
  const unreadCompletedTaskCount = useAppStore(completedTaskUnreadCount)
  const { setPendingApprovals, markConversationUnread, markCompletedTaskUnread, markConversationRead, setActiveConversation } = useAppStore((s) => ({
    setPendingApprovals: s.setPendingApprovals,
    markConversationUnread: s.markConversationUnread,
    markCompletedTaskUnread: s.markCompletedTaskUnread,
    markConversationRead: s.markConversationRead,
    setActiveConversation: s.setActiveConversation,
  }))
  const addApproval = (a: Approval) =>
    useAppStore.getState().setPendingApprovals([...useAppStore.getState().pendingApprovals, a])

  useEffect(() => {
    void getCurrentWindow()
      .setBadgeCount(unreadCompletedTaskCount > 0 ? unreadCompletedTaskCount : undefined)
      .catch(() => {})
  }, [unreadCompletedTaskCount])

  // Builder context is only meaningful inside a builder chat. Keeping it while
  // navigating elsewhere made a later ordinary conversation look like a skill
  // or plugin creation flow.
  useEffect(() => {
    if (!location.pathname.startsWith('/chat')) {
      useAppStore.getState().clearBuilderSession()
    }
  }, [location.pathname])

  // Keep the route as the navigation source of truth. In particular, project
  // hydration must never erase the conversation selected from the sidebar.
  useEffect(() => {
    const conversationId = location.pathname.match(/^\/chat\/([^/]+)$/)?.[1] ?? null
    setActiveConversation(conversationId)
  }, [location.pathname, setActiveConversation])

  const openFromNotification = (payload: NotificationOpenPayload) => {
    if (payload.conversationId) {
      markConversationRead(payload.conversationId)
      navigate(`/chat/${payload.conversationId}`)
      return
    }
    if (payload.taskId) {
      navigate('/tasks', { state: { taskId: payload.taskId } })
    }
  }

  const loadPendingApprovals = () => {
    getPendingApprovals()
      .then(items => {
        setApprovalsError(null)
        setPendingApprovals(items)
      })
      .catch(error => setApprovalsError(error))
  }

  // ── Load pending approvals on mount ────────────────────────
  useEffect(() => {
    loadPendingApprovals()
  }, [setPendingApprovals])

  // Startup permissions: notifications now; Accessibilité / Automatisation later.
  useEffect(() => {
    void requestStartupPermissions()
  }, [])

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    let current: AppSettings | null = null
    const apply = (settings: AppSettings) => {
      current = settings
      const dark = settings.theme === 'dark' || (settings.theme === 'system' && media.matches)
      document.documentElement.classList.toggle('dark', dark)
      document.documentElement.classList.toggle('reduced-motion', settings.reducedMotion)
      document.documentElement.style.fontSize = `${settings.fontSize}px`
    }
    getSettings().then(settings => {
      apply(settings)
      useAppStore.getState().setSettings(settings)
    }).catch(() => {})
    const onSystemTheme = () => current && apply(current)
    const onSettings = (event: Event) => {
      const next = (event as CustomEvent<AppSettings>).detail
      apply(next)
      useAppStore.getState().setSettings(next)
    }
    media.addEventListener('change', onSystemTheme)
    window.addEventListener('bob-settings-updated', onSettings)
    return () => { media.removeEventListener('change', onSystemTheme); window.removeEventListener('bob-settings-updated', onSettings) }
  }, [])

  useEffect(() => {
    let disposed = false
    listAppNotifications()
      .then(items => {
        if (disposed || !Array.isArray(items)) return
        for (const item of [...items].reverse()) ingestAppNotification(item)
      })
      .catch(() => {})

    let unlistenNotif: (() => void) | null = null
    listen<AppNotificationPayload>('app-notification', (event) => {
      // Keep the in-app history unread, but never steal the current view.
      // Opening the notification center is an explicit user action.
      ingestAppNotification(event.payload)
    }).then(fn => { unlistenNotif = fn })

    return () => {
      disposed = true
      unlistenNotif?.()
    }
  }, [])

  useEffect(() => {
    let unlistenApproval: (() => void) | null = null
    let unlistenOpen: (() => void) | null = null
    let unlistenDone: (() => void) | null = null

    listen<Approval>('approval-required', (event) => {
      addApproval(event.payload)
      // Never surface the card outside ChatView (Settings, Plugins, …).
      // Mark the owning conversation unread so the user can return to the prompt.
      const conversationId = useAppStore.getState().tasks.find(
        task => task.id === event.payload.taskId,
      )?.conversationId
      if (conversationId && locationRef.current !== `/chat/${conversationId}`) {
        markConversationUnread(conversationId)
      }
    }).then(fn => { unlistenApproval = fn })

    listen<NotificationOpenPayload>('notification-open', (event) => {
      void takePendingNotificationOpen()
      openFromNotification(event.payload)
    }).then(fn => { unlistenOpen = fn })

    listen<SessionDonePayload>('bob-session-done', (event) => {
      const done = event.payload
      if (done.cancelled || !done.conversationId) return
      if (locationRef.current === `/chat/${done.conversationId}`) return
      if (done.success === false) {
        markConversationUnread(done.conversationId)
        return
      }
      markCompletedTaskUnread(
        done.taskId || done.sessionId || `conversation:${done.conversationId}`,
        done.conversationId,
      )
    }).then(fn => { unlistenDone = fn })

    takePendingNotificationOpen()
      .then(pending => { if (pending) openFromNotification(pending) })
      .catch(() => {})

    return () => {
      unlistenApproval?.()
      unlistenOpen?.()
      unlistenDone?.()
    }
  }, [markConversationUnread, markCompletedTaskUnread, markConversationRead, navigate])

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main-content">
        {approvalsError ? (
          <LoadErrorBanner
            error={approvalsError}
            onRetry={loadPendingApprovals}
            fallback={t('approval.loadFailed')}
          />
        ) : null}
        <Outlet />
      </div>
    </div>
  )
}
