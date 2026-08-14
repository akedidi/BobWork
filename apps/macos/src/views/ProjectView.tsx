import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { open } from '@tauri-apps/plugin-dialog'
import {
  createProject, deleteProject, getBobModes, getConversations, getPlugins,
  getProject, getProjects, getSkills, updateProject,
} from '../lib/ipc'
import type { BobMode, Conversation, Plugin, Project, WorkspaceSkill } from '@bob-work/shared-types'
import { useAppStore } from '../stores/appStore'
import { useT } from '../i18n'
import { LoadErrorBanner } from '../components/LoadErrorBanner'
import { errorMessage } from '../lib/errorMessage'
import { useAppDialog } from '../components/AppDialog'

type Form = {
  name: string; description: string; objective: string; localPath: string; customInstructions: string;
  language: string; defaultMode: string; memoryEnabled: boolean; allowedFiles: string[];
  allowedPlugins: string[]; allowedIntegrations: string[];
}
const EMPTY: Form = { name: '', description: '', objective: '', localPath: '', customInstructions: '', language: 'auto', defaultMode: 'agent', memoryEnabled: true, allowedFiles: [], allowedPlugins: [], allowedIntegrations: [] }
const INTEGRATIONS = ['outlook-mail', 'teams', 'outlook-calendar', 'onedrive', 'onenote', 'github', 'slack', 'monday']

