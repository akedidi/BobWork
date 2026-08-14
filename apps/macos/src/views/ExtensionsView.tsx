import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  deleteSkill, getSkills, saveSkill, setSkillEnabled,
} from '../lib/ipc'
import { PluginIcon, resolveIconFromText } from '../components/PluginIcon'
import { LoadErrorBanner } from '../components/LoadErrorBanner'
import { errorMessage } from '../lib/errorMessage'
import { isBuiltinSkill, sortSkillsForDisplay } from '../lib/builtinCatalog'
import type { WorkspaceSkill } from '@bob-work/shared-types'
import { useT } from '../i18n'
import { useAppStore } from '../stores/appStore'
import { useAppDialog } from '../components/AppDialog'

type SkillPanel = 'closed' | 'detail' | 'editor'

const skillKey = (skill: WorkspaceSkill) => `${skill.scope}:${skill.slug}`
const scopeLabel = (scope: string) => ({
  'global-bob': 'Bob · Personnel',
  'global-agents': 'Agents · Personnel',
  'global-claude': 'Claude · Personnel',
  'workspace-bob': 'Bob · Projet',
  'workspace-agents': 'Agents · Projet',
  'workspace-claude': 'Claude · Projet',
}[scope] ?? scope)

/** Personal Bob skills can be deleted from the list; built-ins cannot. */
const canDeleteSkill = (skill: WorkspaceSkill) =>
  !isBuiltinSkill(skill) && (skill.scope === 'global-bob' || skill.scope === 'workspace-bob')

function workspaceRootForSkill(skill: WorkspaceSkill): string | undefined {
  if (skill.scope !== 'workspace-bob') return undefined
  const marker = '/.bob/skills/'
  const index = skill.sourcePath.indexOf(marker)
  if (index <= 0) return undefined
  return skill.sourcePath.slice(0, index)
}

const CREATE_SKILL_PROMPT =
  'Crée avec moi un skill personnel Bob Work (pas un plugin agentique).\n\n'
  + 'Format cible : `~/.bob/skills/<slug>/SKILL.md` avec frontmatter YAML '
  + '(`name`, `description` fonctionnelle en 1–2 phrases, `user-invocable: true`) puis le corps d’instructions.\n\n'
  + 'La description doit dire ce que le skill fait pour l’utilisateur (bénéfice), pas la stack technique.\n\n'
  + 'Demande-moi l’objectif, le moment d’utilisation et les consignes. Après validation, écris le fichier localement '
  + 'et dis-moi de rafraîchir la page Skills pour le voir.'

const IMPORT_CLAUDE_SKILL_PROMPT =
  'Aide-moi à rapatrier un skill Claude open-source dans Bob Work.\n\n'
  + '1) Demande-moi le nom du skill, une URL GitHub (repo ou fichier `SKILL.md` raw), ou propose des catalogues connus '
  + '(ex. skills Anthropic / listes awesome-claude-skills) sans inventer de contenu.\n'
  + '2) Avec mon accord, récupère le `SKILL.md` (clone sparse, curl raw GitHub, ou lecture locale si déjà présent).\n'
  + '3) Adapte-le au format Bob : dossier `~/.bob/skills/<slug>/SKILL.md`, frontmatter `name` / `description` / `user-invocable: true`, '
  + 'description fonctionnelle, conserve la licence et une note d’attribution à la source.\n'
  + '4) N’écrase pas un skill existant sans me demander. Vérifie le fichier écrit et dis-moi de rafraîchir Skills.\n\n'
  + 'Reste local : pas d’exécution opaque du skill distant, seulement copie/adaptation du markdown.'

