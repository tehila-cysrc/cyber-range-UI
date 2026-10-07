import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { Button } from '../../components/Button';

// Instructor feedback on a Timeline entry (server: documentationFeedback.service.ts). Unscored — the
// team just sees it under the entry; points still go through Scoring.
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
// plain comment.
export function EntryFeedbackForm<TEntry>({
  cyberRangeId,
  entryId,
  onSaved,
}: {
  cyberRangeId: number;
  entryId: number;
  onSaved: (entry: TEntry) => void;
}) {
  const [open, setOpen] = useState(false);
  const [verdict, setVerdict] = useState<FeedbackVerdict>('comment');
  const [body, setBody] = useState('');

  const save = useMutation({
    mutationFn: () =>
      apiFetch<{ entry: TEntry }>(`/cyber-ranges/${cyberRangeId}/documentation/${entryId}/feedback`, {
        method: 'POST',
        body: JSON.stringify({ verdict, body: body.trim() || undefined }),
      }),
    onSuccess: ({ entry }) => {
      onSaved(entry);
      setOpen(false);
      setBody('');
      setVerdict('comment');
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

  const canSend = verdict !== 'comment' || body.trim().length > 0;
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
        rows={2}
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
      {save.isError && (
        <div role="alert" style={{ color: 'var(--signal-alert)', fontSize: 13 }}>
          {save.error instanceof ApiError ? save.error.message : 'Could not send the feedback.'}
        </div>
      )}
      <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
        <Button type="button" onClick={() => save.mutate()} disabled={!canSend || save.isPending}>
          {save.isPending ? 'Sending…' : 'Send feedback'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={save.isPending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

