import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/Button';
import { TelemetryBadge } from '../../components/TelemetryBadge';
import { confirmAction } from '../../components/ConfirmDialog';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { FinalAssessmentView } from './FinalAssessmentView';
import { monoLabel } from './aiStyles';
import {
  describeAiError,
  finalOverviewKey,
  useAssessmentDetail,
  useFinalOverview,
  type AssessmentSummary,
  type FinalDetail,
  type FinalOverviewRow,
} from './useAiAssessments';

// Event Summary "AI Assessment" (simplified instructor UX, 2026-10-19): final assessments for every team
// session in the caller's scope, generated in batches. Orchestrated HERE, one existing
// POST /admin/ai-assessments per session (scope, audit, pinned version, reuse and limits all server-side),
// at most 3 in flight; ai_busy waits and retries, the hourly limit stops the batch. Rows whose final already
// covers the current work are not requested again. Nothing is approved or sent to students: every result
// waits for the instructor's decision. Closing the page stops what has not started yet.

const MAX_IN_FLIGHT = 3;
const POLL_MS = 3000;
const BUSY_RETRY_MS = 15000;

// detached = started, then the batch stopped watching it; the server finishes it and the row updates.
type ItemState = 'waiting' | 'running' | 'done' | 'reused' | 'failed' | 'not_started' | 'detached';
interface BatchItem {
  key: string;
  teamId: number;
  cyberRangeId: number;
  state: ItemState;
  message: string | null;
}

