import { useEffect, useMemo, useState } from 'react'
import type { PersistentMemory, Project } from '@bob-work/shared-types'
import { createMemory, forgetMemory, getMemories, getProjects } from '../../lib/ipc'
import { errorMessage } from '../../lib/errorMessage'
import { Card, Heading, SettingsFields, ToggleRow } from './SettingsShared'

export default function MemorySettingsTab(props: any) {
  const { t, settings, settingsError, change, setStatus } = props
  const [items, setItems] = useState<PersistentMemory[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [scope, setScope] = useState<'user' | 'project'>('user')
  const [projectId, setProjectId] = useState('')
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = () => Promise.all([getMemories(), getProjects()]).then(([memories, availableProjects]) => {
    setItems(memories)
    setProjects(availableProjects)
    setProjectId(current => current || availableProjects[0]?.id || '')
  })

  useEffect(() => { void refresh().catch(error => setStatus(errorMessage(error))) }, [])

  const projectNames = useMemo(() => new Map(projects.map(project => [project.id, project.name])), [projects])
  const groups = useMemo(() => {
    const grouped = new Map<string, PersistentMemory[]>()
    for (const item of items) {
      const key = item.scope === 'user' ? 'user' : item.projectId || 'unknown'
      grouped.set(key, [...(grouped.get(key) || []), item])
    }
    return grouped
  }, [items])

  const add = async () => {
    if (!content.trim() || (scope === 'project' && !projectId)) return
    setBusy(true)
    try {
      await createMemory({ scope, projectId: scope === 'project' ? projectId : undefined, content: content.trim() })
      setContent('')
      await refresh()
      setStatus(t('settings.memorySaved'))
    } catch (error) { setStatus(errorMessage(error)) } finally { setBusy(false) }
  }

  const forget = async (id: string) => {
    setBusy(true)
    try {
      await forgetMemory(id)
      setItems(current => current.filter(item => item.id !== id))
      setStatus(t('settings.memoryForgotten'))
    } catch (error) { setStatus(errorMessage(error)) } finally { setBusy(false) }
  }

  return <>
    <Heading title={t('settings.memoryHeading')} description={t('settings.memoryDesc')} />
    <Card>
      <SettingsFields settings={settings} error={settingsError} loadingLabel={t('common.loading')}>
        {s => <>
          <ToggleRow title={t('settings.memoryEnable')} description={t('settings.memoryEnableDesc')} value={s.persistentMemoryEnabled} onChange={value => change('persistentMemoryEnabled', value)} />
          <div className="settings-row"><div><strong>{t('settings.memoryEngine')}</strong><small>{t('settings.memoryEngineDesc')}</small></div><span className="status-ok">{t('settings.memoryEngineLocal')}</span></div>
          <p className="settings-note">{t('settings.memoryPrivacy')}</p>
        </>}
      </SettingsFields>
    </Card>
    <Card title={t('settings.memoryAdd')}>
      <div className="memory-editor">
        <textarea className="settings-textarea" rows={4} maxLength={4000} value={content} onChange={event => setContent(event.target.value)} placeholder={t('settings.memoryPlaceholder')} />
        <div className="memory-editor-actions">
          <select value={scope} onChange={event => setScope(event.target.value as 'user' | 'project')} aria-label={t('settings.memoryScope')}>
            <option value="user">{t('settings.memoryScopeUser')}</option><option value="project">{t('settings.memoryScopeProject')}</option>
          </select>
          {scope === 'project' && <select value={projectId} onChange={event => setProjectId(event.target.value)} aria-label={t('settings.memoryProject')}>
            {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>}
          <button className="primary" disabled={busy || !content.trim() || (scope === 'project' && !projectId)} onClick={add}>{t('settings.memoryRemember')}</button>
        </div>
      </div>
    </Card>
    <Card title={t('settings.memoryList')}>
      {items.length === 0 && <p className="settings-note">{t('settings.memoryEmpty')}</p>}
      {[...groups.entries()].map(([key, memories]) => <section className="memory-group" key={key}>
        <h3>{key === 'user' ? t('settings.memoryScopeUser') : projectNames.get(key) || t('settings.memoryUnknownProject')}</h3>
        {memories.map(memory => <div className="memory-item" key={memory.id}><span>{memory.content}</span><button disabled={busy} onClick={() => forget(memory.id)}>{t('settings.memoryForget')}</button></div>)}
      </section>)}
    </Card>
  </>
}
