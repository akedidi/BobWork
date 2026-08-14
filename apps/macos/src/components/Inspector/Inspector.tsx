// ============================================================
// Bob Work – Inspector Panel
// Active tasks progress shown in the right panel
// ============================================================

import { useAppStore } from '../../stores/appStore';
import { useT } from '../../i18n';

export function Inspector() {
  const t = useT();
  const { inspectorWidth, tasks } = useAppStore();
  const activeTasks = tasks.filter(t => t.state === 'running' || t.state === 'awaiting_approval');

  return (
    <div
      style={{
        width: inspectorWidth,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-surface)',
        borderLeft: '1px solid var(--border)',
        overflow: 'hidden',
      }}
    >
      {/* macOS traffic light drag area */}
      <div style={{ flexShrink: 0, height: 32 }} className="mac-drag" />

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
        {activeTasks.length > 0 ? (
          <div>
            <div style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--text-muted)',
              marginBottom: 10,
            }}>
              {t('inspector.activeTasks')}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {activeTasks.map(task => (
                <div
                  key={task.id}
                  style={{
                    background: 'var(--bg-base)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '10px 12px',
                  }}
                >
                  <div style={{ fontSize: 12.5, fontWeight: 500, lineHeight: 1.4, marginBottom: 8 }}>
                    {task.objective.length > 60
                      ? task.objective.slice(0, 60) + '…'
                      : task.objective}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 5 }}>
                    <span>{task.state === 'running' ? t('inspector.running') : t('inspector.awaitingApproval')}</span>
                    <span>{Math.round(task.progress)}%</span>
                  </div>
                  <div style={{
                    height: 4,
                    background: 'var(--bg-active)',
                    borderRadius: 99,
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      height: '100%',
                      width: `${task.progress}%`,
                      background: task.state === 'running' ? 'var(--accent)' : 'var(--warning, #f59e0b)',
                      borderRadius: 99,
                      transition: 'width .4s ease',
                    }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: 192,
            textAlign: 'center',
            color: 'var(--text-muted)',
            gap: 6,
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity={0.3}>
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
            <span style={{ fontSize: 12 }}>{t('inspector.noActivity')}</span>
          </div>
        )}
      </div>
    </div>
  );
}