export default function ProjectView() {
  const t = useT()
  const dialog = useAppDialog()
  const { id } = useParams<{ id: string }>()
  const isNew = id === 'new'
  const navigate = useNavigate()
  const { setProjects: setSidebarProjects } = useAppStore()
  const [project, setProject] = useState<Project | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [modes, setModes] = useState<BobMode[]>([])
  const [skills, setSkills] = useState<WorkspaceSkill[]>([])
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [form, setForm] = useState<Form>(EMPTY)
  const [editing, setEditing] = useState(isNew)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')
  const [loadError, setLoadError] = useState<unknown>(null)

  useEffect(() => {
    setProject(null)
    setConversations([])
    setForm(EMPTY)
    setEditing(isNew)
    setLoading(true)
    setLoadError(null)
    const base = Promise.all([getBobModes(), getSkills(), getPlugins()])
      .then(([nextModes, nextSkills, nextPlugins]) => { setModes(nextModes); setSkills(nextSkills.filter(skill => skill.enabled)); setPlugins(nextPlugins) })
    if (isNew || !id) {
      base.catch(error => setLoadError(error)).finally(() => setLoading(false))
      return
    }
    Promise.all([getProject(id), getConversations(id), base]).then(([value, nextConversations]) => {
      if (value) { setProject(value); setForm(fromProject(value)) }
      setConversations(nextConversations)
    }).catch(error => setLoadError(error)).finally(() => setLoading(false))
  }, [id, isNew])

  const save = async () => {
    if (!form.name.trim()) return
    setSaving(true); setStatus('')
    try {
      if (isNew) {
        let created = await createProject({
          name: form.name.trim(), description: form.description, objective: form.objective,
          localPath: form.localPath || undefined, customInstructions: form.customInstructions,
          language: form.language, defaultMode: form.defaultMode,
        })
        created = await updateProject(created.id, updateInput(form))
        setProject(created)
        setForm(fromProject(created))
        setEditing(false)
        // Navigation must not wait for a non-essential sidebar refresh. With a
        // large local history that extra query made the project look unsaved
        // even though it was already committed to SQLite.
        navigate(`/project/${created.id}`, { replace: true })
        void getProjects().then(setSidebarProjects).catch(() => undefined)
      } else if (project) {
        const updated = await updateProject(project.id, updateInput(form)); setProject(updated); setEditing(false); setStatus(t('project.saved'))
      }
    } catch (error) { setStatus(errorMessage(error, t('project.saveFailed'))) } finally { setSaving(false) }
  }

  const remove = async () => {
    if (!project || !await dialog.confirm({ message: t('project.deleteConfirm', { name: project.name }), confirmLabel: t('common.delete'), destructive: true })) return
    await deleteProject(project.id); setSidebarProjects(await getProjects()); navigate('/')
  }

  const newConversation = () => {
    if (!project) return
    // Draft only — persist the conversation when the first prompt is sent.
    navigate('/chat', { state: { projectId: project.id, mode: project.defaultMode ?? 'agent' } })
  }

  if (loading) return <div className="task-empty"><span className="task-spinner" />{t('project.loading')}</div>
  if (loadError) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div className="topbar titlebar-drag" data-tauri-drag-region>
          <button className="icon-btn titlebar-no-drag" onClick={() => navigate(-1)}>‹</button>
          <strong>{t('project.title')}</strong>
        </div>
        <LoadErrorBanner error={loadError} fallback={t('project.loadFailed')} />
      </div>
    )
  }
  if (!isNew && !project) return <div className="task-empty">{t('project.notFound')}</div>

  return <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
    <div className="topbar titlebar-drag" data-tauri-drag-region>
      <button className="icon-btn titlebar-no-drag" onClick={() => navigate(-1)}>‹</button>
      <strong>{isNew ? t('project.new') : project?.name}</strong>
      {!isNew && <div className="titlebar-no-drag" style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}><button className="secondary-btn" onClick={() => setEditing(value => !value)}>{editing ? t('common.close') : t('project.configure')}</button><button className="danger-link" onClick={remove}>{t('common.delete')}</button></div>}
    </div>
    <div className="project-content">
      {(isNew || editing) ? <ProjectEditor form={form} setForm={setForm} modes={modes} skills={skills} plugins={plugins} saving={saving} onSave={save} /> : project && <>
        <header className="project-hero"><div className="project-icon" style={{ background: project.color ?? 'var(--accent)' }}>{project.name.charAt(0).toUpperCase()}</div><div><h1>{project.name}</h1><p>{project.description || t('project.noDescription')}</p></div></header>
        <div className="project-summary-grid">
          <Summary title={t('project.objective')} value={project.objective || t('project.undefined')} />
          <Summary title={t('project.localFolder')} value={project.localPath || t('project.noFolderAssociated')} />
          <Summary title={t('project.defaultMode')} value={modes.find(mode => mode.slug === project.defaultMode)?.name ?? project.defaultMode ?? 'Agent'} />
          <Summary title={t('project.context')} value={project.memoryEnabled ? t('project.memoryEnabledSummary') : t('project.memoryDisabled')} />
        </div>
        {project.customInstructions && <section className="project-section"><h2>{t('project.instructions')}</h2><p className="project-instructions">{project.customInstructions}</p></section>}
        <section className="project-section"><div className="project-section-title"><h2>{t('project.conversations', { count: conversations.length })}</h2><button className="btn-primary" onClick={newConversation}>+ {t('project.newConversation')}</button></div>
          {conversations.length === 0 ? <div className="task-empty">{t('project.noConversations')}</div> : conversations.map(conversation => <button className="project-conversation" key={conversation.id} onClick={() => navigate(`/chat/${conversation.id}`)}><span>💬</span><strong>{conversation.title}</strong><time>{new Date(conversation.date).toLocaleDateString()}</time></button>)}
        </section>
      </>}
      {status && <div className="settings-status">{status}</div>}
    </div>
  </div>
}

