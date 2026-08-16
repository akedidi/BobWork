// ============================================================
// Bob Work – Sidebar
// Navigation principale + données réelles via IPC
// ============================================================

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import { Archive, FolderTree } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import { createConversation, getProjects, getConversations, getTasks, detectBob, getBobAuthSnapshot, searchWorkspace, updateConversation, updateTaskPinned, getUsageStatus } from '../../lib/ipc'
import { errorMessage } from '../../lib/errorMessage'
import { useT } from '../../i18n'
import { listen } from '@tauri-apps/api/event'
import type { SearchResult, UsageStatus } from '@bob-work/shared-types'
import { UsageMeter } from '../UsageMeter/UsageMeter'
import { activeTasksByConversationId, conversationActivity } from '../../lib/activeTasks'
import { ModalOverlay, ModalPanel } from '../ModalOverlay'

const CONTEXT_MENU_WIDTH = 220
const CONTEXT_MENU_HEIGHT = 168

/** Place the menu near the cursor without overflowing the viewport. */
export function clampContextMenuPosition(x: number, y: number, viewportWidth = window.innerWidth, viewportHeight = window.innerHeight) {
  return {
    x: Math.max(8, Math.min(x, viewportWidth - CONTEXT_MENU_WIDTH - 8)),
    y: Math.max(8, Math.min(y, viewportHeight - CONTEXT_MENU_HEIGHT - 8)),
  }
}

