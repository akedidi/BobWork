import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { open } from '@tauri-apps/plugin-dialog'
import {
  createConversation, createProject, deleteProject, getBobModes, getConversations, getPlugins,
  getProject, getProjects, getSkills, updateProject,
} from '../lib/ipc'
import type { BobMode, Conversation, Plugin, Project, WorkspaceSkill } from '@bob-work/shared-types'
import { useAppStore } from '../stores/appStore'

type Form = {
  name: string; description: string; objective: string; localPath: string; customInstructions: string;
  language: string; defaultMode: string; memoryEnabled: boolean; allowedFiles: string[];
  allowedPlugins: string[]; allowedIntegrations: string[];
}
const EMPTY: Form = { name: '', description: '', objective: '', localPath: '', customInstructions: '', language: 'auto', defaultMode: 'agent', memoryEnabled: true, allowedFiles: [], allowedPlugins: [], allowedIntegrations: [] }
const INTEGRATIONS = ['outlook-mail', 'teams', 'outlook-calendar', 'onedrive', 'github', 'slack', 'monday']

export default function ProjectView() {
  const { id } = useParams<{ id: string }>()
  const isNew = id === 'new'
  const navigate = useNavigate()
  const { setProjects: setSidebarProjects, setConversations: setSidebarConversations } = useAppStore()
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

  useEffect(() => {
    const base = Promise.all([getBobModes().catch(() => []), getSkills().catch(() => []), getPlugins().catch(() => [])])
      .then(([nextModes, nextSkills, nextPlugins]) => { setModes(nextModes); setSkills(nextSkills.filter(skill => skill.enabled)); setPlugins(nextPlugins) })
    if (isNew || !id) { base.finally(() => setLoading(false)); return }
    Promise.all([getProject(id), getConversations(id), base]).then(([value, nextConversations]) => {
      if (value) { setProject(value); setForm(fromProject(value)) }
      setConversations(nextConversations)
    }).catch(error => setStatus(String(error))).finally(() => setLoading(false))
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
        setSidebarProjects(await getProjects())
        navigate(`/project/${created.id}`, { replace: true })
      } else if (project) {
        const updated = await updateProject(project.id, updateInput(form)); setProject(updated); setEditing(false); setStatus('Projet enregistré.')
      }
    } catch (error) { setStatus(String(error)) } finally { setSaving(false) }
  }

  const remove = async () => {
    if (!project || !confirm(`Supprimer le projet « ${project.name} » et ses conversations locales ?`)) return
    await deleteProject(project.id); setSidebarProjects(await getProjects()); navigate('/')
  }

  const newConversation = async () => {
    if (!project) return
    const conversation = await createConversation({ projectId: project.id, title: 'Nouvelle conversation', conversationType: 'work', businessMode: project.defaultMode, bobMode: project.defaultMode })
    setSidebarConversations(await getConversations())
    navigate(`/chat/${conversation.id}`)
  }

  if (loading) return <div className="task-empty"><span className="task-spinner" />Chargement du projet…</div>
  if (!isNew && !project) return <div className="task-empty">Projet introuvable.</div>

  return <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
    <div className="topbar titlebar-drag">
      <button className="icon-btn titlebar-no-drag" onClick={() => navigate(-1)}>‹</button>
      <strong className="titlebar-no-drag">{isNew ? 'Nouveau projet' : project?.name}</strong>
      {!isNew && <div className="titlebar-no-drag" style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}><button className="secondary-btn" onClick={() => setEditing(value => !value)}>{editing ? 'Fermer' : 'Configurer'}</button><button className="danger-link" onClick={remove}>Supprimer</button></div>}
    </div>
    <div className="project-content">
      {(isNew || editing) ? <ProjectEditor form={form} setForm={setForm} modes={modes} skills={skills} plugins={plugins} saving={saving} onSave={save} /> : project && <>
        <header className="project-hero"><div className="project-icon" style={{ background: project.color ?? 'var(--accent)' }}>{project.name.charAt(0).toUpperCase()}</div><div><h1>{project.name}</h1><p>{project.description || 'Aucune description'}</p></div></header>
        <div className="project-summary-grid">
          <Summary title="Objectif" value={project.objective || 'Non défini'} />
          <Summary title="Dossier local" value={project.localPath || 'Aucun dossier associé'} />
          <Summary title="Mode par défaut" value={modes.find(mode => mode.slug === project.defaultMode)?.name ?? project.defaultMode ?? 'Agent'} />
          <Summary title="Contexte" value={project.memoryEnabled ? 'Mémoire locale activée' : 'Mémoire désactivée'} />
        </div>
        {project.customInstructions && <section className="project-section"><h2>Instructions du projet</h2><p className="project-instructions">{project.customInstructions}</p></section>}
        <section className="project-section"><div className="project-section-title"><h2>Conversations ({conversations.length})</h2><button className="btn-primary" onClick={newConversation}>+ Nouvelle conversation</button></div>
          {conversations.length === 0 ? <div className="task-empty">Aucune conversation dans ce projet.</div> : conversations.map(conversation => <button className="project-conversation" key={conversation.id} onClick={() => navigate(`/chat/${conversation.id}`)}><span>💬</span><strong>{conversation.title}</strong><time>{new Date(conversation.date).toLocaleDateString()}</time></button>)}
        </section>
      </>}
      {status && <div className="settings-status">{status}</div>}
    </div>
  </div>
}

