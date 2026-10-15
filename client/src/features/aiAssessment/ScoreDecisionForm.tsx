import { useState } from 'react';
import { Button } from '../../components/Button';
import { TelemetryBadge } from '../../components/TelemetryBadge';
import { ApiError } from '../../lib/apiClient';
import { useCan } from '../../lib/permissions';
import { formatEntryTime } from '../documentation/InvestigationPage';
import { monoLabel } from './aiStyles';
import { describeAiError, useDecideAssessment, type FinalDetail } from './useAiAssessments';

// Instructor decision on the AI's recommended final score (plan §F-3, decision 2): approve as-is,
// edit (score + required note) or reject. RECORDED ON THE ASSESSMENT ONLY — it never creates an
// official score and never changes the leaderboard; approved results go to the Excel "AI Assessment"
// sheet. Needs score.award (also enforced by the server).

type Choice = 'approved' | 'edited' | 'rejected';

const fieldStyle = {
  background: 'var(--surface-1)',
  border: '1px solid var(--surface-border)',
  borderRadius: 'var(--radius-control)',
  padding: 8,
  color: 'var(--text-primary)',
  fontFamily: 'inherit',
  fontSize: 14,
} as const;

const DECISION_LABEL: Record<Choice, string> = { approved: 'Approved', edited: 'Approved with an edited score', rejected: 'Rejected' };

export function ScoreDecisionForm({ detail, recommended }: { detail: FinalDetail; recommended: number }) {
  const canDecide = useCan('score.award');
  const decide = useDecideAssessment(detail);
  const [changing, setChanging] = useState(false);
  const [choice, setChoice] = useState<Choice>('approved');
  const [score, setScore] = useState(String(recommended));
  const [note, setNote] = useState('');

  const scoreNum = Number(score);
  const scoreValid = score.trim() !== '' && Number.isInteger(scoreNum) && scoreNum >= 0 && scoreNum <= 100;
  const canSubmit = choice === 'approved' || choice === 'rejected' || (scoreValid && note.trim().length > 0);

  const decided = detail.decision && !changing;
  const disclaimer = (
    <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
      Recorded on this assessment only. It does not change the team's points or the leaderboard. To award points, use Scoring.
    </p>
  );

  if (decided) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <TelemetryBadge tone={detail.decision === 'rejected' ? 'muted' : 'primary'}>{DECISION_LABEL[detail.decision!]}</TelemetryBadge>
          {detail.decidedScore != null && (
            <span className="tabular" style={{ fontSize: 16, color: 'var(--text-primary)' }}>
              {detail.decidedScore}/100
            </span>
          )}
          <span style={{ fontSize: 13, color: 'var(--text-telemetry)' }}>
            by {detail.decidedBy ?? 'unknown'}
            {detail.decidedAt ? ` · ${formatEntryTime(detail.decidedAt)}` : ''}
          </span>
        </div>
        {detail.decisionNote && <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>“{detail.decisionNote}”</div>}
        {disclaimer}
        {canDecide && (
          <div>
            <Button variant="ghost" onClick={() => setChanging(true)} style={{ padding: '4px 12px', fontSize: 14 }}>
              Change decision…
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (!canDecide) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>No decision recorded yet. Your account can't record score decisions.</span>
        {disclaimer}
      </div>
    );
  }

  const submit = () =>
    decide.mutate(
      {
        decision: choice,
        ...(choice === 'edited' ? { score: scoreNum } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(detail.decision ? { override: true } : {}),
      },
      { onSuccess: () => setChanging(false) },
    );

  const options: { key: Choice; label: string }[] = [
    { key: 'approved', label: `Approve ${recommended}/100` },
    { key: 'edited', label: 'Edit the score' },
    { key: 'rejected', label: 'Reject' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
      {detail.decision && (
        <span style={{ fontSize: 13, color: 'var(--text-telemetry)' }}>
          Changing the recorded decision ({DECISION_LABEL[detail.decision]}{detail.decidedScore != null ? `, ${detail.decidedScore}/100` : ''}). The previous decision stays in the audit log.
        </span>
      )}
      <div role="radiogroup" aria-label="Score decision" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={choice === o.key}
            onClick={() => setChoice(o.key)}
            style={{
              fontFamily: 'inherit',
              fontSize: 13,
              padding: '3px 12px',
              borderRadius: 999,
              cursor: 'pointer',
              border: `1px solid ${choice === o.key ? 'var(--signal-primary)' : 'var(--surface-border)'}`,
              background: choice === o.key ? 'var(--surface-floor)' : 'transparent',
              color: choice === o.key ? 'var(--text-primary)' : 'var(--text-muted)',
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
      {choice === 'edited' && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--text-primary)' }}>
          <span style={monoLabel}>Score</span>
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={score}
            onChange={(e) => setScore(e.target.value)}
            aria-label="Edited score out of 100"
            aria-invalid={!scoreValid}
            style={{ ...fieldStyle, width: 80 }}
          />
          <span style={{ color: 'var(--text-muted)' }}>/ 100</span>
        </label>
      )}
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={1000}
        aria-label="Decision note"
        placeholder={choice === 'edited' ? 'Required: why the score differs from the AI recommendation' : 'Optional note'}
        style={{ ...fieldStyle, resize: 'vertical' }}
      />
      {decide.isError && (
        <div role="alert" style={{ color: 'var(--signal-alert)', fontSize: 13 }}>
          {decide.error instanceof ApiError && decide.error.reason ? describeAiError(decide.error.reason) : 'Could not record the decision.'}
        </div>
      )}
      {disclaimer}
      <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
        <Button onClick={submit} disabled={!canSubmit || decide.isPending} style={{ opacity: !canSubmit || decide.isPending ? 0.5 : 1 }}>
          {decide.isPending ? 'Saving…' : 'Record decision'}
        </Button>
        {changing && (
          <Button variant="ghost" onClick={() => setChanging(false)} disabled={decide.isPending}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
