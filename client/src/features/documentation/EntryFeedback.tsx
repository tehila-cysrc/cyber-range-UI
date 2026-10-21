import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { useCan } from '../../lib/permissions';
import { Button } from '../../components/Button';

// Instructor feedback on a Timeline entry (server: documentationFeedback.service.ts). The feedback
// itself is unscored; on a staff team view the same form can also award points to the entry
// (POST /admin/scores, like the Scoring tab) so the instructor doesn't switch tabs (2026-10-21).
export type FeedbackVerdict = 'on_track' | 'off_track' | 'comment';

export interface EntryFeedbackItem {
  id: number;
  verdict: FeedbackVerdict;
  body: string | null;
  authorName: string | null;
  createdAt: string;
}

const VERDICTS: { key: FeedbackVerdict; label: string; color: string }[] = [
  { key: 'on_track', label: 'On track', color: 'var(--signal-primary)' },
  { key: 'off_track', label: 'Off track', color: 'var(--signal-tertiary)' },
  { key: 'comment', label: 'Comment', color: 'var(--signal-secondary)' },
];
const verdictOf = (key: FeedbackVerdict) => VERDICTS.find((v) => v.key === key) ?? VERDICTS[2];

const MAX_FEEDBACK_LENGTH = 1000;
const MAX_POINTS = 1000; // server: MAX_POINTS_PER_AWARD

// Staff view of one team: lets the form award points along with the feedback.
export interface EntryScoring {
  teamId: number;
  studentUserId?: number; // the entry's author, as the Scoring tab credits it
  initialPoints?: number; // e.g. the AI's suggested score
}

const smallLinkStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

