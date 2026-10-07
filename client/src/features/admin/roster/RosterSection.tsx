import type { FormEvent, ReactNode } from 'react';
import { Button } from '../../../components/Button';
import { linkButtonStyle } from './rosterData';

// Shared frame for the Roster's section views (Organizations / Students / Instructors), so every
// section reads the same: a title with a count line, the "New …" card when its "+" was pressed,
// then the section's content.
export function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h1 style={{ fontSize: 22, color: 'var(--text-primary)', margin: 0 }}>{title}</h1>
      <div className="tabular" style={{ fontSize: 13, color: 'var(--text-telemetry)', marginTop: 4 }}>{subtitle}</div>
    </div>
  );
}

export function AddCard({
  title,
  submitLabel,
  pending,
  error,
  onSubmit,
  onClose,
  children,
}: {
  title: string;
  submitLabel: string;
  pending: boolean;
  error: string | null;
  onSubmit: (e: FormEvent) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <form
      onSubmit={onSubmit}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-sm)',
        maxWidth: 520,
        padding: 'var(--space-md)',
        border: '1px solid var(--surface-border)',
        borderInlineStart: '2px solid var(--signal-primary)',
        borderRadius: 'var(--radius-container)',
        background: 'var(--surface-1)',
      }}
    >
      <h2 style={{ fontSize: 15, color: 'var(--text-primary)', margin: 0 }}>{title}</h2>
      {children}
      {error && <div style={{ color: 'var(--signal-alert)', fontSize: 14 }}>{error}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button type="submit" variant="ghost" disabled={pending}>{submitLabel}</Button>
        <button type="button" onClick={onClose} style={linkButtonStyle}>cancel</button>
      </div>
    </form>
  );
}

export function SectionView({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', minWidth: 0 }}>{children}</div>;
}
