import type { CSSProperties, ReactNode } from 'react';
import { Button } from '../../components/Button';
import { TelemetryBadge } from '../../components/TelemetryBadge';
import { useToastStore } from '../../stores/toastStore';
import { JUDGEMENT, block, monoLabel } from './aiStyles';
import type { Judgement, ValidationFlags } from './useAiAssessments';

// Small building blocks shared by the live and final AI views.

export function Section({ title, children, style }: { title: ReactNode; children: ReactNode; style?: CSSProperties }) {
  return (
    <section style={{ ...block, ...style }}>
      <h3 style={{ ...monoLabel, margin: 0 }}>{title}</h3>
      {children}
    </section>
  );
}

export function JudgementBadges({ judgement, unsupported }: { judgement: Judgement; unsupported: boolean }) {
  return (
    <>
      <TelemetryBadge tone={JUDGEMENT[judgement].tone}>{JUDGEMENT[judgement].label}</TelemetryBadge>
      {unsupported && <TelemetryBadge tone="alert">No verified evidence</TelemetryBadge>}
    </>
  );
}

// A suspected answer leak gates every path toward students (post, copy) until the instructor ticks it.
export function LeakGate({ flags, reviewed, onReviewed }: { flags: ValidationFlags; reviewed: boolean; onReviewed: (v: boolean) => void }) {
  if (!flags.leakSuspected) return null;
  return (
    <div role="alert" style={{ border: '1px solid var(--signal-alert)', borderRadius: 'var(--radius-control)', padding: 'var(--space-sm) var(--space-md)', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 14, color: 'var(--signal-alert)' }}>
        This feedback may reveal part of the answer
        {flags.leakedTechniqueIds.length > 0 ? ` (it mentions ${flags.leakedTechniqueIds.join(', ')}, which the team has not found yet)` : ''}. Read it carefully before
        using any of it.
      </span>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--text-primary)', cursor: 'pointer' }}>
        <input type="checkbox" checked={reviewed} onChange={(e) => onReviewed(e.target.checked)} />
        I've reviewed this feedback
      </label>
    </div>
  );
}

export function CopyButton({ text, disabled }: { text: string; disabled?: boolean }) {
  const push = useToastStore((s) => s.push);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      push('Copied. Nothing was sent to the team.', 'info');
    } catch {
      push('Could not copy. Select the text and copy it by hand.');
    }
  };
  return (
    <Button variant="ghost" onClick={copy} disabled={disabled} style={{ padding: '4px 12px', fontSize: 14, opacity: disabled ? 0.5 : 1 }}>
      Copy
    </Button>
  );
}

export function ResultWarnings({ warnings }: { warnings: { validation: string[]; agent: string[] } | null }) {
  const all = [...(warnings?.validation ?? []), ...(warnings?.agent ?? []).map((w) => `AI: ${w}`)];
  if (all.length === 0) return null;
  return (
    <details style={{ ...block, gap: 0 }}>
      <summary style={{ ...monoLabel, cursor: 'pointer' }}>
        {all.length} {all.length === 1 ? 'warning' : 'warnings'} from checking this result
      </summary>
      <ul style={{ margin: 'var(--space-sm) 0 0', paddingLeft: 18, fontSize: 13, color: 'var(--text-muted)' }}>
        {all.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </details>
  );
}
