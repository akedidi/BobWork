import { useAppStore } from '../../stores/appStore';
import { Zap, AlertCircle, Loader } from 'lucide-react';
import { clsx } from 'clsx';

export function BobStatusBadge() {
  const { bobStatus, bobInfo } = useAppStore();

  const config = {
    detecting: { icon: Loader, label: 'Détection...', color: 'text-bw-text-tertiary', spin: true },
    not_found: { icon: AlertCircle, label: 'Bob introuvable', color: 'text-bw-error', spin: false },
    incompatible: { icon: AlertCircle, label: 'Version incompatible', color: 'text-bw-warning', spin: false },
    unauthenticated: { icon: AlertCircle, label: 'Non connecté', color: 'text-bw-warning', spin: false },
    ready: { icon: Zap, label: 'Bob prêt', color: 'text-bw-success', spin: false },
    busy: { icon: Loader, label: 'Bob actif', color: 'text-bw-accent-primary', spin: true },
    error: { icon: AlertCircle, label: 'Erreur Bob', color: 'text-bw-error', spin: false },
  };

  const { icon: Icon, label, color, spin } = config[bobStatus] ?? config.detecting;

  return (
    <div className={clsx('sidebar-item', color)}>
      <Icon className={clsx('w-4 h-4 flex-shrink-0', spin && 'animate-spin-slow')} />
      <span className="text-xs">{label}</span>
      {bobInfo?.version && (
        <span className="text-xs text-bw-text-tertiary ml-auto">v{bobInfo.version}</span>
      )}
    </div>
  );
}
