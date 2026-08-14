// ============================================================
// Bob Work – Home View
// Dashboard: Bob status, recent conversations, quick actions
// ============================================================

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../stores/appStore'
import { getConversations, getProjects, getTasks } from '../lib/ipc'
import { LoadErrorBanner } from '../components/LoadErrorBanner'
import Composer from '../components/Composer/Composer'
import { useT } from '../i18n'

export default function HomeView() {
  const navigate = useNavigate()
  const t = useT()
  const {
    setProjects,
    setConversations,
    setTasks,
  } = useAppStore()
  const [loadError, setLoadError] = useState<unknown>(null)

  const load = () => {
    setLoadError(null)
    Promise.all([
      getConversations(),
      getProjects(),
      getTasks(),
    ]).then(([convs, projs, tks]) => {
      setConversations(convs)
      setProjects(projs)
      setTasks(tks)
    }).catch(error => {
      setLoadError(error)
    })
  }

  useEffect(() => {
    load()
  }, [])

  const SUGGESTIONS = [
    { icon: '📋', label: t('home.suggestionConsult'), mode: 'plan' },
    { icon: '💼', label: t('home.suggestionSales'), mode: 'agent' },
    { icon: '🧩', label: t('home.suggestionDelivery'), mode: 'agent' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      {/* Drag region for macOS titlebar */}
      <div className="topbar titlebar-drag" data-tauri-drag-region style={{ height: 48, width: '100%', flexShrink: 0 }} />

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 24px' }}>
        {loadError ? (
          <div style={{ width: '100%', maxWidth: 768, marginBottom: 16 }}>
            <LoadErrorBanner
              error={loadError}
              onRetry={load}
              fallback={t('common.loadFailed')}
            />
          </div>
        ) : null}

        {/* Title */}
        <h1 style={{ fontSize: 32, fontWeight: 500, margin: '0 0 32px', textAlign: 'center', color: 'var(--text-primary)' }}>
          {t('home.title')}
        </h1>

        <div style={{ width: '100%', maxWidth: 768 }}>
          {/* Main Input Box (Composer) */}
        <div style={{ width: '100%', maxWidth: 720 }}>
          <Composer 
            placeholder={t('home.placeholder')} 
            showModePill 
            showProjectPill 
          />
          
          <div style={{ textAlign: 'center', marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
            {t('home.disclaimer')}
          </div>
        </div>

        {/* Suggestions List */}
          <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 12, padding: '0 12px' }}>
            {SUGGESTIONS.map(s => (
              <div key={s.label} onClick={() => navigate('/chat', { state: { mode: s.mode, initialPrompt: s.label } })} style={{
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 16, fontSize: 14, color: 'var(--text-secondary)'
              }}>
                <span style={{ fontSize: 16, opacity: 0.7 }}>{s.icon}</span>
                {s.label}
              </div>
            ))}
          </div>
        </div>
      </div>



    </div>
  )
}
