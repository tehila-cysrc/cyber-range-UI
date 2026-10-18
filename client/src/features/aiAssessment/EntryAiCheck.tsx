import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/Button';
import { TelemetryBadge } from '../../components/TelemetryBadge';
import { ApiError } from '../../lib/apiClient';
import { useCan } from '../../lib/permissions';
import { useToastStore } from '../../stores/toastStore';
import { EntryFeedbackForm } from '../documentation/EntryFeedback';
import { JudgementBadges, LeakGate } from './AiParts';
import { monoLabel, type Tone } from './aiStyles';
import {
  describeAiError,
  useAiStatus,
  useAssessmentDetail,
  useAssessmentList,
  useRequestAssessment,
  type Evidence,
  type LiveDetail,
  type LiveResult,
} from './useAiAssessments';

// "Check with AI" on one timeline entry (simplified instructor UX, 2026-10-18). The agent only reviews
// the WHOLE investigation, so this runs (or reuses, when nothing changed) the team's live review and
// shows the part about this entry. Every entry shares that one review — one model call per state of the
// investigation. Nothing reaches the team until the instructor edits and sends the existing feedback form.

const VERDICT: Record<'on_track' | 'off_track' | 'comment', { label: string; tone: Tone }> = {
  on_track: { label: 'On the right track', tone: 'primary' },
  off_track: { label: 'Off track', tone: 'alert' },
  comment: { label: 'Comment', tone: 'secondary' },
};
const OVERALL: Record<LiveResult['status'], string> = {
  on_track: 'on track',
  partially_on_track: 'partially on track',
  needs_guidance: 'needs guidance',
  insufficient_evidence: 'too early to tell',
};

const linkButton = {
  background: 'none',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--signal-secondary)',
} as const;

const mentions = (evidence: Evidence[], entryId: number) => evidence.some((e) => e.type === 'timeline_entry' && e.id === entryId);

export interface EntryAiCheckProps {
  teamId: number;
  cyberRangeId: number;
  // Live reviews need an active or paused session (server rule); completed ones are assessed from Event Summary.
  sessionStatus: 'active' | 'paused' | 'completed' | string;
  entryId: number;
  onFeedbackSaved: (entry: unknown) => void;
}