export default function Sidebar() {
  const t = useT()
  const navigate = useNavigate()
  const location = useLocation()
  const searchEntityLabel = (entityType: string) => {
    const key = `search.${entityType}`
    const translated = t(key)
    return translated === key ? entityType : translated
  }
  const {
    projects, setProjects,
    conversations, setConversations,
    tasks, setTasks,
    bobStatus, setBobStatus, setBobInfo,
    notifications, notificationsOpen, setNotificationsOpen,
    markNotificationsRead, clearNotifications,
    unreadConversationIds, markConversationRead,
  } = useAppStore()
  const unreadCount = notifications.filter(item => !item.read).length

  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchError, setSearchError] = useState<unknown>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, conversationId: string } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [projectPicker, setProjectPicker] = useState<{ conversationId: string } | null>(null)
  const [usage, setUsage] = useState<UsageStatus | null>(null)
  const [sidebarLoadError, setSidebarLoadError] = useState<string | null>(null)

  const searchTriggerRef = useRef<HTMLButtonElement>(null)

  const activeTasksByConversation = useMemo(
    () => activeTasksByConversationId(tasks),
    [tasks],
  )

  const unreadSet = useMemo(
    () => new Set(unreadConversationIds),
    [unreadConversationIds],
  )
  const runningIds = useMemo(
    () => new Set(activeTasksByConversation.keys()),
    [activeTasksByConversation],
  )

  const openConversation = (conversationId: string) => {
    markConversationRead(conversationId)
    navigate(`/chat/${conversationId}`)
  }

  const startNewConversation = () => {
    navigate('/')
    setSidebarLoadError(null)
  }

  const conversationIcon = (conversationId: string, idle?: ReactNode) => {
    const activity = conversationActivity(conversationId, runningIds, unreadSet)
    if (activity === 'running') {
      return <span className="task-spinner" aria-label="Tâche en cours" />
    }
    if (activity === 'unread') {
      return <span className="conversation-unread-dot" aria-label="Résultat non consulté" />
    }
    return idle ?? null
  }

  const closeSearch = () => {
    setSearchOpen(false)
    setSearchQuery('')
    setSearchResults([])
  }

  const refreshUsage = (force = false) => {
    getUsageStatus(force).then(setUsage).catch(() => setUsage(null))
  }

  useEffect(() => {
    refreshUsage()
  }, [])

  // Retry usage once Bob is ready (API key / binary detected).
  useEffect(() => {
    if (bobStatus === 'ready' || bobStatus === 'unauthenticated') {
      refreshUsage()
    }
  }, [bobStatus])

  useEffect(() => {
    let disposed = false
    let unlistenUsage: (() => void) | null = null
    let unlistenDone: (() => void) | null = null
    listen<UsageStatus>('usage-updated', event => {
      if (!disposed) setUsage(event.payload)
    }).then(fn => {
      if (disposed) fn(); else unlistenUsage = fn
    })
    listen('bob-session-done', () => {
      if (!disposed) refreshUsage(true)
    }).then(fn => {
      if (disposed) fn(); else unlistenDone = fn
    })
    return () => { disposed = true; unlistenUsage?.(); unlistenDone?.() }
  }, [])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | null = null
    listen<string>('conversation-updated', () => {
      getConversations()
        .then(next => {
          if (!disposed) {
            setConversations(next)
            setSidebarLoadError(null)
          }
        })
        .catch(error => {
          if (!disposed) setSidebarLoadError(errorMessage(error, 'Impossible d’actualiser la barre latérale.'))
        })
    }).then(fn => {
      if (disposed) fn(); else unlisten = fn
    })
    return () => { disposed = true; unlisten?.() }
  }, [setConversations])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | null = null
    listen<string>('task-updated', () => {
      getTasks()
        .then(next => {
          if (!disposed) {
            setTasks(next)
            setSidebarLoadError(null)
          }
        })
        .catch(error => {
          if (!disposed) setSidebarLoadError(errorMessage(error, 'Impossible d’actualiser la barre latérale.'))
        })
    }).then(fn => {
      if (disposed) fn(); else unlisten = fn
    })
    return () => { disposed = true; unlisten?.() }
  }, [setTasks])

  // ── Load projects + conversations + detect Bob on mount ───────
  useEffect(() => {
    let loadFailed = false
    const noteFailure = (error: unknown) => {
      if (loadFailed) return
      loadFailed = true
      setSidebarLoadError(errorMessage(error, 'Impossible de charger la barre latérale.'))
    }

    // Detect Bob without installing or mutating the user's machine.
    getBobAuthSnapshot()
      .then((snapshot) => {
        setBobInfo({
          found: snapshot.found,
          path: snapshot.path,
          version: snapshot.version,
          authenticated: snapshot.authenticated,
        })
        setBobStatus(!snapshot.found ? 'not_found' : !snapshot.authenticated ? 'unauthenticated' : 'ready')
      })
      .catch(() => detectBob()
        .then((result) => {
          setBobInfo(result)
          setBobStatus(!result.found ? 'not_found' : !result.authenticated ? 'unauthenticated' : 'ready')
        })
        .catch(error => {
          setBobStatus('error')
          noteFailure(error)
        }))

    // Load projects
    getProjects()
      .then(ps => {
        setProjects(ps)
        // Auto-expand first project
        if (ps.length > 0) setExpandedProjects(new Set([ps[0].id]))
      })
      .catch(noteFailure)

    // Load recent conversations (no project)
    getConversations()
      .then(setConversations)
      .catch(noteFailure)

    getTasks()
      .then(setTasks)
      .catch(noteFailure)
  }, [])

  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); setSearchError(null); return }
    const timer = window.setTimeout(() => {
      searchWorkspace(searchQuery, 40)
        .then(results => {
          setSearchError(null)
          setSearchResults(results)
        })
        .catch(error => {
          setSearchResults([])
          setSearchError(error)
        })
    }, 180)
    return () => window.clearTimeout(timer)
  }, [searchQuery])

  useEffect(() => {
    if (notificationsOpen) setSearchOpen(false)
  }, [notificationsOpen])

  const openSearchResult = (result: SearchResult) => {
    closeSearch()
    if (result.entityType === 'project') navigate(`/project/${result.entityId}`)
    else if (result.entityType === 'task') navigate('/tasks', { state: { taskId: result.entityId } })
    else navigate(`/chat/${result.entityId}`)
  }

  const toggleProject = (id: string) =>
    setExpandedProjects(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const isActive = (path: string) =>
    location.pathname === path || location.pathname.startsWith(path + '/')

  const recentConversations = conversations
    .filter(conversation => !conversation.projectId && !conversation.archived)
    // Pinned chats stay visible here too; Épinglés is a shortcut, not a sort key.
    // Order by last activity (date) only — never hoist pinned to the top.
    .sort((left, right) => Date.parse(right.date) - Date.parse(left.date))
    .slice(0, 12)

  const pinnedConversations = conversations.filter(conversation => conversation.pinned)
  const pinnedTasks = tasks.filter(task => task.pinned)

  const searchRecentChats = conversations
    .filter(conversation => !conversation.archived)
    .sort((left, right) => Date.parse(right.date) - Date.parse(left.date))
    .slice(0, 10)

  const projectNameById = (projectId?: string | null) => {
    if (!projectId) return null
    return projects.find(project => project.id === projectId)?.name ?? null
  }

  const setConversationPinned = async (conversationId: string, pinned: boolean) => {
    setConversations(conversations.map(conversation => conversation.id === conversationId ? { ...conversation, pinned } : conversation))
    try {
      await updateConversation(conversationId, { pinned })
    } catch (error) {
      setSidebarLoadError(errorMessage(error, 'Impossible de mettre à jour la conversation.'))
      getConversations().then(setConversations).catch(() => {})
    }
  }

  const setTaskPinned = async (taskId: string, pinned: boolean) => {
    setTasks(tasks.map(task => task.id === taskId ? { ...task, pinned } : task))
    try {
      await updateTaskPinned(taskId, pinned)
    } catch (error) {
      setSidebarLoadError(errorMessage(error, 'Impossible de mettre à jour la tâche.'))
      getTasks().then(setTasks).catch(() => {})
    }
  }

  useEffect(() => {
    const activeId = location.pathname.match(/^\/chat\/([^/]+)/)?.[1]
    const projectId = conversations.find(conversation => conversation.id === activeId)?.projectId
    if (!projectId) return
    setExpandedProjects(previous => {
      if (previous.has(projectId)) return previous
      const next = new Set(previous)
      next.add(projectId)
      return next
    })
  }, [conversations, location.pathname])

  const handleArchive = async (conversationId: string) => {
    setConversations(conversations.map(c => c.id === conversationId ? { ...c, archived: true } : c))
    try {
      await updateConversation(conversationId, { archived: true })
    } catch (error) {
      setSidebarLoadError(errorMessage(error, 'Impossible d’archiver la conversation.'))
      getConversations().then(setConversations).catch(() => {})
    }
  }

  const submitEdit = async (id: string) => {
    if (editingId && editTitle.trim()) {
      setConversations(conversations.map(c => c.id === id ? { ...c, title: editTitle.trim() } : c))
      try {
        await updateConversation(id, { title: editTitle.trim() })
      } catch (error) {
        setSidebarLoadError(errorMessage(error, 'Impossible de renommer la conversation.'))
        getConversations().then(setConversations).catch(() => {})
      }
    }
    setEditingId(null)
  }

  const startEdit = (id: string, currentTitle: string) => {
    setEditTitle(currentTitle)
    setEditingId(id)
    setContextMenu(null)
  }

  const openConversationMenu = (conversationId: string, clientX: number, clientY: number) => {
    const { x, y } = clampContextMenuPosition(clientX, clientY)
    setContextMenu({ x, y, conversationId })
  }

  useEffect(() => {
    const onPointerDown = () => {
      setContextMenu(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenu(null)
        closeSearch()
        setNotificationsOpen(false)
      }
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  const runSearchSuggestion = (path: string) => {
    closeSearch()
    navigate(path)
  }

  return (
    <div className="sidebar" style={{ backdropFilter: 'blur(30px)' }}>
      {/* Header: Bob Work + search/notifications on one row (ChatGPT Work style) */}
      <div className="sidebar-header titlebar-drag" data-tauri-drag-region>
        <span className="sidebar-brand titlebar-no-drag">Bob Work</span>
        <div className="sidebar-header-spacer" data-tauri-drag-region />
        <button
          ref={searchTriggerRef}
          type="button"
          className="icon-btn titlebar-no-drag sidebar-header-btn"
          title={t('nav.search')}
          onPointerDown={event => event.stopPropagation()}
          onClick={() => {
            setNotificationsOpen(false)
            setSearchOpen(true)
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
        </button>
        <button
          type="button"
          className={`icon-btn titlebar-no-drag sidebar-header-btn ${notificationsOpen ? 'active' : ''}`}
          title={t('nav.notifications')}
          aria-label={unreadCount > 0 ? `${t('nav.notifications')} (${unreadCount})` : t('nav.notifications')}
          aria-expanded={notificationsOpen}
          aria-pressed={notificationsOpen}
          style={{ position: 'relative' }}
          onPointerDown={event => event.stopPropagation()}
          onClick={() => {
            setSearchOpen(false)
            if (notificationsOpen) {
              setNotificationsOpen(false)
              return
            }
            setNotificationsOpen(true)
            markNotificationsRead()
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
          </svg>
          {unreadCount > 0 && (
            <span
              aria-label={`${unreadCount}`}
              style={{
                position: 'absolute',
                top: 2,
                right: 2,
                minWidth: 14,
                height: 14,
                padding: '0 3px',
                borderRadius: 99,
                background: 'var(--accent)',
                color: '#fff',
                fontSize: 9,
                fontWeight: 700,
                lineHeight: '14px',
                textAlign: 'center',
              }}
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
        {sidebarLoadError ? (
          <p style={{ margin: '4px 0 0', padding: '0 4px', fontSize: 11, color: 'var(--danger, #da1e28)', lineHeight: 1.35, width: '100%' }}>
            {sidebarLoadError}
          </p>
        ) : null}
      </div>

      {notificationsOpen ? (
        <div className="sidebar-priority" role="region" aria-label={t('nav.priority')}>
          <div className="sidebar-priority-header">
            <strong>{t('nav.priority')}</strong>
            {notifications.length > 0 && (
              <button type="button" className="link-btn" style={{ fontSize: 11 }} onClick={() => clearNotifications()}>
                {t('nav.clearAll')}
              </button>
            )}
          </div>
          <div className="sidebar-priority-body">
            {notifications.length === 0 ? (
              <div className="sidebar-priority-empty">{t('nav.noNotifications')}</div>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {notifications.map(item => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`sidebar-priority-item ${item.read ? '' : 'unread'}`}
                      onClick={() => {
                        setNotificationsOpen(false)
                        if (item.conversationId) {
                          markConversationRead(item.conversationId)
                          navigate(`/chat/${item.conversationId}`)
                        }
                        else if (item.taskId) navigate('/tasks', { state: { taskId: item.taskId } })
                        else navigate('/tasks')
                      }}
                    >
                      <div className="sidebar-priority-item__title">{item.title}</div>
                      <div className="sidebar-priority-item__body">{item.body}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="sidebar-nav">
            <div
              className="sidebar-item"
              onClick={() => { void startNewConversation() }}
              aria-disabled={false}
              style={{ fontWeight: 500, color: 'var(--text-primary)' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" opacity={0.6}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              {t('nav.newChat')}
            </div>
            <div className="sidebar-item" onClick={() => navigate('/schedules')} style={{ color: 'var(--text-secondary)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" opacity={0.6}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              {t('nav.scheduled')}
            </div>
            <div className="sidebar-item" onClick={() => navigate('/tasks')} style={{ color: 'var(--text-secondary)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" opacity={0.6}><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
              {t('nav.tasks')}
            </div>
            <div className="sidebar-item" onClick={() => navigate('/artifacts')} style={{ color: 'var(--text-secondary)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" opacity={0.6}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
              {t('nav.artifacts')}
            </div>
            <div className="sidebar-item" onClick={() => navigate('/plugins')} style={{ color: 'var(--text-secondary)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" opacity={0.6}>
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
              </svg>
              {t('nav.plugins')}
            </div>
            <div className="sidebar-item" onClick={() => navigate('/skills')} style={{ color: 'var(--text-secondary)' }}>
              <span style={{ width: 16, textAlign: 'center' }}>✦</span> {t('nav.skills')}
            </div>
            <div className="sidebar-item" onClick={() => navigate('/integrations')} style={{ color: 'var(--text-secondary)' }}>
              <span style={{ width: 16, textAlign: 'center' }}>↗</span> {t('nav.integrations')}
            </div>
          </div>

          <div className="sidebar-content">
            {/* Pinned */}
            <div className="sidebar-section-label" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'none', paddingLeft: 8 }}>Épinglés</div>
            {pinnedConversations.length === 0 && pinnedTasks.length === 0 ? <div style={{ padding: '7px 10px 16px', color: 'var(--text-muted)', fontSize: 11.5 }}>Aucun élément épinglé</div> : <>
              {pinnedConversations.map(conversation => <div
                key={conversation.id}
                data-conversation-id={conversation.id}
                data-conversation-location="pinned"
                className={`sidebar-item ${isActive(`/chat/${conversation.id}`) ? 'active' : ''}`}
                onClick={() => openConversation(conversation.id)}
                title={conversation.title}
              >
                {conversationIcon(conversation.id, <span aria-hidden="true" style={{ opacity: .55 }}>◇</span>)}
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{conversation.title}</span>
                <button className="sidebar-inline-action" onClick={event => { event.stopPropagation(); setConversationPinned(conversation.id, false) }} title="Désépingler la conversation" aria-label={`Désépingler ${conversation.title}`}><PinIcon filled /></button>
              </div>)}
              {pinnedTasks.map(task => <div key={task.id} className="sidebar-item" onClick={() => navigate('/tasks', { state: { taskId: task.id } })} title={task.objective}>
                <span aria-hidden="true" style={{ opacity: .55 }}>✓</span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.objective}</span>
                <button className="sidebar-inline-action" onClick={event => { event.stopPropagation(); setTaskPinned(task.id, false) }} title="Désépingler la tâche" aria-label={`Désépingler ${task.objective}`}><PinIcon filled /></button>
              </div>)}
            </>}

            {/* Projects */}
            <div className="sidebar-section-label" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'none', paddingLeft: 8, marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Projets</span>
              <button className="icon-btn" title="Nouveau projet" aria-label="Nouveau projet" onClick={() => navigate('/project/new')} style={{ fontSize: 18, lineHeight: 1 }}>+</button>
            </div>
            {projects.length === 0 ? (
              <div style={{ padding: '8px 12px', fontSize: 13, color: 'var(--text-muted)' }}>Aucun projet</div>
            ) : (
              projects.filter(p => !p.archived).map(proj => {
                const isExpanded = expandedProjects.has(proj.id)
                const projConvs = conversations.filter(c => c.projectId === proj.id)

                return (
                  <div key={proj.id} style={{ marginBottom: 4 }}>
                    <div
                      className={`sidebar-item ${isExpanded ? 'active-project' : ''}`}
                      onClick={() => { toggleProject(proj.id); navigate(`/project/${proj.id}`) }}
                      style={{
                        fontWeight: 500,
                        color: isExpanded ? 'var(--text-primary)' : 'var(--text-secondary)',
                        backgroundColor: isExpanded ? 'rgba(0,0,0,0.06)' : 'transparent',
                        borderRadius: '8px',
                      }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" opacity={0.5}>
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                      </svg>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{proj.name}</span>
                    </div>
                    {isExpanded && projConvs.length > 0 && (
                      <div style={{ paddingLeft: 24, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {projConvs.map(c => (
                          <div
                            key={c.id}
                            className={`sidebar-item sub-item ${isActive(`/chat/${c.id}`) ? 'active' : ''}`}
                            onClick={() => { if (editingId !== c.id) openConversation(c.id) }}
                            onDoubleClick={() => startEdit(c.id, c.title)}
                            onContextMenu={(e) => { e.preventDefault(); openConversationMenu(c.id, e.clientX, e.clientY) }}
                            style={{ fontSize: 13, padding: '6px 8px', color: 'var(--text-secondary)', borderRadius: '6px' }}
                          >
                            {editingId === c.id ? (
                              <input
                                autoFocus
                                value={editTitle}
                                onChange={e => setEditTitle(e.target.value)}
                                onBlur={() => submitEdit(c.id)}
                                onKeyDown={e => { if (e.key === 'Enter') submitEdit(c.id); else if (e.key === 'Escape') setEditingId(null); }}
                                className="bg-transparent text-inherit outline-none flex-1 border-none"
                                style={{ minWidth: 0, padding: 0 }}
                              />
                            ) : (
                              <>
                                {conversationIcon(c.id)}
                                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
                              </>
                            )}
                            <div style={{ display: 'flex', gap: 4 }} className="sidebar-inline-action">
                               <button onClick={event => { event.stopPropagation(); setConversationPinned(c.id, !c.pinned) }} title={c.pinned ? 'Désépingler la conversation' : 'Épingler la conversation'} aria-label={`${c.pinned ? 'Désépingler' : 'Épingler'} ${c.title}`}><PinIcon filled={c.pinned} /></button>
                               <button onClick={event => { event.stopPropagation(); handleArchive(c.id) }} title="Archiver la conversation" aria-label={`Archiver ${c.title}`}><Archive size={13} strokeWidth={1.8} /></button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })
            )}

            {/* Recent local conversations outside projects */}
            <div className="sidebar-section-label" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'none', paddingLeft: 8, marginTop: 12 }}>Conversations</div>
            <div aria-label="Conversations récentes">
              {recentConversations.length === 0 ? (
                <div style={{ padding: '7px 10px 16px', color: 'var(--text-muted)', fontSize: 11.5 }}>Aucune conversation</div>
              ) : recentConversations.map(conversation => (
                <div
                  key={conversation.id}
                  data-conversation-id={conversation.id}
                  data-conversation-location="recent"
                  className={`sidebar-item ${isActive(`/chat/${conversation.id}`) ? 'active' : ''}`}
                  onClick={() => { if (editingId !== conversation.id) openConversation(conversation.id) }}
                  onDoubleClick={() => startEdit(conversation.id, conversation.title)}
                  onContextMenu={(e) => { e.preventDefault(); openConversationMenu(conversation.id, e.clientX, e.clientY) }}
                  title={conversation.title}
                  style={{ fontSize: 13, color: 'var(--text-secondary)' }}
                >
                  {editingId === conversation.id ? (
                     <input
                       autoFocus
                       value={editTitle}
                       onChange={e => setEditTitle(e.target.value)}
                       onBlur={() => submitEdit(conversation.id)}
                       onKeyDown={e => { if (e.key === 'Enter') submitEdit(conversation.id); else if (e.key === 'Escape') setEditingId(null); }}
                       className="bg-transparent text-inherit outline-none flex-1 border-none"
                       style={{ minWidth: 0, padding: 0 }}
                     />
                  ) : (
                    <>
                      {conversationIcon(conversation.id)}
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{conversation.title}</span>
                    </>
                  )}
                  <div style={{ display: 'flex', gap: 4 }} className="sidebar-inline-action">
                     <button onClick={event => { event.stopPropagation(); setConversationPinned(conversation.id, true) }} title="Épingler la conversation" aria-label={`Épingler ${conversation.title}`}><PinIcon /></button>
                     <button onClick={event => { event.stopPropagation(); handleArchive(conversation.id) }} title="Archiver la conversation" aria-label={`Archiver ${conversation.title}`}><Archive size={13} strokeWidth={1.8} /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Footer / User Profile */}
      <div className="sidebar-footer" style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0, marginBottom: 8 }}>
        {(bobStatus === 'ready' || usage?.available) && (
          <UsageMeter
            usage={usage}
            compact
            onClick={() => navigate('/settings', { state: { tab: 'bob' } })}
          />
        )}
        {bobStatus === 'ready' || bobStatus === 'unauthenticated' ? (
          <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '6px 14px 6px 8px', borderRadius: 6, flex: 1, width: '100%', minWidth: 0, boxSizing: 'border-box' }} onClick={() => navigate('/settings', { state: { tab: 'bob' } })} className="hover:bg-[var(--bg-hover)]" aria-label={t('nav.settings')} role="button" tabIndex={0} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); navigate('/settings', { state: { tab: 'bob' } }) } }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{t('nav.settings')}</span>
                {bobStatus === 'unauthenticated' && (
                  <span style={{ fontSize: 11, color: 'var(--warning, #c47b1a)' }}>{t('nav.authRequired')}</span>
                )}
              </div>
            </div>
          </div>
        ) : bobStatus === 'not_found' || bobStatus === 'error' || bobStatus === 'detecting' || bobStatus === 'incompatible' ? (
          <button
            type="button"
            style={{ width: '100%', padding: '10px 12px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '8px', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            onClick={() => navigate('/settings', { state: { tab: 'bob' } })}
          >
            {t('nav.configureBob')}
          </button>
        ) : (
          <button
            type="button"
            style={{ width: '100%', padding: '10px 12px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '8px', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            onClick={() => navigate('/onboarding')}
          >
            {t('nav.configureBob')}
          </button>
        )}
      </div>

      {searchOpen && createPortal(
        <ModalOverlay className="search-overlay" onClose={closeSearch} restoreFocusTo={searchTriggerRef}>
          <ModalPanel className="search-dialog" aria-label={t('nav.search')}>
            <input
              autoFocus
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              placeholder={t('search.chatsPlaceholder')}
            />
            <div className="search-results">
              {!searchQuery.trim() ? (
                <>
                  <div className="search-section-label">{t('search.chatsSection')}</div>
                  {searchRecentChats.length === 0 ? (
                    <p>{t('search.noResults')}</p>
                  ) : searchRecentChats.map(conversation => {
                    const projectName = projectNameById(conversation.projectId)
                    return (
                      <button
                        key={conversation.id}
                        type="button"
                        className="search-row"
                        onClick={() => { closeSearch(); navigate(`/chat/${conversation.id}`) }}
                      >
                        <span className="search-row__title">{conversation.title}</span>
                        {projectName ? <span className="search-row__meta">{projectName}</span> : null}
                      </button>
                    )
                  })}
                  <div className="search-section-label">{t('search.suggestions')}</div>
                  <button type="button" className="search-row" onClick={() => runSearchSuggestion('/')}>
                    <span className="search-row__icon" aria-hidden="true">✎</span>
                    <span className="search-row__title">{t('nav.newChat')}</span>
                  </button>
                  <button type="button" className="search-row" onClick={() => runSearchSuggestion('/schedules')}>
                    <span className="search-row__icon" aria-hidden="true">⏱</span>
                    <span className="search-row__title">{t('nav.scheduled')}</span>
                  </button>
                  <button type="button" className="search-row" onClick={() => runSearchSuggestion('/plugins')}>
                    <span className="search-row__icon" aria-hidden="true">▦</span>
                    <span className="search-row__title">{t('nav.plugins')}</span>
                  </button>
                  <button type="button" className="search-row" onClick={() => runSearchSuggestion('/settings')}>
                    <span className="search-row__icon" aria-hidden="true">⚙</span>
                    <span className="search-row__title">{t('nav.settings')}</span>
                  </button>
                </>
              ) : (
                <>
                  {searchError ? <p role="alert">{errorMessage(searchError, t('search.failed'))}</p> : null}
                  {!searchError && searchResults.length === 0 && <p>{t('search.noResults')}</p>}
                  {searchResults.map(result => (
                    <button key={`${result.entityType}-${result.entityId}-${result.snippet}`} type="button" onClick={() => openSearchResult(result)}>
                      <div><strong>{result.title}</strong><span>{searchEntityLabel(result.entityType)}</span></div>
                      <small>{result.snippet.replace(/<\/?mark>/g, '')}</small>
                    </button>
                  ))}
                </>
              )}
            </div>
          </ModalPanel>
        </ModalOverlay>,
        document.body,
      )}

      {contextMenu && createPortal(
        <div
          className="conversation-context-menu"
          role="menu"
          aria-label={t('nav.conversationActions')}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={e => e.stopPropagation()}
        >
          <button role="menuitem" className="conversation-context-menu__item" onClick={() => { setConversationPinned(contextMenu.conversationId, !conversations.find(c => c.id === contextMenu.conversationId)?.pinned); setContextMenu(null) }}>
             <PinIcon /> {t('nav.pinChat')}
          </button>
          <button role="menuitem" className="conversation-context-menu__item" onClick={() => { startEdit(contextMenu.conversationId, conversations.find(c => c.id === contextMenu.conversationId)?.title || ''); }}>
             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> {t('nav.renameChat')}
          </button>
          <button role="menuitem" className="conversation-context-menu__item" onClick={() => { setProjectPicker({ conversationId: contextMenu.conversationId }); setContextMenu(null) }}>
             <FolderTree size={14} strokeWidth={2} /> {t('nav.moveToProject')}
          </button>
          <div className="conversation-context-menu__separator" />
          <button role="menuitem" className="conversation-context-menu__item conversation-context-menu__item--danger" onClick={() => { handleArchive(contextMenu.conversationId); setContextMenu(null) }}>
             <Archive size={14} strokeWidth={2} /> {t('nav.archiveChat')}
          </button>
        </div>,
        document.body,
      )}

      {projectPicker && createPortal(
        <ModalOverlay onClose={() => setProjectPicker(null)}>
          <ModalPanel className="search-dialog bg-[var(--bg-surface)] p-4 rounded-xl shadow-xl w-[400px]" aria-labelledby="project-picker-title">
            <h3 id="project-picker-title" className="text-sm font-semibold mb-3">{t('nav.moveToProject')}</h3>
            <div className="flex flex-col gap-1 max-h-[300px] overflow-y-auto">
              <button
                className="text-left px-3 py-2 text-sm rounded hover:bg-[var(--bg-hover)]"
                onClick={async () => {
                  setConversations(conversations.map(c => c.id === projectPicker.conversationId ? { ...c, projectId: undefined } : c))
                  await updateConversation(projectPicker.conversationId, { projectId: "" }).catch(() => {})
                  setProjectPicker(null)
                }}
              >
                {t('nav.noProjectConversations')}
              </button>
              {projects.filter(p => !p.archived).map(p => (
                <button
                  key={p.id}
                  className="text-left px-3 py-2 text-sm rounded hover:bg-[var(--bg-hover)]"
                  onClick={async () => {
                    setConversations(conversations.map(c => c.id === projectPicker.conversationId ? { ...c, projectId: p.id } : c))
                    await updateConversation(projectPicker.conversationId, { projectId: p.id }).catch(() => {})
                    setProjectPicker(null)
                  }}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </ModalPanel>
        </ModalOverlay>,
        document.body,
      )}
    </div>
  )
}

function PinIcon({ filled = false }: { filled?: boolean }) {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 17v5"/><path d="m5 17 3.5-3.5V6L7 4.5V3h10v1.5L15.5 6v7.5L19 17z"/></svg>
}
