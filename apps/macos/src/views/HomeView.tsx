// ============================================================
// Bob Work – Home View
// Dashboard: Bob status, recent conversations, quick actions
// ============================================================

import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../stores/appStore'
import { getConversations, getProjects, getTasks } from '../lib/ipc'
import type { Conversation, Project, Task } from '@bob-work/shared-types'
import Composer from '../components/Composer/Composer'

export default function HomeView() {
  const navigate = useNavigate()
  const {
    setProjects,
    setConversations,
    setTasks,
  } = useAppStore()

  useEffect(() => {
    // Load data
    Promise.all([
      getConversations().catch(() => [] as Conversation[]),
      getProjects().catch(() => [] as Project[]),
      getTasks().catch(() => [] as Task[]),
    ]).then(([convs, projs, tks]) => {
      setConversations(convs)
      setProjects(projs)
      setTasks(tks)
    })
  }, [])

  const SUGGESTIONS = [
    { icon: '💡', label: 'Créer un fichier ou un site', mode: 'document' },
    { icon: '📖', label: 'Faire des recherches et planifier les prochaines étapes', mode: 'planning' },
    { icon: '🕒', label: 'Automatiser les tâches routinières et récurrentes', mode: 'automation' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      {/* Drag region for macOS titlebar */}
      <div className="topbar titlebar-drag" style={{ height: 48, width: '100%', flexShrink: 0 }} />

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 24px' }}>
        
        {/* Title */}
        <h1 style={{ fontSize: 32, fontWeight: 500, margin: '0 0 32px', textAlign: 'center', color: 'var(--text-primary)' }}>
          Sur quoi travailler ?
        </h1>

        <div style={{ width: '100%', maxWidth: 768 }}>
          {/* Main Input Box (Composer) */}
        <div style={{ width: '100%', maxWidth: 720 }}>
          <Composer 
            placeholder="Sur quoi travailler ?" 
            showModePill 
            showProjectPill 
          />
          
          <div style={{ textAlign: 'center', marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
            L'IA peut faire des erreurs. Vérifiez toujours le code.
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
