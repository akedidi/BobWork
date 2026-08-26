import React from 'react';
import type { AppSettings } from '@bob-work/shared-types';
import { useT } from '../../i18n';

export function Heading({ title, description }: { title: string; description: string }) {
  return (
    <header className="settings-heading">
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  );
}

export function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="settings-card">
      {title && <h2>{title}</h2>}
      {children}
    </section>
  );
}

export function SectionLoader({ label }: { label: string }) {
  return (
    <div className="settings-section-loader" role="status" aria-live="polite">
      <span className="task-spinner" aria-hidden="true" />
      {label}
    </div>
  );
}

export function SettingsFields({
  settings,
  error,
  loadingLabel,
  children,
}: {
  settings: AppSettings | null;
  error: string | null;
  loadingLabel: string;
  children: (settings: AppSettings) => React.ReactNode;
}) {
  if (!settings) {
    return error ? (
      <p className="settings-note" role="alert">
        {error}
      </p>
    ) : (
      <SectionLoader label={loadingLabel} />
    );
  }
  return <>{children(settings)}</>;
}

export function RowText({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <strong>{title}</strong>
      {description && <small>{description}</small>}
    </div>
  );
}

export function ToggleRow({
  title,
  description,
  value,
  onChange,
  disabled,
}: {
  title: string;
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const actionLabel = value ? t('common.disable') : t('common.enable');
  return (
    <div className={`settings-row${disabled ? ' is-disabled' : ''}`} aria-disabled={disabled || undefined}>
      <RowText title={title} description={description} />
      <label className="skill-switch settings-switch" title={actionLabel}>
        <input
          type="checkbox"
          checked={value}
          disabled={disabled}
          aria-label={`${actionLabel} ${title}`}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span aria-hidden="true" />
      </label>
    </div>
  );
}

export function SelectRow({
  title,
  description,
  value,
  onChange,
  children,
}: {
  title: string;
  description?: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="settings-row">
      <RowText title={title} description={description} />
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  );
}

export function NumberRow({
  title,
  value,
  min,
  step,
  onChange,
}: {
  title: string;
  value: number;
  min: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="settings-row">
      <RowText title={title} />
      <input
        className="settings-number"
        type="number"
        value={value}
        min={min}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export function StatusRow({
  title,
  value,
  ok,
  loading,
}: {
  title: string;
  value: string;
  ok?: boolean;
  loading?: boolean;
}) {
  return (
    <div className="settings-row">
      <RowText title={title} />
      {loading ? (
        <span className="settings-row-loader" role="status">
          <span className="task-spinner" aria-hidden="true" />
          {value}
        </span>
      ) : (
        <span className={ok === undefined ? '' : ok ? 'status-ok' : 'status-bad'}>{value}</span>
      )}
    </div>
  );
}
