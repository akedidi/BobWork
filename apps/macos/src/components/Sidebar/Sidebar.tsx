// ============================================================
// Bob Work – Sidebar
// Navigation principale + données réelles via IPC
// ============================================================

import { useEffect, useState, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Archive, FolderTree } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import { getProjects, getConversations, getTasks, detectBob, searchWorkspace, updateConversation, updateTaskPinned, getUsageStatus } from '../../lib/ipc'
import { listen } from '@tauri-apps/api/event'
import type { SearchResult, UsageStatus } from '@bob-work/shared-types'
import { UsageMeter } from '../UsageMeter/UsageMeter'

export default function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const {
    projects, setProjects,
    conversations, setConversations,
    tasks, setTasks,
    bobStatus, setBobStatus, setBobInfo,
  } = useAppStore()

  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, conversationId: string } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [projectPicker, setProjectPicker] = useState<{ conversationId: string } | null>(null)
  const [usage, setUsage] = useState<UsageStatus | null>(null)

  const refreshUsage = () => {
    getUsageStatus().then(setUsage).catch(() => setUsage(null))
  }

  useEffect(() => {
    refreshUsage()
  }, [])

  useEffect(() => {
    if (bobStatus !== 'ready') return
    let disposed = false
    let unlisten: (() => void) | null = null
    listen<string>('task-updated', () => {
      if (!disposed) refreshUsage()
    }).then(fn => {
      if (disposed) fn(); else unlisten = fn
    })
    return () => { disposed = true; unlisten?.() }
  }, [bobStatus])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | null = null
    listen<string>('conversation-updated', () => {
      getConversations()
        .then(next => { if (!disposed) setConversations(next) })
        .catch(() => {})
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
        .then(next => { if (!disposed) setTasks(next) })
        .catch(() => {})
    }).then(fn => {
      if (disposed) fn(); else unlisten = fn
    })
    return () => { disposed = true; unlisten?.() }
  }, [setTasks])

  // ── Load projects + conversations + detect Bob on mount ───────
  useEffect(() => {
    // Detect Bob without installing or mutating the user's machine.
    detectBob()
      .then((result) => {
        setBobInfo(result)
        setBobStatus(!result.found ? 'not_found' : !result.authenticated ? 'unauthenticated' : 'ready')
      })
      .catch(() => setBobStatus('error'))

    // Load projects
    getProjects()
      .then(ps => {
        setProjects(ps)
        // Auto-expand first project
        if (ps.length > 0) setExpandedProjects(new Set([ps[0].id]))
      })
      .catch(() => {})

    // Load recent conversations (no project)
    getConversations()
      .then(setConversations)
      .catch(() => {})

    getTasks()
      .then(setTasks)
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return }
    const timer = window.setTimeout(() => searchWorkspace(searchQuery, 40).then(setSearchResults).catch(() => setSearchResults([])), 180)
    return () => window.clearTimeout(timer)
  }, [searchQuery])

  const openSearchResult = (result: SearchResult) => {
    setSearchOpen(false); setSearchQuery('')
    if (result.entityType === 'project') navigate(`/project/${result.entityId}`)
    else if (result.entityType === 'task') navigate('/tasks')
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
    .filter(conversation => !conversation.pinned && !conversation.projectId)
    .slice(0, 12)

  const pinnedConversations = conversations.filter(conversation => conversation.pinned)
  const pinnedTasks = tasks.filter(task => task.pinned)

  const setConversationPinned = async (conversationId: string, pinned: boolean) => {
    setConversations(conversations.map(conversation => conversation.id === conversationId ? { ...conversation, pinned } : conversation))
    try {
      await updateConversation(conversationId, { pinned })
    } catch {
      getConversations().then(setConversations).catch(() => {})
    }
  }

  const setTaskPinned = async (taskId: string, pinned: boolean) => {
    setTasks(tasks.map(task => task.id === taskId ? { ...task, pinned } : task))
    try {
      await updateTaskPinned(taskId, pinned)
    } catch {
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
    } catch {
      getConversations().then(setConversations).catch(() => {})
    }
  }

  const submitEdit = async (id: string) => {
    if (editingId && editTitle.trim()) {
      setConversations(conversations.map(c => c.id === id ? { ...c, title: editTitle.trim() } : c))
      await updateConversation(id, { title: editTitle.trim() }).catch(() => {})
    }
    setEditingId(null)
  }

  const startEdit = (id: string, currentTitle: string) => {
    setEditTitle(currentTitle)
    setEditingId(id)
    setContextMenu(null)
  }

  useEffect(() => {
    const onClick = () => setContextMenu(null)
    window.addEventListener('click', onClick)
    return () => window.removeEventListener('click', onClick)
  }, [])

  return (
    <div className="sidebar" style={{ backdropFilter: 'blur(30px)' }}>
      {/* Header — traffic lights + app name */}
      <div className="sidebar-header titlebar-drag" style={{ padding: '40px 16px 16px 24px', display: 'flex', alignItems: 'center' }}>
        <span className="titlebar-no-drag" style={{ fontWeight: 600, fontSize: 16, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          Bob Work
        </span>
        <div style={{ flex: 1 }} />
        {/* Search */}
        <button className="icon-btn titlebar-no-drag" title="Rechercher" onClick={() => setSearchOpen(true)} style={{ padding: '6px', borderRadius: '50%', color: 'var(--text-secondary)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
        </button>
        {/* Notification */}
        <button className="icon-btn titlebar-no-drag" title="Notifications" style={{ padding: '6px', borderRadius: '50%', color: 'var(--text-secondary)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
          </svg>
        </button>
      </div>

      <div className="sidebar-nav">
        <div className="sidebar-item" onClick={() => navigate('/')} style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" opacity={0.6}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Nouveau chat
        </div>
        <div className="sidebar-item" onClick={() => navigate('/schedules')} style={{ color: 'var(--text-secondary)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" opacity={0.6}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          Planifié
        </div>
        <div className="sidebar-item" onClick={() => navigate('/tasks')} style={{ color: 'var(--text-secondary)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" opacity={0.6}><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          Tâches
        </div>
        <div className="sidebar-item" onClick={() => navigate('/plugins')} style={{ color: 'var(--text-secondary)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" opacity={0.6}>
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
          </svg>
          Plugins
        </div>
        <div className="sidebar-item" onClick={() => navigate('/extensions')} style={{ color: 'var(--text-secondary)' }}>
          <span style={{ width: 16, textAlign: 'center' }}>✦</span> Skills
        </div>
        <div className="sidebar-item" onClick={() => navigate('/integrations')} style={{ color: 'var(--text-secondary)' }}>
          <span style={{ width: 16, textAlign: 'center' }}>↗</span> Intégrations et MCP
        </div>
      </div>

      <div className="sidebar-content">
        
        {/* Pinned */}
        <div className="sidebar-section-label" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'none', paddingLeft: 8 }}>Épinglés</div>
        {pinnedConversations.length === 0 && pinnedTasks.length === 0 ? <div style={{ padding: '7px 10px 16px', color: 'var(--text-muted)', fontSize: 11.5 }}>Aucun élément épinglé</div> : <>
          {pinnedConversations.map(conversation => <div key={conversation.id} className="sidebar-item" onClick={() => navigate(`/chat/${conversation.id}`)} title={conversation.title}>
            <span aria-hidden="true" style={{ opacity: .55 }}>◇</span>
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
                        onClick={() => { if (editingId !== c.id) navigate(`/chat/${c.id}`) }}
                        onDoubleClick={() => startEdit(c.id, c.title)}
                        onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, conversationId: c.id }); }}
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
                          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
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
              className={`sidebar-item ${isActive(`/chat/${conversation.id}`) ? 'active' : ''}`}
              onClick={() => { if (editingId !== conversation.id) navigate(`/chat/${conversation.id}`) }}
              onDoubleClick={() => startEdit(conversation.id, conversation.title)}
              onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, conversationId: conversation.id }); }}
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
                 <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{conversation.title}</span>
              )}
              <div style={{ display: 'flex', gap: 4 }} className="sidebar-inline-action">
                 <button onClick={event => { event.stopPropagation(); setConversationPinned(conversation.id, true) }} title="Épingler la conversation" aria-label={`Épingler ${conversation.title}`}><PinIcon /></button>
                 <button onClick={event => { event.stopPropagation(); handleArchive(conversation.id) }} title="Archiver la conversation" aria-label={`Archiver ${conversation.title}`}><Archive size={13} strokeWidth={1.8} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>


      {/* Footer / User Profile */}
      <div className="sidebar-footer" style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0, marginBottom: 8 }}>
        {bobStatus === 'ready' ? (
          <>
            <UsageMeter
              usage={usage}
              compact
              onClick={() => navigate('/settings', { state: { tab: 'bob' } })}
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '4px 8px', borderRadius: 6 }} onClick={() => navigate('/settings')} className="hover:bg-[var(--bg-hover)]" aria-label="Réglages" role="button" tabIndex={0} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); navigate('/settings') } }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Réglages</span>
                </div>
              </div>
            </div>
          </>
        ) : (
          <button 
            style={{ width: '100%', padding: '10px 12px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '8px', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            onClick={() => navigate('/onboarding')}
          >
            Configurer Bob
          </button>
        )}
      </div>
      {searchOpen && <div className="search-overlay" onMouseDown={() => setSearchOpen(false)}>
        <div className="search-dialog" onMouseDown={event => event.stopPropagation()}>
          <input autoFocus value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Rechercher dans les conversations, projets et tâches…" />
          <div className="search-results">
            {!searchQuery.trim() && <p>Saisissez un mot ou une expression.</p>}
            {searchQuery.trim() && searchResults.length === 0 && <p>Aucun résultat.</p>}
            {searchResults.map(result => <button key={`${result.entityType}-${result.entityId}-${result.snippet}`} onClick={() => openSearchResult(result)}>
              <div><strong>{result.title}</strong><span>{result.entityType}</span></div>
              <small>{result.snippet.replace(/<\/?mark>/g, '')}</small>
            </button>)}
          </div>
        </div>
      </div>}
      
      {contextMenu && (
        <div 
          style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 100000, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', padding: 4, minWidth: 200 }}
          onMouseDown={e => e.stopPropagation()}
        >
          <button className="w-full text-left px-3 py-1.5 text-[13px] rounded hover:bg-[var(--bg-hover)] flex items-center gap-2" onClick={() => { setConversationPinned(contextMenu.conversationId, !conversations.find(c => c.id === contextMenu.conversationId)?.pinned); setContextMenu(null) }}>
             <PinIcon /> Épingler le chat
          </button>
          <button className="w-full text-left px-3 py-1.5 text-[13px] rounded hover:bg-[var(--bg-hover)] flex items-center gap-2" onClick={() => { startEdit(contextMenu.conversationId, conversations.find(c => c.id === contextMenu.conversationId)?.title || ''); }}>
             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> Renommer le chat
          </button>
          <button className="w-full text-left px-3 py-1.5 text-[13px] rounded hover:bg-[var(--bg-hover)] flex items-center gap-2" onClick={() => { setProjectPicker({ conversationId: contextMenu.conversationId }); setContextMenu(null) }}>
             <FolderTree size={14} strokeWidth={2} /> Déplacer vers un projet
          </button>
          <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
          <button className="w-full text-left px-3 py-1.5 text-[13px] rounded hover:bg-[var(--bg-hover)] text-[var(--danger)] flex items-center gap-2" onClick={() => { handleArchive(contextMenu.conversationId); setContextMenu(null) }}>
             <Archive size={14} strokeWidth={2} /> Archiver le chat
          </button>
        </div>
      )}

      {projectPicker && (
        <div className="search-overlay flex items-center justify-center" onMouseDown={() => setProjectPicker(null)}>
          <div className="search-dialog bg-[var(--bg-surface)] p-4 rounded-xl shadow-xl w-[400px]" onMouseDown={event => event.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-3">Déplacer vers un projet</h3>
            <div className="flex flex-col gap-1 max-h-[300px] overflow-y-auto">
              <button 
                className="text-left px-3 py-2 text-sm rounded hover:bg-[var(--bg-hover)]"
                onClick={async () => {
                  setConversations(conversations.map(c => c.id === projectPicker.conversationId ? { ...c, projectId: undefined } : c))
                  await updateConversation(projectPicker.conversationId, { projectId: "" }).catch(() => {})
                  setProjectPicker(null)
                }}
              >
                Aucun projet (Conversations)
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
          </div>
        </div>
      )}
    </div>
  )
}

function PinIcon({ filled = false }: { filled?: boolean }) {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 17v5"/><path d="m5 17 3.5-3.5V6L7 4.5V3h10v1.5L15.5 6v7.5L19 17z"/></svg>
}