function ProjectEditor({ form, setForm, modes, skills, plugins, saving, onSave }: {
  form: Form; setForm: React.Dispatch<React.SetStateAction<Form>>; modes: BobMode[]; skills: WorkspaceSkill[]; plugins: Plugin[]; saving: boolean; onSave: () => void
}) {
  const t = useT()
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm(current => ({ ...current, [key]: value }))
  const chooseFolder = async (key: 'localPath' | 'allowedFiles') => {
    const path = await open({ directory: true, multiple: false, title: key === 'localPath' ? t('project.chooseWorkFolder') : t('project.allowFolder') })
    if (typeof path !== 'string') return
    if (key === 'localPath') set('localPath', path); else set('allowedFiles', Array.from(new Set([...form.allowedFiles, path])))
  }
  const toggle = (value: string, values: string[], key: 'allowedPlugins' | 'allowedIntegrations') => set(key, values.includes(value) ? values.filter(item => item !== value) : [...values, value])
  return <div className="project-editor">
    <header><h1>{form.name ? t('project.configureNamed', { name: form.name }) : t('project.create')}</h1><p>{t('project.editorDescription')}</p></header>
    <div className="project-form-grid"><label>{t('project.name')}<input autoFocus value={form.name} onChange={event => set('name', event.target.value)} /></label><label>{t('project.language')}<select value={form.language} onChange={event => set('language', event.target.value)}><option value="auto">{t('project.languageAuto')}</option><option value="fr">{t('settings.languageFr')}</option><option value="en">{t('settings.languageEn')}</option><option value="es">{t('settings.languageEs')}</option></select></label></div>
    <label>{t('project.description')}<textarea rows={2} value={form.description} onChange={event => set('description', event.target.value)} /></label>
    <label>{t('project.objective')}<textarea rows={2} value={form.objective} onChange={event => set('objective', event.target.value)} placeholder={t('project.objectivePlaceholder')} /></label>
    <label>{t('project.localFolder')}<div className="path-input"><input value={form.localPath} readOnly placeholder={t('project.noFolder')} /><button className="secondary-btn" onClick={() => chooseFolder('localPath')}>{t('project.choose')}</button></div></label>
    <label>{t('project.customInstructions')}<textarea rows={6} value={form.customInstructions} onChange={event => set('customInstructions', event.target.value)} placeholder={t('project.instructionsPlaceholder')} /></label>
    <div className="project-form-grid"><label>{t('project.defaultMode')}<select value={form.defaultMode} onChange={event => set('defaultMode', event.target.value)}>{modes.map(mode => <option key={mode.slug} value={mode.slug}>{mode.name}</option>)}</select></label><label className="project-checkbox"><input type="checkbox" checked={form.memoryEnabled} onChange={event => set('memoryEnabled', event.target.checked)} /> {t('project.keepContext')}</label></div>
    <fieldset><legend>{t('project.allowedFolders')}</legend>{form.allowedFiles.map(path => <span className="attachment-chip" key={path}>{path}<button onClick={() => set('allowedFiles', form.allowedFiles.filter(value => value !== path))}>×</button></span>)}<button className="secondary-btn" onClick={() => chooseFolder('allowedFiles')}>+ {t('project.addFolder')}</button><p>{t('project.allowedFoldersHint')}</p></fieldset>
    <fieldset><legend>{t('project.allowedCapabilities')}</legend><div className="project-choice-grid">{skills.map(skill => <label key={`skill:${skill.slug}`}><input type="checkbox" checked={form.allowedPlugins.includes(`skill:${skill.slug}`)} onChange={() => toggle(`skill:${skill.slug}`, form.allowedPlugins, 'allowedPlugins')} /> {skill.name}</label>)}{plugins.map(plugin => <label key={plugin.id}><input type="checkbox" checked={form.allowedPlugins.includes(plugin.id)} onChange={() => toggle(plugin.id, form.allowedPlugins, 'allowedPlugins')} /> {plugin.name}</label>)}</div><p>{t('project.allowedCapabilitiesHint')}</p></fieldset>
    <fieldset><legend>{t('project.allowedIntegrations')}</legend><div className="project-choice-grid">{INTEGRATIONS.map(name => <label key={name}><input type="checkbox" checked={form.allowedIntegrations.includes(name)} onChange={() => toggle(name, form.allowedIntegrations, 'allowedIntegrations')} /> {name}</label>)}</div></fieldset>
    <button className="btn-primary" disabled={!form.name.trim() || saving} onClick={onSave}>{saving ? t('project.saving') : t('project.save')}</button>
  </div>
}

function Summary({ title, value }: { title: string; value: string }) { return <div><small>{title}</small><strong>{value}</strong></div> }
function fromProject(project: Project): Form { return { name: project.name, description: project.description ?? '', objective: project.objective ?? '', localPath: project.localPath ?? '', customInstructions: project.customInstructions ?? '', language: project.language, defaultMode: project.defaultMode ?? 'agent', memoryEnabled: project.memoryEnabled, allowedFiles: project.allowedFiles, allowedPlugins: project.allowedPlugins, allowedIntegrations: project.allowedIntegrations } }
function updateInput(form: Form) { return { name: form.name.trim(), description: form.description, objective: form.objective, localPath: form.localPath || undefined, customInstructions: form.customInstructions, language: form.language, defaultMode: form.defaultMode, memoryEnabled: form.memoryEnabled, allowedFiles: form.allowedFiles, allowedPlugins: form.allowedPlugins, allowedIntegrations: form.allowedIntegrations } }