export function EntryFeedbackList({
  feedback,
  onDelete,
  deletingId,
}: {
  feedback: EntryFeedbackItem[];
  onDelete?: (id: number) => void;
  deletingId?: number | null;
}) {
  if (feedback.length === 0) return null;
  return (
    <div style={{ marginTop: 'var(--space-sm)', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {feedback.map((f) => {
        const v = verdictOf(f.verdict);
        return (
          <div
            key={f.id}
            style={{
              borderLeft: `3px solid ${v.color}`,
              background: 'var(--surface-floor)',
              borderRadius: 'var(--radius-control)',
              padding: '6px 10px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 8,
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                color: 'var(--text-telemetry)',
              }}
            >
              <span>
                <span style={{ color: v.color, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {f.verdict === 'comment' ? 'Instructor feedback' : v.label}
                </span>
                {f.authorName ? ` · ${f.authorName}` : ''}
              </span>
              {onDelete && (
                <button
                  type="button"
                  onClick={() => onDelete(f.id)}
                  disabled={deletingId === f.id}
                  style={{ ...smallLinkStyle, color: 'var(--text-muted)' }}
                  aria-label="Remove feedback"
                >
                  {deletingId === f.id ? 'Removing…' : 'Remove'}
                </button>
              )}
            </div>
            {f.body && (
              <div className="prose-pre" style={{ color: 'var(--text-primary)', fontSize: 14, marginTop: 2 }}>
                {f.body}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Instructor-only: "+ Feedback" opens an inline form — pick on/off track (text optional) or write a
// plain comment. The AI review's "Post as feedback" opens it pre-filled (initialVerdict/initialBody,
// startOpen); the text stays editable and nothing is sent until the instructor clicks Send.
export function EntryFeedbackForm<TEntry>({
  cyberRangeId,
  entryId,
  onSaved,
  initialVerdict = 'comment',
  initialBody = '',
  startOpen = false,
  onCancel,
  sourceAiAssessmentId,
  scoring,
}: {
  cyberRangeId: number;
  entryId: number;
  onSaved: (entry: TEntry) => void;
  initialVerdict?: FeedbackVerdict;
  initialBody?: string;
  startOpen?: boolean;
  onCancel?: () => void;
  // Set by the AI review's "Post as feedback": links the saved feedback to that assessment so the
  // "Posted" marker is based on feedback that really exists (decision I). Never shown to students.
  sourceAiAssessmentId?: number;
  scoring?: EntryScoring;
}) {
  const queryClient = useQueryClient();
  const canAward = useCan('score.award') && !!scoring;
  const [open, setOpen] = useState(startOpen);
  const [verdict, setVerdict] = useState<FeedbackVerdict>(initialVerdict);
  const [body, setBody] = useState(initialBody.slice(0, MAX_FEEDBACK_LENGTH));
  const [points, setPoints] = useState(scoring?.initialPoints ? String(scoring.initialPoints) : '');
  // Feedback that already went out while the award failed: a retry sends only the points.
  const [sent, setSent] = useState<TEntry | null>(null);

  // Same query as the Scoring tab, so points already given there show here too.
  const { data: awarded } = useQuery({
    enabled: canAward && open,
    queryKey: ['admin-scores', scoring?.teamId],
    queryFn: () => apiFetch<{ entries: { points: number; documentationEntryId: number | null }[] }>(`/admin/scores?teamId=${scoring!.teamId}`),
  });
  const alreadyAwarded = (awarded?.entries ?? []).filter((x) => x.documentationEntryId === entryId).map((x) => x.points);

  const award = canAward && points.trim() !== '' ? Number(points) : 0;
  const pointsValid = award === 0 || (Number.isInteger(award) && Math.abs(award) <= MAX_POINTS);

  const close = () => {
    setOpen(false);
    setBody('');
    setVerdict('comment');
    setPoints('');
    setSent(null);
  };

  const save = useMutation({
    mutationFn: async () => {
      let entry = sent;
      if (!entry) {
        entry = (
          await apiFetch<{ entry: TEntry }>(`/cyber-ranges/${cyberRangeId}/documentation/${entryId}/feedback`, {
            method: 'POST',
            body: JSON.stringify({ verdict, body: body.trim() || undefined, ...(sourceAiAssessmentId ? { sourceAiAssessmentId } : {}) }),
          })
        ).entry;
        setSent(entry);
      }
      if (award !== 0) {
        await apiFetch('/admin/scores', {
          method: 'POST',
          body: JSON.stringify({
            teamId: scoring!.teamId,
            studentUserId: scoring!.studentUserId,
            documentationEntryId: entryId,
            cyberRangeId,
            points: award,
            note: body.trim().slice(0, 500) || undefined, // shown to the students with the points
          }),
        });
        queryClient.invalidateQueries({ queryKey: ['admin-scores'] });
      }
      return entry;
    },
    onSuccess: (entry) => {
      onSaved(entry);
      close();
    },
  });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          save.reset();
          setOpen(true);
        }}
        style={{ ...smallLinkStyle, color: 'var(--signal-secondary)', marginTop: 'var(--space-sm)' }}
      >
        + Feedback
      </button>
    );
  }

  const canSend = (verdict !== 'comment' || body.trim().length > 0) && pointsValid;
  return (
    <div style={{ marginTop: 'var(--space-sm)', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div role="radiogroup" aria-label="Feedback type" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {VERDICTS.map((v) => (
          <button
            key={v.key}
            type="button"
            role="radio"
            aria-checked={verdict === v.key}
            onClick={() => setVerdict(v.key)}
            style={{
              fontFamily: 'inherit',
              fontSize: 13,
              padding: '3px 10px',
              borderRadius: 999,
              cursor: 'pointer',
              border: `1px solid ${verdict === v.key ? v.color : 'var(--surface-border)'}`,
              background: verdict === v.key ? 'var(--surface-floor)' : 'transparent',
              color: verdict === v.key ? v.color : 'var(--text-muted)',
            }}
          >
            {v.label}
          </button>
        ))}
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={initialBody ? 5 : 2}
        maxLength={MAX_FEEDBACK_LENGTH}
        aria-label="Feedback text"
        placeholder={verdict === 'comment' ? 'Feedback for the team' : 'Optional — e.g. what to look at instead'}
        style={{
          background: 'transparent',
          border: '1px solid var(--surface-border)',
          borderRadius: 'var(--radius-control)',
          padding: 8,
          color: 'var(--text-primary)',
          resize: 'vertical',
          fontFamily: 'inherit',
          fontSize: 14,
        }}
      />
      {canAward && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-sm)', fontSize: 13, color: 'var(--text-muted)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Points
            <input
              type="number"
              step={1}
              min={-MAX_POINTS}
              max={MAX_POINTS}
              value={points}
              onChange={(e) => setPoints(e.target.value)}
              placeholder="0"
              aria-invalid={!pointsValid}
              style={{
                width: 72,
                background: 'transparent',
                border: '1px solid var(--surface-border)',
                borderRadius: 'var(--radius-control)',
                padding: '4px 8px',
                color: 'var(--text-primary)',
                fontSize: 14,
              }}
            />
          </label>
          <span>{award === 0 ? 'Empty or 0 = no points.' : 'Awarded when you send.'}</span>
          {alreadyAwarded.length > 0 && (
            <span style={{ color: 'var(--signal-primary)' }}>
              Already awarded: {alreadyAwarded.map((p) => `${p > 0 ? '+' : ''}${p}`).join(', ')}
            </span>
          )}
          {!pointsValid && <span style={{ color: 'var(--signal-alert)' }}>Whole number between -{MAX_POINTS} and {MAX_POINTS}.</span>}
        </div>
      )}
      {save.isError && (
        <div role="alert" style={{ color: 'var(--signal-alert)', fontSize: 13 }}>
          {sent
            ? `Feedback sent, but the points were not awarded: ${save.error instanceof ApiError ? save.error.message : 'request failed'}. Send again to retry the points only.`
            : save.error instanceof ApiError
              ? save.error.message
              : 'Could not send the feedback.'}
        </div>
      )}
      <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
        <Button type="button" onClick={() => save.mutate()} disabled={!canSend || save.isPending}>
          {save.isPending ? 'Sending…' : sent ? 'Award points' : award !== 0 ? `Send feedback & award ${award > 0 ? '+' : ''}${award}` : 'Send feedback'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            // Feedback already saved (only the award failed): show it under the entry before closing.
            if (sent) {
              onSaved(sent);
              close();
            } else if (onCancel) onCancel();
            else setOpen(false);
          }}
          disabled={save.isPending}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

