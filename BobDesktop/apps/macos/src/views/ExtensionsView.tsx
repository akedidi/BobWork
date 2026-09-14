import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  deleteSkill, getSkills, saveSkill, setSkillEnabled,
} from '../lib/ipc'
import { PluginIcon, resolveSkillIcon } from '../components/PluginIcon'
import { LoadErrorBanner } from '../components/LoadErrorBanner'
import { errorMessage } from '../lib/errorMessage'
import { isBuiltinSkill, sortSkillsForDisplay } from '../lib/builtinCatalog'
import { formatCatalogDate } from '../lib/formatDate'
import type { WorkspaceSkill } from '@bob-work/shared-types'
import { useT } from '../i18n'
import { useAppStore } from '../stores/appStore'
import { useAppDialog } from '../components/AppDialog'

type SkillPanel = 'closed' | 'detail' | 'editor'

const skillKey = (skill: WorkspaceSkill) => `${skill.scope}:${skill.slug}`
const scopeLabel = (scope: string) => ({
  'global-bob': 'Bob · Personnel',
  'global-agents': 'Agents · Personnel',
  'global-claude': 'SKILL.md · Personnel',
  'workspace-bob': 'Bob · Projet',
  'workspace-agents': 'Agents · Projet',
  'workspace-claude': 'SKILL.md · Projet',
}[scope] ?? scope)

const skillScopeLabel = (skill: WorkspaceSkill) =>
  isBuiltinSkill(skill) ? 'Bob · Intégré' : scopeLabel(skill.scope)

/** Personal Bob skills can be deleted from the list; built-ins and nested children cannot. */
const canDeleteSkill = (skill: WorkspaceSkill) =>
  !skill.parentSlug
  && !isBuiltinSkill(skill)
  && (skill.scope === 'global-bob' || skill.scope === 'workspace-bob')

function workspaceRootForSkill(skill: WorkspaceSkill): string | undefined {
  if (skill.scope !== 'workspace-bob') return undefined
  const marker = '/.bob/skills/'
  const index = skill.sourcePath.indexOf(marker)
  if (index <= 0) return undefined
  return skill.sourcePath.slice(0, index)
}

function childCount(skill: WorkspaceSkill) {
  return skill.childSkills?.length ?? 0
}

const CREATE_SKILL_PROMPT =
  '@skill:skill-creator Crée avec moi un skill personnel Bob Work (pas un plugin agentique). '
  + 'Demande-moi l’objectif, le moment d’utilisation et les consignes, puis écris le fichier localement.'

const IMPORT_SKILL_PROMPT =
  '@skill:skill-creator Aide-moi à rapatrier un skill open-source (SKILL.md) dans Bob Work '
  + '(URL GitHub ou fichier local). Adapte-le au format Bob personnel sans écraser un skill existant.'