export function EntryAiCheck({ teamId, cyberRangeId, sessionStatus, entryId, onFeedbackSaved }: EntryAiCheckProps) {
  const { available } = useAiStatus();
  const [open, setOpen] = useState(false);
  const [runId, setRunId] = useState<number | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const request = useRequestAssessment();
  const { data, error } = useAssessmentList(teamId, cyberRangeId, 'live', open);

  if (!available || (sessionStatus !== 'active' && sessionStatus !== 'paused')) return null;

  const start = (force: boolean) => {
    setOpen(true);
    setStartError(null);
    request.mutate(
      { teamId, cyberRangeId, mode: 'live', force },
      {
        onSuccess: (res) => setRunId(res.assessment.id),
        // Another entry's check (or a colleague) already started the review: follow that one.
        onError: (err) => {
          if (err instanceof ApiError && err.reason === 'assessment_in_progress') setRunId(null);
          else setStartError(err instanceof ApiError ? describeAiError(err.reason) : 'Could not start the AI check.');
        },
      },
    );
  };

  if (!open) {
    return (
      <button type="button" onClick={() => start(false)} style={{ ...linkButton, marginTop: 'var(--space-sm)', marginLeft: 'var(--space-md)' }}>
        Check with AI
      </button>
    );
  }

  const assessments = data?.assessments ?? [];
  const summary = (runId !== null ? assessments.find((a) => a.id === runId) : null) ?? (request.isPending ? null : assessments[0] ?? null);
  const running = request.isPending || !summary || summary.status === 'pending' || summary.status === 'running';

  let body;
  if (startError || error) {
    body = <span style={{ fontSize: 14, color: 'var(--text-primary)' }}>{startError ?? (error instanceof ApiError ? describeAiError(error.reason) : 'Could not load the AI check.')}</span>;
  } else if (running) {
    body = (
      <span role="status" style={{ fontSize: 14, color: 'var(--text-muted)' }}>
        Checking with AI… (usually 20–60 seconds)
      </span>
    );
  } else if (summary.status === 'failed') {
    body = (
      <>
        <span style={{ fontSize: 14, color: 'var(--text-primary)' }}>{describeAiError(summary.errorCode)}</span>
        <div>
          <Button variant="ghost" onClick={() => start(true)} style={{ padding: '4px 12px', fontSize: 14 }}>
            Try again
          </Button>
        </div>
      </>
    );
  } else {
    body = <EntryResult key={summary.id} summary={summary} teamId={teamId} cyberRangeId={cyberRangeId} entryId={entryId} onFeedbackSaved={onFeedbackSaved} onRecheck={() => start(true)} />;
  }

  return (
    <div
      style={{
        marginTop: 'var(--space-sm)',
        border: '1px solid var(--surface-border)',
        borderLeft: '3px solid var(--signal-secondary)',
        borderRadius: 'var(--radius-control)',
        background: 'var(--surface-floor)',
        padding: 'var(--space-sm) var(--space-md)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={monoLabel}>AI check · instructor only</span>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close AI check" style={{ ...linkButton, color: 'var(--text-muted)' }}>
          Close
        </button>
      </div>
      {body}
    </div>
  );
}

function EntryResult({
  summary,
  teamId,
  cyberRangeId,
  entryId,
  onFeedbackSaved,
  onRecheck,
}: {
  summary: Parameters<typeof useAssessmentDetail>[0];
  teamId: number;
  cyberRangeId: number;
  entryId: number;
  onFeedbackSaved: (entry: unknown) => void;
  onRecheck: () => void;
}) {
  const canFeedback = useCan('documentation.feedback');
  const queryClient = useQueryClient();
  const push = useToastStore((s) => s.push);
  const { data, error } = useAssessmentDetail(summary);
  const [reviewed, setReviewed] = useState(false);
  const [editing, setEditing] = useState(false);

  if (error) return <span style={{ fontSize: 14, color: 'var(--text-primary)' }}>Could not load the AI check.</span>;
  if (!data || data.assessment.mode !== 'live' || !data.assessment.result) return <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>Loading…</span>;

  const detail = data.assessment as LiveDetail;
  const r = detail.result!.result;
  const flags = detail.result!.flags;
  const feedback = r.studentSafeFeedback.entryFeedback.find((f) => f.entryId === entryId) ?? null;
  const related = [
    ...r.correctlyIdentified.filter((it) => mentions(it.evidence, entryId)),
    ...r.partiallyUnderstood.filter((it) => mentions(it.evidence, entryId)),
  ];
  const gaps = r.missingOrUnclear.filter((g) => mentions(g.evidence, entryId));
  const points = r.suggestedEntryScores.find((s) => s.entryId === entryId) ?? null;
  const instructionLike = (flags.instructionLikeRecords ?? []).some((x) => x.type === 'timeline_entry' && x.id === entryId);
  const posted = (detail.postedEntryIds ?? []).includes(entryId);
  const blocked = flags.leakSuspected && !reviewed;
  const nothing = !feedback && related.length === 0 && gaps.length === 0 && !points;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {instructionLike && (
        <div role="alert" style={{ fontSize: 14, color: 'var(--signal-alert)' }}>
          This entry contains text addressed to the AI. Check that it did not influence the result.
        </div>
      )}

      {nothing ? (
        <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>The AI had no specific comment on this entry.</span>
      ) : (
        <>
          {feedback && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span>
                <TelemetryBadge tone={VERDICT[feedback.verdict].tone}>{VERDICT[feedback.verdict].label}</TelemetryBadge>
                {posted && (
                  <span style={{ marginLeft: 6 }}>
                    <TelemetryBadge tone="primary">Posted</TelemetryBadge>
                  </span>
                )}
              </span>
              <span style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.5 }}>{feedback.text}</span>
            </div>
          )}
          {related.map((it, i) => (
            <div key={`r${i}`} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, fontSize: 14, color: 'var(--text-primary)' }}>
              <JudgementBadges judgement={it.judgement} unsupported={it.unsupported} />
              <span>{it.concept}</span>
            </div>
          ))}
          {gaps.map((g, i) => (
            <div key={`g${i}`} style={{ fontSize: 14, color: 'var(--text-primary)' }}>
              <TelemetryBadge tone="tertiary">Missing</TelemetryBadge> {g.topic}
            </div>
          ))}
          {points && (
            <span style={{ fontSize: 13, color: 'var(--text-telemetry)' }}>
              Suggested points (not awarded): +{points.points}
            </span>
          )}
        </>
      )}

      <span style={{ fontSize: 13, color: 'var(--text-telemetry)' }}>Team overall: {OVERALL[r.status]}.</span>

      {feedback && canFeedback && !editing && <LeakGate flags={flags} reviewed={reviewed} onReviewed={setReviewed} />}

      {editing && feedback ? (
        <EntryFeedbackForm<unknown>
          cyberRangeId={cyberRangeId}
          entryId={entryId}
          initialVerdict={feedback.verdict}
          initialBody={feedback.text}
          startOpen
          sourceAiAssessmentId={detail.id}
          onCancel={() => setEditing(false)}
          onSaved={(entry) => {
            onFeedbackSaved(entry);
            queryClient.invalidateQueries({ queryKey: ['ai-assessment', detail.id] }); // refresh "Posted"
            push('Feedback sent to the team.', 'success');
            setEditing(false);
          }}
        />
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-md)' }}>
          {feedback && canFeedback && (
            <Button variant="ghost" onClick={() => setEditing(true)} disabled={blocked} style={{ padding: '4px 12px', fontSize: 14, opacity: blocked ? 0.5 : 1 }}>
              {posted ? 'Edit & send again…' : 'Edit & send…'}
            </Button>
          )}
          <Link to={`/instructor/teams/${teamId}?tab=ai&session=${cyberRangeId}`} style={{ fontSize: 14, color: 'var(--signal-secondary)' }}>
            View details
          </Link>
          <button type="button" onClick={onRecheck} style={linkButton} title="Run a new AI review of the whole investigation">
            Check again
          </button>
        </div>
      )}
    </div>
  );
}
