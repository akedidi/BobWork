import React from 'react';
import type { Plugin, PluginCategory } from '@bob-work/shared-types';
import { ModalOverlay, ModalPanel } from '../ModalOverlay';

type Form = { name: string; description: string; instructions: string; category: PluginCategory };

export function PluginEditorModal({
  formOpen,
  editing,
  form,
  setFormOpen,
  setForm,
  onSave,
}: {
  formOpen: boolean;
  editing: Plugin | null;
  form: Form;
  setFormOpen: (open: boolean) => void;
  setForm: React.Dispatch<React.SetStateAction<Form>>;
  onSave: () => Promise<void>;
}) {
  if (!formOpen) return null;

  return (
    <ModalOverlay onClose={() => setFormOpen(false)}>
      <ModalPanel className="plugin-editor-modal" aria-labelledby="plugin-editor-title">
        <h2 id="plugin-editor-title">{editing ? 'Modifier les instructions du plugin' : 'Modifier le plugin'}</h2>
        <p className="settings-note">
          Ce formulaire enregistre des consignes pour Bob, pas un bundle agentique avec MCP/CLI.
          Pour un vrai plugin avec outils, utilisez « Créer avec Bob ».
        </p>
        <label>
          Nom
          <input
            value={form.name}
            onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))}
            placeholder="Ex : Assistant contrats"
          />
        </label>
        <label>
          Description
          <small style={{ display: 'block', marginTop: 3, color: 'var(--text-muted)', fontWeight: 400 }}>
            En 1–2 phrases : ce que le plugin fait pour l’utilisateur (pas la stack technique).
          </small>
          <input
            value={form.description}
            onChange={(event) => setForm((value) => ({ ...value, description: event.target.value }))}
            placeholder="Ex. : Prépare un résumé de contrat et liste les clauses à vérifier"
          />
        </label>
        <label>
          Instructions
          <textarea
            rows={12}
            value={form.instructions}
            onChange={(event) => setForm((value) => ({ ...value, instructions: event.target.value }))}
            placeholder="Expliquez ce que Bob doit faire, les vérifications attendues et les limites à respecter…"
          />
        </label>
        <div className="settings-actions">
          <button className="secondary-btn" onClick={() => setFormOpen(false)}>
            Retour
          </button>
          <button
            className="btn-primary"
            disabled={!form.name || !form.description || !form.instructions}
            onClick={() => void onSave()}
          >
            Enregistrer
          </button>
        </div>
      </ModalPanel>
    </ModalOverlay>
  );
}