function ProjectEditor({ form, setForm, modes, skills, plugins, saving, onSave }: {
  form: Form; setForm: React.Dispatch<React.SetStateAction<Form>>; modes: BobMode[]; skills: WorkspaceSkill[]; plugins: Plugin[]; saving: boolean; onSave: () => void
}) {
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm(current => ({ ...current, [key]: value }))
  const chooseFolder = async (key: 'localPath' | 'allowedFiles') => {
    const path = await open({ directory: true, multiple: false, title: key === 'localPath' ? 'Dossier de travail du projet' : 'Autoriser un dossier' })
    if (typeof path !== 'string') return
    if (key === 'localPath') set('localPath', path); else set('allowedFiles', Array.from(new Set([...form.allowedFiles, path])))
  }
  const toggle = (value: string, values: string[], key: 'allowedPlugins' | 'allowedIntegrations') => set(key, values.includes(value) ? values.filter(item => item !== value) : [...values, value])
  return <div className="project-editor">
    <header><h1>{form.name ? `Configurer ${form.name}` : 'Créer un projet'}</h1><p>Un projet regroupe un dossier local, des instructions, des conversations et une liste de capacités autorisées.</p></header>
    <div className="project-form-grid"><label>Nom<input autoFocus value={form.name} onChange={event => set('name', event.target.value)} /></label><label>Langue<select value={form.language} onChange={event => set('language', event.target.value)}><option value="auto">Automatique</option><option value="fr">Français</option><option value="en">English</option></select></label></div>
    <label>Description<textarea rows={2} value={form.description} onChange={event => set('description', event.target.value)} /></label>
    <label>Objectif<textarea rows={2} value={form.objective} onChange={event => set('objective', event.target.value)} placeholder="Le résultat durable attendu pour ce projet" /></label>
    <label>Dossier local<div className="path-input"><input value={form.localPath} readOnly placeholder="Aucun dossier" /><button className="secondary-btn" onClick={() => chooseFolder('localPath')}>Choisir…</button></div></label>
    <label>Instructions personnalisées<textarea rows={6} value={form.customInstructions} onChange={event => set('customInstructions', event.target.value)} placeholder="Contexte, contraintes, format des livrables…" /></label>
    <div className="project-form-grid"><label>Mode Bob par défaut<select value={form.defaultMode} onChange={event => set('defaultMode', event.target.value)}>{modes.map(mode => <option key={mode.slug} value={mode.slug}>{mode.name}</option>)}</select></label><label className="project-checkbox"><input type="checkbox" checked={form.memoryEnabled} onChange={event => set('memoryEnabled', event.target.checked)} /> Conserver le contexte local</label></div>
    <fieldset><legend>Dossiers autorisés</legend>{form.allowedFiles.map(path => <span className="attachment-chip" key={path}>{path}<button onClick={() => set('allowedFiles', form.allowedFiles.filter(value => value !== path))}>×</button></span>)}<button className="secondary-btn" onClick={() => chooseFolder('allowedFiles')}>+ Ajouter un dossier</button><p>Une liste vide autorise uniquement le dossier du projet et les pièces jointes choisies explicitement.</p></fieldset>
    <fieldset><legend>Skills et plugins autorisés</legend><div className="project-choice-grid">{skills.map(skill => <label key={`skill:${skill.slug}`}><input type="checkbox" checked={form.allowedPlugins.includes(`skill:${skill.slug}`)} onChange={() => toggle(`skill:${skill.slug}`, form.allowedPlugins, 'allowedPlugins')} /> {skill.name}</label>)}{plugins.map(plugin => <label key={plugin.id}><input type="checkbox" checked={form.allowedPlugins.includes(plugin.id)} onChange={() => toggle(plugin.id, form.allowedPlugins, 'allowedPlugins')} /> {plugin.name}</label>)}</div><p>Une liste vide laisse tous les skills/plugins locaux disponibles.</p></fieldset>
    <fieldset><legend>Intégrations autorisées</legend><div className="project-choice-grid">{INTEGRATIONS.map(name => <label key={name}><input type="checkbox" checked={form.allowedIntegrations.includes(name)} onChange={() => toggle(name, form.allowedIntegrations, 'allowedIntegrations')} /> {name}</label>)}</div></fieldset>
    <button className="btn-primary" disabled={!form.name.trim() || saving} onClick={onSave}>{saving ? 'Enregistrement…' : 'Enregistrer le projet'}</button>
  </div>
}

function Summary({ title, value }: { title: string; value: string }) { return <div><small>{title}</small><strong>{value}</strong></div> }
function fromProject(project: Project): Form { return { name: project.name, description: project.description ?? '', objective: project.objective ?? '', localPath: project.localPath ?? '', customInstructions: project.customInstructions ?? '', language: project.language, defaultMode: project.defaultMode ?? 'agent', memoryEnabled: project.memoryEnabled, allowedFiles: project.allowedFiles, allowedPlugins: project.allowedPlugins, allowedIntegrations: project.allowedIntegrations } }
function updateInput(form: Form) { return { name: form.name.trim(), description: form.description, objective: form.objective, localPath: form.localPath || undefined, customInstructions: form.customInstructions, language: form.language, defaultMode: form.defaultMode, memoryEnabled: form.memoryEnabled, allowedFiles: form.allowedFiles, allowedPlugins: form.allowedPlugins, allowedIntegrations: form.allowedIntegrations } }
