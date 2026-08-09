// ============================================================
// Bob Work - Approval Overlay
// Clear, risk-aware approval cards
// ============================================================

import { X, Check, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { Approval } from '@bob-work/shared-types';
import { resolveApproval } from '../../lib/ipc';
import { useAppStore } from '../../stores/appStore';
import { clsx } from 'clsx';

interface ApprovalOverlayProps {
  approval: Approval;
}

const RISK_CONFIG = {
  low: { label: 'Faible', className: 'risk-low', icon: ShieldCheck },
  medium: { label: 'Moyen', className: 'risk-medium', icon: ShieldAlert },
  high: { label: 'Élevé', className: 'risk-high', icon: ShieldAlert },
  critical: { label: 'Critique', className: 'risk-critical', icon: ShieldAlert },
};

export function ApprovalOverlay({ approval }: ApprovalOverlayProps) {
  const { removeApproval } = useAppStore();
  const riskConfig = RISK_CONFIG[approval.riskLevel as keyof typeof RISK_CONFIG] ?? RISK_CONFIG.medium;
  const RiskIcon = riskConfig.icon;

  const handleDecision = async (decision: string, duration?: string) => {
    try {
      await resolveApproval(approval.id, { decision, permissionDuration: duration });
      removeApproval(approval.id);
    } catch (err) {
      console.error('Failed to resolve approval:', err);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-6 animate-in">
      <div className="bg-bw-surface-1 dark:bg-bw-surface-dark-1 rounded-xl shadow-xl max-w-md w-full border border-bw-border-medium dark:border-bw-border-medium-dark overflow-hidden">
        {/* Header */}
        <div className={clsx(
          'flex items-center justify-between p-4 border-b border-bw-border-light dark:border-bw-border-light-dark',
          approval.riskLevel === 'critical' && 'bg-red-50 dark:bg-red-900/20',
          approval.riskLevel === 'high' && 'bg-orange-50 dark:bg-orange-900/20',
        )}>
          <div className="flex items-center gap-2">
            <RiskIcon className={clsx(
              'w-5 h-5',
              approval.riskLevel === 'critical' && 'text-bw-error',
              approval.riskLevel === 'high' && 'text-orange-600',
              approval.riskLevel === 'medium' && 'text-bw-warning',
              approval.riskLevel === 'low' && 'text-bw-success',
            )} />
            <span className="font-semibold text-base text-bw-text-primary dark:text-bw-text-primary-dark">
              Approbation requise
            </span>
          </div>
          <span className={clsx('badge', riskConfig.className)}>
            Risque {riskConfig.label}
          </span>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3">
          {/* Main description */}
          <div>
            <p className="text-sm font-medium text-bw-text-primary dark:text-bw-text-primary-dark">
              {approval.humanDescription}
            </p>
          </div>

          {/* Details */}
          <div className="space-y-2 text-sm">
            {approval.commandOrChange && (
              <div>
                <span className="text-xs font-medium text-bw-text-secondary uppercase tracking-wide">Action</span>
                <div className="mt-1 bg-bw-surface-3 dark:bg-bw-surface-dark-3 rounded px-3 py-2 font-mono text-xs break-all">
                  {approval.commandOrChange}
                </div>
              </div>
            )}

            {Array.isArray(approval.filesAffected) && approval.filesAffected.length > 0 && (
              <div>
                <span className="text-xs font-medium text-bw-text-secondary uppercase tracking-wide">Fichiers</span>
                <ul className="mt-1 space-y-0.5">
                  {(approval.filesAffected as string[]).map((f, i) => (
                    <li key={i} className="text-xs text-bw-text-secondary font-mono truncate">
                      📄 {f}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {approval.networkDestination && (
              <div>
                <span className="text-xs font-medium text-bw-text-secondary uppercase tracking-wide">Réseau</span>
                <p className="text-xs text-bw-text-secondary mt-1 font-mono">🌐 {approval.networkDestination}</p>
              </div>
            )}
          </div>

          {/* Undo notice */}
          {approval.undoPossible && (
            <p className="text-xs text-bw-success flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" />
              Annulable après exécution
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="p-4 border-t border-bw-border-light dark:border-bw-border-light-dark">
          <div className="grid grid-cols-2 gap-2 mb-2">
            <button
              onClick={() => handleDecision('denied')}
              className="btn btn-danger btn-md"
            >
              <X className="w-4 h-4" />
              Refuser
            </button>
            <button
              onClick={() => handleDecision('approved', 'once')}
              className="btn btn-primary btn-md"
            >
              <Check className="w-4 h-4" />
              Autoriser une fois
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => handleDecision('approved', 'task')}
              className="btn btn-secondary btn-md text-xs"
            >
              Pour cette tâche
            </button>
            {approval.riskLevel !== 'critical' && (
              <button
                onClick={() => {
                  const confirmed = window.confirm(
                    'Toujours autoriser cette action ? Cette permission sera enregistrée.'
                  );
                  if (confirmed) handleDecision('approved', 'always');
                }}
                className="btn btn-ghost btn-md text-xs text-bw-warning"
              >
                Toujours autoriser
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