export default function ExtensionsView() {
  const t = useT()
  const dialog = useAppDialog()
  const navigate = useNavigate()
  const [skills, setSkills] = useState<WorkspaceSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [skillForm, setSkillForm] = useState({ slug: '', description: '', content: '' })
  const [editingSkill, setEditingSkill] = useState<string | null>(null)
  const [selectedSkillKey, setSelectedSkillKey] = useState<string | null>(null)
  const [skillPanel, setSkillPanel] = useState<SkillPanel>('closed')
  const [skillSearch, setSkillSearch] = useState('')
  const [togglingSkill, setTogglingSkill] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const statusTimerRef = useRef<number | null>(null)

  const load = async () => {
    setLoadError(null)
    try {
      const nextSkills = await getSkills()
      setSkills(nextSkills)
      return nextSkills
    } catch (error) {
      setLoadError(error)
      return []
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [])

  useEffect(() => {
    if (!status) return
    if (statusTimerRef.current) window.clearTimeout(statusTimerRef.current)
    statusTimerRef.current = window.setTimeout(() => setStatus(''), 3500)
    return () => {
      if (statusTimerRef.current) window.clearTimeout(statusTimerRef.current)
    }
  }, [status])

  const selectedSkill = skills.find(skill => skillKey(skill) === selectedSkillKey) ?? null
  const visibleSkills = useMemo(() => {
    const query = skillSearch.trim().toLocaleLowerCase()
    const filtered = query
      ? skills.filter(skill => `${skill.name} ${skill.description} ${skill.slug}`.toLocaleLowerCase().includes(query))
      : skills
    return sortSkillsForDisplay(filtered)
  }, [skillSearch, skills])

  const startSkillChat = (initialPrompt?: string) => {
    setSkillPanel('closed')
    useAppStore.getState().setBuilderSession({
      kind: 'skill_builder',
      brief: initialPrompt || CREATE_SKILL_PROMPT,
      guided: false,
    })
    navigate('/chat', { state: { mode: 'skill_builder', ...(initialPrompt ? { initialPrompt } : {}) } })
  }

  const openCreateSkill = () => {
    setEditingSkill(null)
    setSelectedSkillKey(null)
    setSkillForm({ slug: '', description: '', content: '' })
    setSkillPanel('editor')
  }

  const editSkill = (skill: WorkspaceSkill) => {
    setEditingSkill(skill.slug)
    setSelectedSkillKey(skillKey(skill))
    setSkillForm({ slug: skill.slug, description: skill.description, content: skill.content })
    setSkillPanel('editor')
  }

  const closeSkillPanel = () => {
    setSkillPanel('closed')
    setEditingSkill(null)
    setSkillForm({ slug: '', description: '', content: '' })
  }

  const persistSkill = async () => {
    setStatus('')
    try {
      const saved = await saveSkill({ ...skillForm })
      await load()
      setSelectedSkillKey(skillKey(saved))
      setSkillForm({ slug: '', description: '', content: '' })
      setEditingSkill(null)
      setSkillPanel('detail')
      setStatus('Skill enregistré. Il est disponible dans le prompt avec @skill:nom.')
    } catch (error) { setStatus(errorMessage(error)) }
  }

  const toggleSkill = async (skill: WorkspaceSkill, enabled: boolean) => {
    const key = skillKey(skill)
    setTogglingSkill(key)
    setStatus('')
    setSkills(current => current.map(item => skillKey(item) === key ? { ...item, enabled } : item))
    try {
      await setSkillEnabled(skill.slug, skill.scope, enabled)
      setStatus(`${skill.name} est maintenant ${enabled ? 'activé' : 'désactivé'}.`)
    } catch (error) {
      setSkills(current => current.map(item => skillKey(item) === key ? { ...item, enabled: !enabled } : item))
      setStatus(errorMessage(error))
    } finally {
      setTogglingSkill(null)
    }
  }

  const removeSkill = async (skill: WorkspaceSkill) => {
    if (!await dialog.confirm({ message: t('skills.deleteConfirm', { name: skill.name }), confirmLabel: t('common.delete'), destructive: true })) return
    setStatus('')
    try {
      await deleteSkill(skill.slug, workspaceRootForSkill(skill))
      if (selectedSkillKey === skillKey(skill)) {
        setSelectedSkillKey(null)
        closeSkillPanel()
      }
      await load()
      setStatus(`${skill.name} a été supprimé.`)
    } catch (error) {
      setStatus(errorMessage(error))
    }
  }

  return <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
    <div className="topbar titlebar-drag" data-tauri-drag-region><strong>{t('skills.title')}</strong></div>
    <LoadErrorBanner error={loadError} onRetry={() => { setLoading(true); void load() }} fallback={t('skills.loadFailed')} />
    <div className="extensions-content">
      <div className={`skills-workspace ${skillPanel !== 'closed' ? 'has-panel' : ''}`}>
        <section className="skills-browser">
          <div className="skills-toolbar">
            <div><h2>{t('skills.title')}</h2><small>{skills.filter(skill => skill.enabled).length} activés sur {skills.length}</small></div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="secondary-btn" onClick={() => startSkillChat(IMPORT_CLAUDE_SKILL_PROMPT)}>Importer Claude</button>
              <button type="button" className="secondary-btn" onClick={openCreateSkill}>Formulaire</button>
              <button className="btn-primary" onClick={() => startSkillChat()}>+ Nouveau skill</button>
            </div>
          </div>
          <div className="skill-search-wrap">
            <span aria-hidden="true">⌕</span>
            <input value={skillSearch} onChange={event => setSkillSearch(event.target.value)} placeholder="Rechercher un skill" aria-label="Rechercher un skill" />
          </div>
          <p className="skills-help">
            « + Nouveau skill » ouvre le chat : décrivez l’idée, Bob écrit le `SKILL.md`. Le formulaire et l’import Claude restent optionnels.
            Le badge <strong>Intégré</strong> marque les skills natifs — ils ne peuvent pas être supprimés.
          </p>
          <div className="skills-list">
            {loadError ? null : loading ? <div className="task-empty">Chargement…</div> : visibleSkills.length === 0 ? <div className="task-empty">{skills.length === 0 ? t('skills.empty') : t('skills.noneFound')}</div> : visibleSkills.map(skill => {
              const key = skillKey(skill)
              const deletable = canDeleteSkill(skill)
              return <div className={`skill-list-row ${selectedSkillKey === key ? 'selected' : ''} ${skill.enabled ? '' : 'disabled'}`} key={key}>
                <button className="skill-row-main" onClick={() => { setSelectedSkillKey(key); setSkillPanel('detail') }}>
                  <PluginIcon icon={resolveIconFromText(skill.slug, skill.name, skill.description)} size="md" className="skill-row-icon" />
                  <span className="skill-row-copy"><strong>{skill.name}</strong><small>{skill.description || 'Aucune description'}</small></span>
                  <span className="skill-row-badges">
                    {isBuiltinSkill(skill) ? <span className="skill-builtin-badge">Intégré</span> : null}
                    <span className="skill-scope-badge">{scopeLabel(skill.scope)}</span>
                  </span>
                </button>
                {deletable && (
                  <button
                    type="button"
                    className="skill-row-delete-btn"
                    title={`Supprimer ${skill.name}`}
                    aria-label={`Supprimer le skill ${skill.name}`}
                    onClick={event => {
                      event.stopPropagation()
                      void removeSkill(skill)
                    }}
                  >
                    Supprimer
                  </button>
                )}
                <label className="skill-switch" title={skill.enabled ? 'Désactiver' : 'Activer'}>
                  <input type="checkbox" checked={skill.enabled} disabled={togglingSkill === key} aria-label={`${skill.enabled ? 'Désactiver' : 'Activer'} le skill ${skill.name}`} onChange={event => void toggleSkill(skill, event.target.checked)} />
                  <span aria-hidden="true" />
                </label>
              </div>
            })}
          </div>
        </section>

        {skillPanel === 'detail' && selectedSkill && <aside className="skill-detail-panel" aria-label={`Détails du skill ${selectedSkill.name}`}>
          <div className="skill-panel-heading">
            <div className="skill-detail-title"><PluginIcon icon={resolveIconFromText(selectedSkill.slug, selectedSkill.name, selectedSkill.description)} size="lg" className="skill-row-icon" /><div><h2>{selectedSkill.name}{isBuiltinSkill(selectedSkill) ? <span className="skill-builtin-badge">Intégré</span> : null}</h2><small>{selectedSkill.slug}</small></div></div>
            <button className="icon-btn" aria-label="Fermer les détails" onClick={closeSkillPanel}>×</button>
          </div>
          <div className="skill-detail-status">
            <div><strong>{selectedSkill.enabled ? 'Activé' : 'Désactivé'}</strong><small>{selectedSkill.enabled ? 'Bob peut utiliser ce skill.' : 'Bob n’utilisera pas ce skill.'}</small></div>
            <label className="skill-switch">
              <input type="checkbox" checked={selectedSkill.enabled} disabled={togglingSkill === skillKey(selectedSkill)} aria-label={`${selectedSkill.enabled ? 'Désactiver' : 'Activer'} le skill ${selectedSkill.name}`} onChange={event => void toggleSkill(selectedSkill, event.target.checked)} />
              <span aria-hidden="true" />
            </label>
          </div>
          <section className="skill-detail-section"><h3>Description</h3><p>{selectedSkill.description || 'Aucune description.'}</p></section>
          <section className="skill-detail-section"><h3>Source</h3><dl><div><dt>Type</dt><dd>{isBuiltinSkill(selectedSkill) ? 'Skill intégré Bob Work (natif, ex. Computer Use / Office)' : 'Skill personnel ou externe'}</dd></div><div><dt>Portée</dt><dd>{scopeLabel(selectedSkill.scope)}</dd></div><div><dt>Fichier</dt><dd title={selectedSkill.sourcePath}>{selectedSkill.sourcePath}</dd></div></dl></section>
          <section className="skill-detail-section skill-instructions"><h3>Instructions</h3><pre>{selectedSkill.content || 'Aucune instruction.'}</pre></section>
          {canDeleteSkill(selectedSkill) && <div className="skill-panel-actions"><button className="secondary-btn" onClick={() => editSkill(selectedSkill)}>Modifier</button><button className="danger-link" onClick={() => void removeSkill(selectedSkill)}>Supprimer</button></div>}
        </aside>}

        {skillPanel === 'editor' && <aside className="skill-detail-panel skill-editor-panel" aria-label={editingSkill ? 'Modifier le skill' : 'Créer un skill'}>
          <div className="skill-panel-heading"><div><h2>{editingSkill ? 'Modifier le skill' : 'Skill — formulaire'}</h2><small>{editingSkill ? 'Mettez à jour ses instructions.' : 'Création manuelle. Pour un skill rédigé ou importé par Bob, utilisez « + Nouveau skill ».'}</small></div><button className="icon-btn" aria-label="Fermer l’éditeur" onClick={closeSkillPanel}>×</button></div>
          <label>Identifiant<input value={skillForm.slug} disabled={!!editingSkill} onChange={event => setSkillForm(value => ({ ...value, slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }))} placeholder="analyse-contrats" /></label>
          <label>
            Description
            <small style={{ display: 'block', marginTop: 3, color: 'var(--text-muted)', fontWeight: 400 }}>
              En 1–2 phrases : ce que le skill fait pour l’utilisateur.
            </small>
            <input value={skillForm.description} onChange={event => setSkillForm(value => ({ ...value, description: event.target.value }))} placeholder="Ex. : Relit un contrat et liste les clauses à risque" />
          </label>
          <label>Instructions<textarea rows={14} value={skillForm.content} onChange={event => setSkillForm(value => ({ ...value, content: event.target.value }))} placeholder="Décris étape par étape ce que Bob doit faire…" /></label>
          <div className="skill-panel-actions"><button className="btn-primary" disabled={!skillForm.slug || !skillForm.description || !skillForm.content} onClick={() => void persistSkill()}>Enregistrer</button><button className="secondary-btn" onClick={closeSkillPanel}>Retour</button></div>
        </aside>}
      </div>
      {status && <div className="settings-status">{status}</div>}
    </div>

  </div>
}
