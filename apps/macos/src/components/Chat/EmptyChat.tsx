import { useT } from '../../i18n'

export function EmptyChat({ builderMode }: { builderMode?: 'plugin_builder' | 'skill_builder' | null }) {
  const t = useT()
  const hint = builderMode === 'plugin_builder'
    ? 'Décrivez le plugin (ex. « brief client AXA avec risques à vérifier »). Pas de formulaire.'
    : builderMode === 'skill_builder'
      ? 'Décrivez le skill (ex. « relire un contrat et lister les clauses à risque »). Pas de formulaire.'
      : t('chat.empty')
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 12, marginBottom: 24,
      color: 'var(--text-muted)', fontSize: 14,
    }}>
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity={0.4}>
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      <span>{hint}</span>
    </div>
  )
}
