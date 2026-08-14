import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../stores/appStore'
import {
  EMPTY_PLUGIN_DRAFT,
  PLUGIN_BUILDER_STEPS,
  PLUGIN_PERMISSION_OPTIONS,
  PLUGIN_TOOL_OPTIONS,
  PLUGIN_CONVERSATION_PROMPT,
  buildPluginGenerationPrompt,
  canAdvancePluginBuilder,
  pluginBuilderPreview,
  pluginBuilderStepIndex,
  toggleList,
  type PluginBuilderDraft,
  type PluginBuilderStep,
  type PluginTrigger,
} from '../lib/pluginBuilder'

const STEP_LABEL: Record<PluginBuilderStep, string> = {
  objectif: 'Objectif',
  declencheur: 'Déclencheur',
  outils: 'Outils',
  permissions: 'Autorisations',
  apercu: 'Aperçu',
}

export default function PluginBuilderView() {
  const navigate = useNavigate()
  const setBuilderSession = useAppStore(s => s.setBuilderSession)
  const [step, setStep] = useState<PluginBuilderStep>('objectif')
  const [draft, setDraft] = useState<PluginBuilderDraft>(EMPTY_PLUGIN_DRAFT)
  const index = pluginBuilderStepIndex(step)
  const preview = useMemo(() => pluginBuilderPreview(draft), [draft])
  const canNext = canAdvancePluginBuilder(step, draft)

  const goNext = () => {
    if (!canNext) return
    const next = PLUGIN_BUILDER_STEPS[index + 1]
    if (next) setStep(next)
  }

  const goBack = () => {
    const prev = PLUGIN_BUILDER_STEPS[index - 1]
    if (prev) setStep(prev)
    else navigate('/plugins')
  }

  const generate = () => {
    const brief = buildPluginGenerationPrompt(draft)
    setBuilderSession({ kind: 'plugin_builder', brief, guided: true })
    navigate('/chat', {
      state: {
        mode: 'plugin_builder',
        initialPrompt: brief,
      },
    })
  }

  return (
    <div className="plugin-builder">
      <div className="topbar titlebar-drag" data-tauri-drag-region>
        <span className="topbar-title">Nouveau plugin</span>
      </div>
      <div className="plugin-builder-body">
        <ol className="plugin-builder-steps" aria-label="Étapes de création">
          {PLUGIN_BUILDER_STEPS.map((item, itemIndex) => (
            <li key={item} className={itemIndex === index ? 'active' : itemIndex < index ? 'done' : ''}>
              <button type="button" disabled={itemIndex > index} onClick={() => setStep(item)}>
                {itemIndex + 1}. {STEP_LABEL[item]}
              </button>
            </li>
          ))}
        </ol>

        {step === 'objectif' && (
          <section className="plugin-builder-panel">
            <h1>Que doit faire ce plugin ?</h1>
            <p>Décrivez le bénéfice pour l’utilisateur — pas la stack technique.</p>
            <p className="settings-note">
              Vous pouvez aussi{' '}
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  const brief = PLUGIN_CONVERSATION_PROMPT
                  setBuilderSession({ kind: 'plugin_builder', brief, guided: false })
                  navigate('/chat', { state: { mode: 'plugin_builder', initialPrompt: brief } })
                }}
              >
                créer directement dans le chat
              </button>
              , sans ces étapes.
            </p>
            <label>
              Nom
              <input
                value={draft.name}
                onChange={event => setDraft(current => ({ ...current, name: event.target.value }))}
                placeholder="Ex. : Brief mission AXA"
              />
            </label>
            <label>
              Bénéfice (description)
              <textarea
                rows={3}
                value={draft.description}
                onChange={event => setDraft(current => ({ ...current, description: event.target.value }))}
                placeholder="Ex. : Prépare un brief client et liste les risques à vérifier."
              />
            </label>
            <label>
              Pour qui (optionnel)
              <input
                value={draft.audience}
                onChange={event => setDraft(current => ({ ...current, audience: event.target.value }))}
                placeholder="Ex. : consultants, CTO, équipe Pursuit"
              />
            </label>
          </section>
        )}

        {step === 'declencheur' && (
          <section className="plugin-builder-panel">
            <h1>Quand s’exécute-t-il ?</h1>
            {([
              ['manual', 'Manuel — je l’appelle dans le chat'],
              ['schedule', 'Planifié — cron ou récurrence'],
              ['event', 'Événement — fichier, mail, webhook'],
            ] as Array<[PluginTrigger, string]>).map(([value, label]) => (
              <label key={value} className="plugin-builder-choice">
                <input
                  type="radio"
                  name="trigger"
                  checked={draft.trigger === value}
                  onChange={() => setDraft(current => ({ ...current, trigger: value }))}
                />
                {label}
              </label>
            ))}
            {draft.trigger === 'schedule' && (
              <label>
                Récurrence
                <input
                  value={draft.schedule}
                  onChange={event => setDraft(current => ({ ...current, schedule: event.target.value }))}
                  placeholder="Ex. : chaque lundi 9h"
                />
              </label>
            )}
            <label>
              Entrées
              <input
                value={draft.inputs}
                onChange={event => setDraft(current => ({ ...current, inputs: event.target.value }))}
                placeholder="Fichiers, URL, conversation…"
              />
            </label>
            <label>
              Sorties
              <input
                value={draft.outputs}
                onChange={event => setDraft(current => ({ ...current, outputs: event.target.value }))}
                placeholder="PPTX, markdown, mail…"
              />
            </label>
          </section>
        )}

        {step === 'outils' && (
          <section className="plugin-builder-panel">
            <h1>Quels outils embarquer ?</h1>
            <p>Cochez uniquement ce qui sert le workflow.</p>
            {PLUGIN_TOOL_OPTIONS.map(option => (
              <label key={option.id} className="plugin-builder-choice">
                <input
                  type="checkbox"
                  checked={draft.tools.includes(option.id)}
                  onChange={() => setDraft(current => ({ ...current, tools: toggleList(current.tools, option.id) }))}
                />
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.hint}</small>
                </span>
              </label>
            ))}
          </section>
        )}

        {step === 'permissions' && (
          <section className="plugin-builder-panel">
            <h1>Quelles autorisations ?</h1>
            <p>Bob Work les affichera avant installation. Restez honnête.</p>
            {PLUGIN_PERMISSION_OPTIONS.map(option => (
              <label key={option.id} className="plugin-builder-choice">
                <input
                  type="checkbox"
                  checked={draft.permissions.includes(option.id)}
                  onChange={() => setDraft(current => ({
                    ...current,
                    permissions: toggleList(current.permissions, option.id),
                  }))}
                />
                {option.label}
              </label>
            ))}
          </section>
        )}

        {step === 'apercu' && (
          <section className="plugin-builder-panel" aria-label="Aperçu du plugin">
            <h1>Aperçu</h1>
            <dl className="plugin-builder-preview">
              <div><dt>Nom</dt><dd>{preview.name}</dd></div>
              <div><dt>Bénéfice</dt><dd>{preview.description}</dd></div>
              <div><dt>Déclencheur</dt><dd>{preview.trigger}</dd></div>
              <div><dt>Outils</dt><dd>{preview.tools.join(' · ')}</dd></div>
              <div><dt>Autorisations</dt><dd>{preview.permissions.join(' · ')}</dd></div>
              <div><dt>Flux</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{preview.io}</dd></div>
            </dl>
            <p className="settings-note">
              Bob génère le bundle à partir de ce plan (plus d’entretien). Ensuite, ouvrez Plugins pour la mise en service.
            </p>
          </section>
        )}

        <div className="plugin-builder-actions">
          <button type="button" className="secondary-btn" onClick={goBack}>
            {index === 0 ? 'Annuler' : 'Retour'}
          </button>
          {step !== 'apercu' ? (
            <button type="button" className="btn-primary" disabled={!canNext} onClick={goNext}>
              Continuer
            </button>
          ) : (
            <button type="button" className="btn-primary" onClick={generate}>
              Générer le plugin
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
