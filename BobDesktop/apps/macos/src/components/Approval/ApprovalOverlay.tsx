// ============================================================
// Bob Work - Approval Overlay
// High-contrast risk-aware approval card
// ============================================================

import { useState } from 'react';
import { X, Check, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { Approval } from '@bob-work/shared-types';
import { resolveApproval } from '../../lib/ipc';
import { useAppStore } from '../../stores/appStore';
import { errorMessage } from '../../lib/errorMessage';
import { useT } from '../../i18n';
import { useAppDialog } from '../AppDialog';

interface ApprovalOverlayProps {
  approval: Approval;
}

export function ApprovalOverlay({ approval }: ApprovalOverlayProps) {
  const { removeApproval } = useAppStore();
  const t = useT();
  const dialog = useAppDialog();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lastAttempt, setLastAttempt] = useState<{ decision: string; duration?: string } | null>(null);
  const riskKey = (['low', 'medium', 'high', 'critical'].includes(approval.riskLevel)
    ? approval.riskLevel
    : 'medium') as 'low' | 'medium' | 'high' | 'critical';
  const riskLabelKey = {
    low: 'approval.riskLow',
    medium: 'approval.riskMedium',
    high: 'approval.riskHigh',
    critical: 'approval.riskCritical',
  }[riskKey] as 'approval.riskLow' | 'approval.riskMedium' | 'approval.riskHigh' | 'approval.riskCritical';
  const riskLabel = t(riskLabelKey);
  const RiskIcon = riskKey === 'low' ? ShieldCheck : ShieldAlert;

  const handleDecision = async (decision: string, duration?: string) => {
    setBusy(true);
    setError('');
    setLastAttempt({ decision, duration });
    try {
      await resolveApproval(approval.id, { decision, permissionDuration: duration });
      removeApproval(approval.id);
    } catch (err) {
      setError(errorMessage(err, t('approval.resolveFailed')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="approval-overlay">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-title"
        className={`approval-card approval-card--${riskKey}`}
      >
        <header className="approval-header">
          <div className="approval-header-title">
            <RiskIcon className="approval-risk-icon" aria-hidden="true" />
            <span id="approval-title">{t('approval.title')}</span>
          </div>
          <span className="approval-risk-badge">{t('approval.risk', { level: riskLabel })}</span>
        </header>

        <div className="approval-body">
          <p className="approval-description">{approval.humanDescription}</p>

          {approval.commandOrChange && (
            <div className="approval-block">
              <div className="approval-label">{t('approval.action')}</div>
              <pre className="approval-code">{approval.commandOrChange}</pre>
            </div>
          )}

          {Array.isArray(approval.filesAffected) && approval.filesAffected.length > 0 && (
            <div className="approval-block">
              <div className="approval-label">{t('approval.files')}</div>
              <ul className="approval-file-list">
                {(approval.filesAffected as string[]).map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
          )}

          {approval.networkDestination && (
            <div className="approval-block">
              <div className="approval-label">{t('approval.network')}</div>
              <p className="approval-mono">{approval.networkDestination}</p>
            </div>
          )}

          {approval.undoPossible && (
            <p className="approval-undo">
              <ShieldCheck aria-hidden="true" />
              {t('approval.undoable')}
            </p>
          )}

          {error && (
            <div role="alert" className="approval-error">
              {error}
              <div className="approval-error-actions">
                <button
                  type="button"
                  className="secondary-btn compact"
                  disabled={busy}
                  onClick={() => {
                    if (lastAttempt) void handleDecision(lastAttempt.decision, lastAttempt.duration)
                    else setError('')
                  }}
                >
                  {t('approval.retry')}
                </button>
                <button type="button" className="secondary-btn compact" onClick={() => removeApproval(approval.id)}>
                  {t('approval.close')}
                </button>
              </div>
            </div>
          )}
        </div>

        <footer className="approval-footer">
          <div className="approval-actions-primary">
            <button
              type="button"
              className="approval-btn approval-btn-deny"
              disabled={busy}
              onClick={() => void handleDecision('denied')}
            >
              <X aria-hidden="true" />
              {t('approval.deny')}
            </button>
            <button
              type="button"
              className="approval-btn approval-btn-allow"
              disabled={busy}
              onClick={() => void handleDecision('approved', 'once')}
            >
              <Check aria-hidden="true" />
              {t('approval.allowOnce')}
            </button>
          </div>
          <div className="approval-actions-secondary">
            <button
              type="button"
              className="approval-btn approval-btn-quiet"
              disabled={busy}
              onClick={() => void handleDecision('approved', 'task')}
            >
              {t('approval.allowTask')}
            </button>
            {riskKey !== 'critical' && (
              <button
                type="button"
                className="approval-btn approval-btn-quiet approval-btn-always"
                disabled={busy}
                onClick={async () => {
                  const confirmed = await dialog.confirm({
                    message: t('approval.allowAlwaysConfirm'),
                    confirmLabel: t('approval.allowAlways'),
                  });
                  if (confirmed) void handleDecision('approved', 'always');
                }}
              >
                {t('approval.allowAlways')}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