export default function ExtensionsView() {
  const t = useT()
  const dialog = useAppDialog()
  const navigate = useNavigate()
  const location = useLocation()
  const requestedSkillSlug = (location.state as { skillSlug?: string } | null)?.skillSlug
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
    if (!requestedSkillSlug || skills.length === 0) return
    const needle = requestedSkillSlug.toLocaleLowerCase()
    const match = skills.find(skill => skill.slug.toLocaleLowerCase() === needle)
      ?? skills.flatMap(skill => skill.childSkills ?? []).find(skill =>
        skill.slug.toLocaleLowerCase() === needle
        || skill.slug.toLocaleLowerCase().endsWith(`/${needle}`)
        || skill.name.toLocaleLowerCase() === needle)
      ?? skills.find(skill => skill.name.toLocaleLowerCase() === needle)
      ?? skills.find(skill => skill.slug.toLocaleLowerCase().endsWith(`-${needle}`))
    if (!match) return
    setSelectedSkillKey(skillKey(match))
    setSkillPanel('detail')
  }, [requestedSkillSlug, skills])

  useEffect(() => {
    if (!status) return
    if (statusTimerRef.current) window.clearTimeout(statusTimerRef.current)
    statusTimerRef.current = window.setTimeout(() => setStatus(''), 3500)
    return () => {
      if (statusTimerRef.current) window.clearTimeout(statusTimerRef.current)
    }
  }, [status])

  const selectedSkill = useMemo(() => {
    if (!selectedSkillKey) return null
    for (const skill of skills) {
      if (skillKey(skill) === selectedSkillKey) return skill
      const child = skill.childSkills?.find(item => skillKey(item) === selectedSkillKey)
      if (child) return child
    }
    return null
  }, [selectedSkillKey, skills])
  const parentOfSelected = useMemo(() => {
    if (!selectedSkill?.parentSlug) return null
    return skills.find(skill => skill.slug === selectedSkill.parentSlug) ?? null
  }, [selectedSkill, skills])
  const visibleSkills = useMemo(() => {
    const query = skillSearch.trim().toLocaleLowerCase()
    const topLevel = skills.filter(skill => !skill.parentSlug)
    const filtered = query
      ? topLevel.filter(skill => {
          const haystack = [
            skill.name,
            skill.description,
            skill.slug,
            ...(skill.childSkills ?? []).flatMap(child => [child.name, child.description, child.slug]),
          ].join(' ').toLocaleLowerCase()
          return haystack.includes(query)
        })
      : topLevel
    return sortSkillsForDisplay(filtered)
  }, [skillSearch, skills])

  const openSkillDetail = (skill: WorkspaceSkill) => {
    setSelectedSkillKey(skillKey(skill))
    setSkillPanel('detail')
  }

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
    const patchTree = (items: WorkspaceSkill[], value: boolean): WorkspaceSkill[] =>
      items.map(item => {
        if (skillKey(item) === key) return { ...item, enabled: value }
        if (!item.childSkills?.length) return item
        return {
          ...item,
          childSkills: item.childSkills.map(child =>
            skillKey(child) === key ? { ...child, enabled: value } : child,
          ),
        }
      })
    setSkills(current => patchTree(current, enabled))
    try {
      await setSkillEnabled(
        skill.slug,
        skill.scope,
        enabled,
        workspaceRootForSkill(skill),
      )
      setStatus(`${skill.name} est maintenant ${enabled ? 'activé' : 'désactivé'}.`)
    } catch (error) {
      setSkills(current => patchTree(current, !enabled))
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
            <div><h2>{t('skills.title')}</h2><small>{skills.filter(skill => !skill.parentSlug && skill.enabled).length} activés sur {skills.filter(skill => !skill.parentSlug).length}</small></div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="secondary-btn" onClick={() => startSkillChat(IMPORT_SKILL_PROMPT)}>Importer un skill</button>
              <button type="button" className="secondary-btn" onClick={openCreateSkill}>Formulaire</button>
              <button className="btn-primary" onClick={() => startSkillChat()}>+ Nouveau skill</button>
            </div>
          </div>
          <div className="skill-search-wrap">
            <span aria-hidden="true">⌕</span>
            <input value={skillSearch} onChange={event => setSkillSearch(event.target.value)} placeholder="Rechercher un skill" aria-label="Rechercher un skill" />
          </div>
          <p className="skills-help">
            « + Nouveau skill » ouvre le chat : décrivez l’idée, Bob écrit le `SKILL.md`. Le formulaire et l’import depuis GitHub restent optionnels.
            Le badge <strong>Intégré</strong> marque les skills natifs — ils ne peuvent pas être supprimés.
          </p>
          <div className="skills-list">
            {loadError ? null : loading ? <div className="task-empty">Chargement…</div> : visibleSkills.length === 0 ? <div className="task-empty">{skills.length === 0 ? t('skills.empty') : t('skills.noneFound')}</div> : visibleSkills.map(skill => {
              const key = skillKey(skill)
              const deletable = canDeleteSkill(skill)
              return <div className={`skill-list-row ${selectedSkillKey === key || selectedSkill?.parentSlug === skill.slug ? 'selected' : ''} ${skill.enabled ? '' : 'disabled'}`} key={key}>
                <button className="skill-row-main" onClick={() => openSkillDetail(skill)}>
                  <PluginIcon icon={resolveSkillIcon(skill)} size="md" className="skill-row-icon" />
                  <span className="skill-row-copy"><strong>{skill.name}</strong><small>{skill.description || 'Aucune description'}</small></span>
                  <span className="skill-row-badges">
                    {childCount(skill) > 0 ? <span className="skill-nested-badge">{t('skills.nestedCount', { count: childCount(skill) })}</span> : null}
                    {isBuiltinSkill(skill) ? <span className="skill-builtin-badge">Intégré</span> : null}
                    <span className="skill-scope-badge">{skillScopeLabel(skill)}</span>
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
            <div className="skill-detail-title"><PluginIcon icon={resolveSkillIcon(selectedSkill)} size="lg" className="skill-row-icon" /><div><h2>{selectedSkill.name}{isBuiltinSkill(selectedSkill) ? <span className="skill-builtin-badge">Intégré</span> : null}</h2><small>{selectedSkill.slug}</small></div></div>
            <button className="icon-btn" aria-label="Fermer les détails" onClick={closeSkillPanel}>×</button>
          </div>
          {parentOfSelected ? (
            <button type="button" className="skill-parent-link" onClick={() => openSkillDetail(parentOfSelected)}>
              ← {t('skills.backToParent', { name: parentOfSelected.name })}
            </button>
          ) : null}
          <div className="skill-detail-status">
            <div><strong>{selectedSkill.enabled ? 'Activé' : 'Désactivé'}</strong><small>{selectedSkill.enabled ? 'Bob peut utiliser ce skill.' : 'Bob n’utilisera pas ce skill.'}</small></div>
            <label className="skill-switch">
              <input type="checkbox" checked={selectedSkill.enabled} disabled={togglingSkill === skillKey(selectedSkill)} aria-label={`${selectedSkill.enabled ? 'Désactiver' : 'Activer'} le skill ${selectedSkill.name}`} onChange={event => void toggleSkill(selectedSkill, event.target.checked)} />
              <span aria-hidden="true" />
            </label>
          </div>
          <section className="skill-detail-section"><h3>Description</h3><p>{selectedSkill.description || 'Aucune description.'}</p></section>
          <section className="skill-detail-section"><h3>Source</h3><dl>
            <div><dt>Type</dt><dd>{selectedSkill.parentSlug ? t('skills.nestedType') : isBuiltinSkill(selectedSkill) ? 'Skill intégré Bob Work (natif, ex. Computer Use / Office)' : 'Skill personnel ou externe'}</dd></div>
            {selectedSkill.parentSlug ? <div><dt>{t('skills.parent')}</dt><dd>{selectedSkill.parentSlug}</dd></div> : null}
            {selectedSkill.relativePath ? <div><dt>{t('skills.relativePath')}</dt><dd>{selectedSkill.relativePath}</dd></div> : null}
            <div><dt>Portée</dt><dd>{skillScopeLabel(selectedSkill)}</dd></div>
            {selectedSkill.createdAt ? (
              <div>
                <dt>{isBuiltinSkill(selectedSkill) ? t('skills.availableSince') : t('skills.createdAt')}</dt>
                <dd>{formatCatalogDate(selectedSkill.createdAt)}</dd>
              </div>
            ) : null}
            {selectedSkill.updatedAt && selectedSkill.updatedAt !== selectedSkill.createdAt ? (
              <div><dt>{t('skills.updatedAt')}</dt><dd>{formatCatalogDate(selectedSkill.updatedAt)}</dd></div>
            ) : null}
            <div><dt>Fichier</dt><dd title={selectedSkill.sourcePath}>{selectedSkill.sourcePath}</dd></div>
          </dl></section>
          {(selectedSkill.childSkills?.length ?? 0) > 0 ? (
            <section className="skill-detail-section" aria-label={t('skills.nestedHeading')}>
              <h3>{t('skills.nestedHeading')}</h3>
              <p className="skill-nested-hint">{t('skills.nestedHint')}</p>
              <ul className="skill-nested-list">
                {selectedSkill.childSkills!.map(child => (
                  <li key={skillKey(child)}>
                    <button type="button" className="skill-nested-item" onClick={() => openSkillDetail(child)}>
                      <PluginIcon icon={resolveSkillIcon(child)} size="sm" className="skill-row-icon" />
                      <span className="skill-nested-copy">
                        <strong>{child.name}</strong>
                        <small>{child.description || child.slug}</small>
                      </span>
                      <span className="skill-nested-meta">{child.enabled ? t('skills.enabledShort') : t('skills.disabledShort')}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
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
