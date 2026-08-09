import { useEffect, useMemo, useState } from 'react'
import {
  deleteSkill, getSkills, saveSkill, setSkillEnabled,
} from '../lib/ipc'
import type { WorkspaceSkill } from '@bob-work/shared-types'

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

export default function ExtensionsView() {
  const [skills, setSkills] = useState<WorkspaceSkill[]>([])
  const [skillForm, setSkillForm] = useState({ slug: '', description: '', content: '' })
  const [editingSkill, setEditingSkill] = useState<string | null>(null)
  const [selectedSkillKey, setSelectedSkillKey] = useState<string | null>(null)
  const [skillPanel, setSkillPanel] = useState<SkillPanel>('closed')
  const [skillSearch, setSkillSearch] = useState('')
  const [togglingSkill, setTogglingSkill] = useState<string | null>(null)
  const [status, setStatus] = useState('')

  const load = async () => {
    const nextSkills = await getSkills().catch(() => [])
    setSkills(nextSkills)
    return nextSkills
  }
  useEffect(() => { void load() }, [])

  const selectedSkill = skills.find(skill => skillKey(skill) === selectedSkillKey) ?? null
  const visibleSkills = useMemo(() => {
    const query = skillSearch.trim().toLocaleLowerCase()
    if (!query) return skills
    return skills.filter(skill => `${skill.name} ${skill.description} ${skill.slug}`.toLocaleLowerCase().includes(query))
  }, [skillSearch, skills])

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
    } catch (error) { setStatus(String(error)) }
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
      setStatus(String(error))
    } finally {
      setTogglingSkill(null)
    }
  }

  const removeSelectedSkill = async (skill: WorkspaceSkill) => {
    if (!confirm(`Supprimer ${skill.name} ?`)) return
    await deleteSkill(skill.slug)
    setSelectedSkillKey(null)
    closeSkillPanel()
    await load()
  }

  return <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
    <div className="topbar titlebar-drag"><strong className="titlebar-no-drag">Skills</strong></div>
    <div className="extensions-content">
      <div className={`skills-workspace ${skillPanel !== 'closed' ? 'has-panel' : ''}`}>
        <section className="skills-browser">
          <div className="skills-toolbar">
            <div><h2>Skills</h2><small>{skills.filter(skill => skill.enabled).length} activés sur {skills.length}</small></div>
            <button className="btn-primary" onClick={openCreateSkill}>+ Nouveau skill</button>
          </div>
          <div className="skill-search-wrap">
            <span aria-hidden="true">⌕</span>
            <input value={skillSearch} onChange={event => setSkillSearch(event.target.value)} placeholder="Rechercher un skill" aria-label="Rechercher un skill" />
          </div>
          <p className="skills-help">Activez uniquement les skills que Bob peut utiliser. Cliquez sur un skill pour afficher ses détails.</p>
          <div className="skills-list">
            {visibleSkills.length === 0 ? <div className="task-empty">{skills.length === 0 ? 'Aucun skill détecté.' : 'Aucun résultat.'}</div> : visibleSkills.map(skill => {
              const key = skillKey(skill)
              return <div className={`skill-list-row ${selectedSkillKey === key ? 'selected' : ''} ${skill.enabled ? '' : 'disabled'}`} key={key}>
                <button className="skill-row-main" onClick={() => { setSelectedSkillKey(key); setSkillPanel('detail') }}>
                  <span className="skill-row-icon" aria-hidden="true">✦</span>
                  <span className="skill-row-copy"><strong>{skill.name}</strong><small>{skill.description || 'Aucune description'}</small></span>
                  <span className="skill-scope-badge">{scopeLabel(skill.scope)}</span>
                </button>
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
            <div className="skill-detail-title"><span className="skill-row-icon" aria-hidden="true">✦</span><div><h2>{selectedSkill.name}</h2><small>{selectedSkill.slug}</small></div></div>
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
          <section className="skill-detail-section"><h3>Source</h3><dl><div><dt>Portée</dt><dd>{scopeLabel(selectedSkill.scope)}</dd></div><div><dt>Fichier</dt><dd title={selectedSkill.sourcePath}>{selectedSkill.sourcePath}</dd></div></dl></section>
          <section className="skill-detail-section skill-instructions"><h3>Instructions</h3><pre>{selectedSkill.content || 'Aucune instruction.'}</pre></section>
          {selectedSkill.scope === 'global-bob' && <div className="skill-panel-actions"><button className="secondary-btn" onClick={() => editSkill(selectedSkill)}>Modifier</button><button className="danger-link" onClick={() => void removeSelectedSkill(selectedSkill)}>Supprimer</button></div>}
        </aside>}

        {skillPanel === 'editor' && <aside className="skill-detail-panel skill-editor-panel" aria-label={editingSkill ? 'Modifier le skill' : 'Créer un skill'}>
          <div className="skill-panel-heading"><div><h2>{editingSkill ? 'Modifier le skill' : 'Nouveau skill'}</h2><small>{editingSkill ? 'Mettez à jour ses instructions.' : 'Créez un skill personnel pour Bob.'}</small></div><button className="icon-btn" aria-label="Fermer l’éditeur" onClick={closeSkillPanel}>×</button></div>
          <label>Identifiant<input value={skillForm.slug} disabled={!!editingSkill} onChange={event => setSkillForm(value => ({ ...value, slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }))} placeholder="analyse-contrats" /></label>
          <label>Description<input value={skillForm.description} onChange={event => setSkillForm(value => ({ ...value, description: event.target.value }))} placeholder="Quand utiliser ce skill" /></label>
          <label>Instructions<textarea rows={14} value={skillForm.content} onChange={event => setSkillForm(value => ({ ...value, content: event.target.value }))} placeholder="Décris étape par étape ce que Bob doit faire…" /></label>
          <div className="skill-panel-actions"><button className="btn-primary" disabled={!skillForm.slug || !skillForm.description || !skillForm.content} onClick={persistSkill}>Enregistrer</button><button className="secondary-btn" onClick={closeSkillPanel}>Annuler</button></div>
        </aside>}
      </div>
      {status && <div className="settings-status">{status}</div>}
    </div>
  </div>
}
