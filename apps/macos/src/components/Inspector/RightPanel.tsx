import { useState } from 'react'
import { useT } from '../../i18n'

type PanelContext = { type: 'file' | 'link' | 'sources' | 'task'; data?: unknown }
const TABS = ['preview', 'sources', 'history'] as const

export default function RightPanel({ context, onClose }: {
  context: PanelContext
  onClose: () => void
}) {
  const t = useT()
  const [tab, setTab] = useState<typeof TABS[number]>('preview')

  const title = context.type === 'file' ? t('inspector.file')
    : context.type === 'link' ? t('inspector.webPage')
    : context.type === 'sources' ? t('inspector.sources')
    : t('inspector.task')

  return (
    <div className="inspector-panel">
      {/* Tabs header */}
      <div className="inspector-tabs">
        {TABS.map(tabKey => (
          <button
            key={tabKey}
            className={`inspector-tab ${tab === tabKey ? 'active' : ''}`}
            onClick={() => setTab(tabKey)}
          >
            {t(`inspector.${tabKey}`)}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          className="icon-btn"
          style={{ marginTop: 'auto', marginBottom: 2 }}
          onClick={onClose}
          title={t('common.close')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        {tab === 'preview' && (
          <div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '12px 14px', borderRadius: 'var(--radius-md)',
              background: 'var(--bg-hover)', marginBottom: 16,
              border: '1px solid var(--border)'
            }}>
              <span style={{ fontSize: 22 }}>
                {context.type === 'file' ? '📄' : context.type === 'link' ? '🔗' : '📋'}
              </span>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{title}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  {context.type === 'link' ? t('inspector.webPage') : t('inspector.localDocument')}
                </div>
              </div>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              {t('inspector.previewHint')}
            </p>
          </div>
        )}
        {tab === 'sources' && (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', paddingTop: 40 }}>
            {t('inspector.noSources')}
          </div>
        )}
        {tab === 'history' && (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', paddingTop: 40 }}>
            {t('inspector.noHistory')}
          </div>
        )}
      </div>
    </div>
  )
}
