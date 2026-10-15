import type { CSSProperties } from 'react';
import type { Judgement } from './useAiAssessments';

// Section heading style shared by the AI review components (same as the Scenarios page's monoLabel).
export const monoLabel: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--text-telemetry)',
};

export const block: CSSProperties = {
  border: '1px solid var(--surface-border)',
  borderRadius: 'var(--radius-container)',
  background: 'var(--surface-1)',
  padding: 'var(--space-md)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-sm)',
};

export type Tone = 'primary' | 'secondary' | 'tertiary' | 'alert' | 'muted';

export const JUDGEMENT: Record<Judgement, { label: string; tone: Tone }> = {
  correct: { label: 'Correct', tone: 'primary' },
  partial: { label: 'Partial', tone: 'secondary' },
  incorrect: { label: 'Incorrect', tone: 'alert' },
  not_documented: { label: 'Not documented', tone: 'muted' },
  insufficient_information: { label: 'Not enough info', tone: 'muted' },
};