const keyOf = (r: { teamId: number; cyberRangeId: number }) => `${r.teamId}:${r.cyberRangeId}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const isRunning = (a: AssessmentSummary | null) => !!a && (a.status === 'pending' || a.status === 'running');

// A row is selectable when a request could produce something new.
function selectable(r: FinalOverviewRow) {
  return !r.blockedReason && !isRunning(r.latestFinal) && !r.upToDate;
}

function rowStatus(r: FinalOverviewRow): { text: string; tone: 'primary' | 'secondary' | 'tertiary' | 'alert' | 'muted' } {
  const a = r.latestFinal;
  if (r.blockedReason) return { text: describeAiError(r.blockedReason), tone: 'muted' };
  if (isRunning(a)) return { text: 'Generating…', tone: 'secondary' };
  if (!a) return { text: 'Not assessed', tone: 'muted' };
  if (a.status === 'failed') return { text: `Last attempt failed: ${describeAiError(a.errorCode)}`, tone: 'alert' };
  const stale = r.upToDate ? '' : ' · new activity since';
  if (a.decision === 'approved') return { text: `Approved ${a.decidedScore ?? a.recommendedTotal}/100${stale}`, tone: 'primary' };
  if (a.decision === 'edited') return { text: `Approved (edited) ${a.decidedScore}/100${stale}`, tone: 'primary' };
  if (a.decision === 'rejected') return { text: `Rejected${stale}`, tone: 'muted' };
  return { text: `Waiting for your review · AI ${a.recommendedTotal}/100${stale}`, tone: 'tertiary' };
}

async function waitForFinal(teamId: number, cyberRangeId: number, id: number | null, stopped: () => boolean): Promise<AssessmentSummary | null> {
  for (;;) {
    if (stopped()) return null;
    await sleep(POLL_MS);
    const { assessments } = await apiFetch<{ assessments: AssessmentSummary[] }>(`/admin/ai-assessments?teamId=${teamId}&cyberRangeId=${cyberRangeId}&mode=final`);
    const a = id !== null ? assessments.find((x) => x.id === id) : assessments[0];
    if (!a) return null;
    if (!isRunning(a)) return a;
  }
}

export function AiBatchDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [items, setItems] = useState<BatchItem[] | null>(null);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const stopRef = useRef(false);
  const active = !!items && items.some((i) => i.state === 'waiting' || i.state === 'running');
  const { data, error } = useFinalOverview(true, active);

  const rows = data?.rows ?? [];
  // Default selection, once: everything that would produce a new result.
  const chosen = selected ?? new Set(rows.filter(selectable).map(keyOf));

  // Leaving the page stops the batch (not yet started requests are never sent).
  useEffect(() => {
    if (!active) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);
  useEffect(
    () => () => {
      stopRef.current = true;
    },
    [],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !active) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active, onClose]);

  const update = (key: string, patch: Partial<BatchItem>) => setItems((cur) => cur && cur.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  async function runBatch(batch: BatchItem[]) {
    stopRef.current = false;
    const queue = [...batch];
    let limitReached = false;
    const stopped = () => stopRef.current;

    const worker = async () => {
      for (;;) {
        if (stopped() || limitReached) return;
        const item = queue.shift();
        if (!item) return;
        update(item.key, { state: 'running', message: null });
        try {
          const res = await apiFetch<{ assessment: AssessmentSummary; reused: boolean }>('/admin/ai-assessments', {
            method: 'POST',
            body: JSON.stringify({ teamId: item.teamId, cyberRangeId: item.cyberRangeId, mode: 'final' }),
          });
          if (res.reused) {
            update(item.key, { state: 'reused', message: 'Nothing changed — the earlier result was kept (no new AI call).' });
          } else {
            const final = await waitForFinal(item.teamId, item.cyberRangeId, res.assessment.id, stopped);
            if (!final) update(item.key, { state: 'detached', message: 'Still generating on the server — it will appear when done.' });
            else if (final.status === 'succeeded') update(item.key, { state: 'done', message: null });
            else update(item.key, { state: 'failed', message: describeAiError(final.errorCode) });
          }
        } catch (err) {
          const reason = err instanceof ApiError ? err.reason : null;
          if (reason === 'ai_busy') {
            // The server runs at most a few reviews at once (for everyone): wait, then try this one again.
            update(item.key, { state: 'waiting', message: 'The AI assistant is busy — retrying shortly.' });
            queue.unshift(item);
            await sleep(BUSY_RETRY_MS);
          } else if (reason === 'rate_limited') {
            limitReached = true;
            queue.unshift(item);
          } else if (reason === 'assessment_in_progress') {
            update(item.key, { message: 'Already being generated (started elsewhere).' });
            const final = await waitForFinal(item.teamId, item.cyberRangeId, null, stopped);
            update(
              item.key,
              !final ? { state: 'detached', message: 'Still generating on the server.' } : final.status === 'succeeded' ? { state: 'done', message: null } : { state: 'failed', message: describeAiError(final.errorCode) },
            );
          } else {
            update(item.key, { state: 'failed', message: reason ? describeAiError(reason) : 'Could not start the AI assessment.' });
          }
        }
        queryClient.invalidateQueries({ queryKey: finalOverviewKey });
      }
    };

    await Promise.all(Array.from({ length: Math.min(MAX_IN_FLIGHT, batch.length) }, worker));
    const leftover = new Set(queue.map((i) => i.key));
    if (leftover.size > 0) {
      const message = limitReached ? 'Not started: you reached the hourly limit of AI assessments. Run the rest later.' : 'Not started: the batch was stopped.';
      setItems((cur) => cur && cur.map((i) => (leftover.has(i.key) ? { ...i, state: 'not_started', message } : i)));
    }
    queryClient.invalidateQueries({ queryKey: finalOverviewKey });
  }

  async function start() {
    const picked = rows.filter((r) => chosen.has(keyOf(r)) && selectable(r));
    if (picked.length === 0) return;
    const stillRunning = picked.filter((r) => r.sessionStatus === 'active').length;
    const left = data ? Math.max(0, data.rateLimit.perHour - data.rateLimit.usedLastHour) : null;
    const lines = [
      `${picked.length} final assessment${picked.length === 1 ? '' : 's'} will be generated, up to ${MAX_IN_FLIGHT} at a time (usually 30–90 seconds each).`,
      stillRunning > 0
        ? `${stillRunning} ${stillRunning === 1 ? 'scenario is' : 'scenarios are'} still running: the assessment covers only what the team has documented so far.`
        : null,
      left !== null && picked.length > left
        ? `This may exceed your hourly limit: ${left} of ${data!.rateLimit.perHour} AI assessments left this hour. The batch stops at the limit; run the rest later.`
        : null,
      'Results wait for your review. Nothing is approved or sent to students automatically.',
    ].filter(Boolean);
    const ok = await confirmAction({ title: 'Generate AI final assessments?', message: lines.join(' '), confirmLabel: `Generate ${picked.length}` });
    if (!ok) return;
    const batch = picked.map((r) => ({ key: keyOf(r), teamId: r.teamId, cyberRangeId: r.cyberRangeId, state: 'waiting' as const, message: null }));
    setItems(batch);
    void runBatch(batch);
  }

  const counts = items
    ? {
        total: items.length,
        finished: items.filter((i) => i.state === 'done' || i.state === 'reused').length,
        running: items.filter((i) => i.state === 'running').length,
        waiting: items.filter((i) => i.state === 'waiting').length,
        failed: items.filter((i) => i.state === 'failed').length,
        notStarted: items.filter((i) => i.state === 'not_started').length,
        detached: items.filter((i) => i.state === 'detached').length,
      }
    : null;
  const itemOf = new Map((items ?? []).map((i) => [i.key, i]));
  const toggle = (key: string) =>
    setSelected(() => {
      const next = new Set(chosen);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const selectableRows = rows.filter(selectable);
  const pickedCount = selectableRows.filter((r) => chosen.has(keyOf(r))).length;

  return (
    <div
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !active) onClose();
      }}
      style={{ position: 'fixed', inset: 0, background: 'var(--overlay-backdrop)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 16, zIndex: 1900, overflowY: 'auto' }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-batch-title"
        style={{
          width: 'min(1040px, 100%)',
          background: 'var(--surface-1)',
          border: '1px solid var(--surface-border-strong)',
          borderRadius: 'var(--radius-container)',
          boxShadow: '0 12px 40px rgba(0, 0, 0, 0.5)',
          padding: 'var(--space-lg)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-md)',
          margin: '24px 0',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-md)' }}>
          <h2 id="ai-batch-title" style={{ fontSize: 20, margin: 0, color: 'var(--text-primary)' }}>
            AI final assessments
          </h2>
          <Button variant="ghost" onClick={onClose} disabled={active} title={active ? 'Stop the batch first' : undefined} style={{ padding: '4px 12px', fontSize: 14, opacity: active ? 0.5 : 1 }}>
            Close
          </Button>
        </div>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)' }}>
          The AI compares each team's whole investigation with the scenario's reference document and recommends a score out of 100. It is a
          recommendation only: official points and the leaderboard never change, and nothing is approved or sent to students until you do it.
        </p>

        {error && <div role="alert" style={{ color: 'var(--signal-alert)', fontSize: 14 }}>{error instanceof ApiError && error.reason ? describeAiError(error.reason) : 'Could not load the teams.'}</div>}
        {!data && !error && <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Loading…</div>}
        {data && rows.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>No team has started a scenario you can assess yet.</div>}

        {counts && (
          <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ height: 6, background: 'var(--surface-floor)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${(100 * (counts.finished + counts.failed + counts.notStarted + counts.detached)) / counts.total}%`, height: '100%', background: 'var(--signal-primary)', transition: 'width 300ms ease' }} />
            </div>
            <div className="tabular" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 14, color: 'var(--text-primary)' }}>
              <span>
                {counts.finished} of {counts.total} done
              </span>
              {counts.running > 0 && <span style={{ color: 'var(--signal-secondary)' }}>{counts.running} generating</span>}
              {counts.waiting > 0 && <span style={{ color: 'var(--text-muted)' }}>{counts.waiting} waiting</span>}
              {counts.failed > 0 && <span style={{ color: 'var(--signal-alert)' }}>{counts.failed} failed</span>}
              {counts.notStarted > 0 && <span style={{ color: 'var(--signal-tertiary)' }}>{counts.notStarted} not started</span>}
              {counts.detached > 0 && <span style={{ color: 'var(--text-muted)' }}>{counts.detached} still generating on the server</span>}
              {active && (
                <button
                  type="button"
                  onClick={() => {
                    stopRef.current = true;
                  }}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--signal-alert)', fontSize: 14 }}
                >
                  Stop after the running ones
                </button>
              )}
            </div>
          </div>
        )}

        {rows.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-container)' }}>
            {rows.map((r, idx) => {
              const key = keyOf(r);
              const st = rowStatus(r);
              const item = itemOf.get(key);
              const canPick = selectable(r) && !active;
              const reviewable = r.latestFinal?.status === 'succeeded' && !isRunning(r.latestFinal);
              return (
                <div key={key} style={{ borderTop: idx === 0 ? 'none' : '1px solid var(--surface-border)', padding: 'var(--space-sm) var(--space-md)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-md)' }}>
                    <input
                      type="checkbox"
                      aria-label={`Generate for ${r.teamName} — ${r.scenarioName}`}
                      checked={selectable(r) && chosen.has(key)}
                      disabled={!canPick}
                      onChange={() => toggle(key)}
                      title={r.upToDate ? 'Up to date — the current result already covers this work' : undefined}
                    />
                    <span style={{ minWidth: 180, flex: '1 1 180px' }}>
                      <span style={{ fontSize: 15, color: 'var(--text-primary)' }}>{r.teamName}</span>
                      {r.organizationName && <span style={{ fontSize: 13, color: 'var(--text-telemetry)' }}> · {r.organizationName}</span>}
                      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                        {r.scenarioName} · {r.sessionStatus === 'active' ? 'running' : r.sessionStatus}
                      </div>
                    </span>
                    <span style={{ flex: '2 1 260px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {item && item.state !== 'done' && item.state !== 'reused' ? (
                        <span style={{ fontSize: 14, color: item.state === 'failed' ? 'var(--signal-alert)' : 'var(--text-primary)' }}>
                          {item.state === 'waiting' ? 'Waiting…' : item.state === 'running' || item.state === 'detached' ? 'Generating…' : item.state === 'failed' ? 'Failed' : 'Not started'}
                          {item.message ? ` — ${item.message}` : ''}
                        </span>
                      ) : (
                        // Short states as a badge; reasons and errors (long sentences) as plain text.
                        r.blockedReason || r.latestFinal?.status === 'failed' ? (
                          <span style={{ fontSize: 14, color: st.tone === 'alert' ? 'var(--signal-alert)' : 'var(--text-muted)' }}>{st.text}</span>
                        ) : (
                          <span>
                            <TelemetryBadge tone={st.tone}>{st.text}</TelemetryBadge>
                          </span>
                        )
                      )}
                      {item?.state === 'reused' && <span style={{ fontSize: 13, color: 'var(--text-telemetry)' }}>{item.message}</span>}
                    </span>
                    <span style={{ display: 'flex', gap: 'var(--space-md)', alignItems: 'center' }}>
                      {reviewable && (
                        <Button variant="ghost" onClick={() => setReviewing(reviewing === key ? null : key)} style={{ padding: '4px 12px', fontSize: 14 }}>
                          {reviewing === key ? 'Hide' : 'Review'}
                        </Button>
                      )}
                      <Link to={`/instructor/teams/${r.teamId}?tab=ai&view=final&session=${r.cyberRangeId}`} style={{ fontSize: 14, color: 'var(--signal-secondary)' }}>
                        View details
                      </Link>
                    </span>
                  </div>
                  {reviewing === key && r.latestFinal && reviewable && <FinalReview summary={r.latestFinal} />}
                </div>
              );
            })}
          </div>
        )}

        {rows.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-md)' }}>
            <Button onClick={() => void start()} disabled={active || pickedCount === 0} style={{ opacity: active || pickedCount === 0 ? 0.5 : 1 }}>
              {pickedCount === 0 ? 'Nothing to generate' : `Generate ${pickedCount} selected`}
            </Button>
            {!active && selectableRows.length > 0 && (
              <button
                type="button"
                onClick={() => setSelected(pickedCount === selectableRows.length ? new Set() : new Set(selectableRows.map(keyOf)))}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--signal-secondary)', fontSize: 14 }}
              >
                {pickedCount === selectableRows.length ? 'Clear selection' : 'Select all that need an assessment'}
              </button>
            )}
            {data && (
              <span className="tabular" style={{ fontSize: 13, color: 'var(--text-telemetry)' }}>
                {Math.max(0, data.rateLimit.perHour - data.rateLimit.usedLastHour)} of {data.rateLimit.perHour} AI assessments left this hour
              </span>
            )}
          </div>
        )}
        <span style={{ ...monoLabel, fontSize: 11 }}>Teams whose result already covers their current work are not selectable — no new AI call is needed.</span>
      </div>
    </div>
  );
}

function FinalReview({ summary }: { summary: AssessmentSummary }) {
  const { data, error } = useAssessmentDetail(summary);
  if (error) return <div style={{ fontSize: 14, color: 'var(--signal-alert)' }}>Could not load this assessment.</div>;
  if (!data) return <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>Loading…</div>;
  return <FinalAssessmentView key={summary.id} detail={data.assessment as FinalDetail} previousTotal={null} />;
}
