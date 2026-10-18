import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { EmptyState } from '../../components/EmptyState';
import { AssessmentRunPanel, type RunPanelConfig } from './AssessmentRunPanel';
import { FinalAssessmentPanel } from './FinalAssessmentPanel';
import { LiveAssessmentView } from './LiveAssessmentView';
import { describeAiError, type LiveDetail } from './useAiAssessments';

// Team workspace "AI Review" tab (plan §F-2/§F-3): live progress reviews and the final assessment of
// ONE team. Platform P3 (2026-10-18): any of the team's sessions can be picked — the active one, a
// paused one (live reviews are allowed there too) or a completed one (final assessment) — and the
// view + session are kept in the URL (?tab=ai&view=final&session=<scenario id>) so a reload keeps them.

const LIVE: RunPanelConfig = {
  mode: 'live',
  title: 'AI progress review',
  runLabel: 'Analyze progress',
  againLabel: 'Run a fresh review',
  runningLabel: 'Analyzing… (usually 20–60 seconds)',
  emptyHint: 'No AI reviews yet. "Analyze progress" compares this team\'s timeline and canvas with the scenario\'s reference document.',
  canRun: (s) => s.pinnedAvailable && (s.sessionStatus === 'active' || s.sessionStatus === 'paused'),
  notReadyReason: (s) => {
    if (s.sessionStatus !== 'active' && s.sessionStatus !== 'paused') return describeAiError('scenario_not_running');
    if (s.pinnedVersion === null) return describeAiError('ground_truth_not_ready');
    if (!s.pinnedAvailable) return describeAiError('ground_truth_unavailable');
    return null;
  },
  // key: a different review starts with a fresh "reviewed" tick and posted markers.
  renderResult: (detail, { summary }) => <LiveAssessmentView key={summary.id} detail={detail as LiveDetail} />,
};

type View = 'live' | 'final';

interface PastSession {
  cyberRangeId: number;
  name: string;
  status: 'completed' | 'paused';
}

const selectStyle = {
  background: 'var(--surface-1)',
  border: '1px solid var(--surface-border)',
  borderRadius: 'var(--radius-control)',
  padding: '4px 8px',
  color: 'var(--text-primary)',
  fontSize: 13,
} as const;

export function AiAssessmentPanel({ teamId, cyberRangeId, scenarioName }: { teamId: number; cyberRangeId: number | null; scenarioName: string | null }) {
  const [params, setParams] = useSearchParams();
  const view: View = params.get('view') === 'final' ? 'final' : 'live';
  // The team's other sessions (paused by a switch, or completed) — same scope rules as the Debrief.
  const { data } = useQuery({
    queryKey: ['history', `?teamId=${teamId}`],
    queryFn: () => apiFetch<{ scenarios: PastSession[] }>(`/history?teamId=${teamId}`),
  });
  const sessions = [
    ...(cyberRangeId != null ? [{ cyberRangeId, name: scenarioName ?? 'Active scenario', status: 'active' as const }] : []),
    ...(data?.scenarios ?? []).filter((x) => x.cyberRangeId !== cyberRangeId),
  ];
  const wanted = Number(params.get('session'));
  const selected = sessions.find((x) => x.cyberRangeId === wanted) ?? sessions[0] ?? null;
  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  if (!selected) return <EmptyState message="AI review needs a scenario session. Assign a scenario to this team first." />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-sm)' }}>
        <div role="radiogroup" aria-label="AI review type" style={{ display: 'flex', gap: 6 }}>
          {(
            [
              { key: 'live', label: 'Progress review' },
              { key: 'final', label: 'Final assessment' },
            ] as const
          ).map((v) => (
            <button
              key={v.key}
              type="button"
              role="radio"
              aria-checked={view === v.key}
              onClick={() => update({ view: v.key === 'final' ? 'final' : null })}
              style={{
                fontFamily: 'inherit',
                fontSize: 13,
                padding: '3px 12px',
                borderRadius: 999,
                cursor: 'pointer',
                border: `1px solid ${view === v.key ? 'var(--signal-primary)' : 'var(--surface-border)'}`,
                background: view === v.key ? 'var(--surface-floor)' : 'transparent',
                color: view === v.key ? 'var(--text-primary)' : 'var(--text-muted)',
              }}
            >
              {v.label}
            </button>
          ))}
        </div>
        {sessions.length > 1 && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)' }}>
            Session
            <select
              value={selected.cyberRangeId}
              onChange={(e) => update({ session: e.target.value === String(cyberRangeId) ? null : e.target.value })}
              style={selectStyle}
            >
              {sessions.map((x) => (
                <option key={x.cyberRangeId} value={x.cyberRangeId}>
                  {x.name} — {x.status}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {view === 'live' ? (
        <AssessmentRunPanel key={`live-${selected.cyberRangeId}`} teamId={teamId} cyberRangeId={selected.cyberRangeId} scenarioName={selected.name} config={LIVE} />
      ) : (
        <FinalAssessmentPanel key={`final-${selected.cyberRangeId}`} teamId={teamId} cyberRangeId={selected.cyberRangeId} scenarioName={selected.name} />
      )}
    </div>
  );
}
