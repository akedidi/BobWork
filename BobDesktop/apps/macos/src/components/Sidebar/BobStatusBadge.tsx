import { useAppStore } from '../../stores/appStore';
import { Zap, AlertCircle, Loader } from 'lucide-react';

const STATUS_STYLE: Record<string, { color: string }> = {
  detecting: { color: 'var(--text-muted)' },
  not_found: { color: 'var(--danger)' },
  incompatible: { color: 'var(--warning)' },
  unauthenticated: { color: 'var(--warning)' },
  ready: { color: 'var(--success)' },
  busy: { color: 'var(--accent)' },
  error: { color: 'var(--danger)' },
};

export function BobStatusBadge() {
  const { bobStatus, bobInfo } = useAppStore();
  const config = {
    detecting: { icon: Loader, label: 'Détection…', spin: true },
    not_found: { icon: AlertCircle, label: 'Bob introuvable', spin: false },
    incompatible: { icon: AlertCircle, label: 'Version incompatible', spin: false },
    unauthenticated: { icon: AlertCircle, label: 'Non connecté', spin: false },
    ready: { icon: Zap, label: 'Bob prêt', spin: false },
    busy: { icon: Loader, label: 'Bob actif', spin: true },
    error: { icon: AlertCircle, label: 'Erreur Bob', spin: false },
  };

  const { icon: Icon, label, spin } = config[bobStatus] ?? config.detecting;
  const color = (STATUS_STYLE[bobStatus] ?? STATUS_STYLE.detecting).color;

  return (
    <div className="sidebar-item" style={{ color }}>
      <Icon
        className={spin ? 'animate-spin-slow' : undefined}
        style={{ width: 16, height: 16, flexShrink: 0 }}
      />
      <span style={{ fontSize: 12 }}>{label}</span>
      {bobInfo?.version && (
        <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>
          v{bobInfo.version}
        </span>
      )}
    </div>
  );
}
