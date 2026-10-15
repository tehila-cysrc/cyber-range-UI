import { useState } from 'react';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { TelemetryBadge } from '../../components/TelemetryBadge';
import { ApiError } from '../../lib/apiClient';
import { formatEntryTime } from '../documentation/InvestigationPage';
import { LiveAssessmentView } from './LiveAssessmentView';
import { monoLabel } from './aiStyles';
import { describeAiError, useAssessmentDetail, useAssessmentList, useRunLiveReview, type AssessmentSummary, type SessionAiInfo } from './useAiAssessments';

// Team workspace "AI Review" tab (plan §F-2): live progress reviews of ONE team on ONE scenario.
// Uses the session's pinned ground-truth version (server-side); runs only when the instructor asks.

function canRun(session: SessionAiInfo | undefined) {
  return !!session && session.pinnedAvailable && (session.sessionStatus === 'active' || session.sessionStatus === 'paused');
}

function notReadyReason(session: SessionAiInfo | undefined): string | null {
  if (!session) return null;
  if (session.sessionStatus !== 'active' && session.sessionStatus !== 'paused') return describeAiError('scenario_not_running');
  if (session.pinnedVersion === null) return describeAiError('ground_truth_not_ready');
  if (!session.pinnedAvailable) return describeAiError('ground_truth_unavailable');
  return null;
}

export function AiAssessmentPanel({ teamId, cyberRangeId, scenarioName }: { teamId: number; cyberRangeId: number | null; scenarioName: string | null }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { data, error } = useAssessmentList(teamId, cyberRangeId, 'live');
  const { run, isPending } = useRunLiveReview();

  if (cyberRangeId == null) return <EmptyState message="A progress review needs an active scenario. Assign one to this team first." />;
  if (error) return <EmptyState message={error instanceof ApiError && error.reason ? describeAiError(error.reason) : 'Could not load AI reviews.'} />;
  if (!data) return <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Loading…</div>;

  const { assessments, session } = data;
  const selected = assessments.find((a) => a.id === selectedId) ?? assessments[0] ?? null;
  const running = assessments.some((a) => a.status === 'pending' || a.status === 'running');
  const reason = notReadyReason(session);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-md)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={monoLabel}>AI progress review{scenarioName ? ` · ${scenarioName}` : ''}</span>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {session.pinnedVersion !== null ? `Reference document v${session.pinnedVersion} (pinned when this session started)` : 'No reference document pinned to this session'}
            {session.latestReadyVersion !== null && session.pinnedVersion !== null && session.latestReadyVersion !== session.pinnedVersion && (
              <span style={{ color: 'var(--text-telemetry)' }}> · latest is v{session.latestReadyVersion}</span>
            )}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            onClick={() => run(teamId, cyberRangeId, false, (a) => setSelectedId(a.id))}
            disabled={!canRun(session) || running || isPending}
            style={{ opacity: !canRun(session) || running || isPending ? 0.5 : 1 }}
          >
            Analyze progress
          </Button>
          {assessments.some((a) => a.status === 'succeeded') && (
            <Button
              variant="ghost"
              onClick={() => run(teamId, cyberRangeId, true, (a) => setSelectedId(a.id))}
              disabled={!canRun(session) || running || isPending}
              style={{ opacity: !canRun(session) || running || isPending ? 0.5 : 1 }}
            >
              Run a fresh review
            </Button>
          )}
        </div>
      </div>
      {reason && <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>{reason}</div>}

      {!selected ? (
        <EmptyState message={reason ? 'No AI reviews yet.' : 'No AI reviews yet. "Analyze progress" compares this team\'s timeline and canvas with the scenario\'s reference document.'} />
      ) : (
        <SelectedAssessment summary={selected} onRetry={canRun(session) && !running ? () => run(teamId, cyberRangeId, true, (a) => setSelectedId(a.id)) : null} />
      )}

      {assessments.length > 1 && <AssessmentHistoryList assessments={assessments} selectedId={selected?.id ?? null} onSelect={setSelectedId} />}
    </div>
  );
}

function SelectedAssessment({ summary, onRetry }: { summary: AssessmentSummary; onRetry: (() => void) | null }) {
  const { data, error } = useAssessmentDetail(summary);
  const meta = (
    <div className="tabular" style={{ fontSize: 12, color: 'var(--text-telemetry)', display: 'flex', flexWrap: 'wrap', gap: '2px 12px' }}>
      <span>Requested by {summary.requestedBy}</span>
      <span>{formatEntryTime(summary.createdAt)}</span>
      <span>Reference v{summary.documentVersion}</span>
      {data?.assessment.agentVersion && <span>Agent v{data.assessment.agentVersion}</span>}
      {data?.assessment.model && <span>{data.assessment.model}</span>}
      {data?.assessment.durationMs != null && <span>{Math.round(data.assessment.durationMs / 1000)} s</span>}
    </div>
  );

  if (summary.status === 'pending' || summary.status === 'running') {
    return (
      <div role="status" style={{ padding: 'var(--space-lg)', border: '1px dashed var(--signal-secondary)', borderRadius: 'var(--radius-container)', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 15, color: 'var(--text-primary)' }}>Analyzing… (usually 20–60 seconds)</span>
        {meta}
      </div>
    );
  }
  if (summary.status === 'failed') {
    return (
      <div role="alert" style={{ padding: 'var(--space-md)', border: '1px solid var(--signal-alert)', borderRadius: 'var(--radius-container)', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 15, color: 'var(--text-primary)' }}>{describeAiError(summary.errorCode)}</span>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>No result was kept from this attempt.</span>
        {meta}
        {onRetry && (
          <div>
            <Button variant="ghost" onClick={onRetry}>
              Try again
            </Button>
          </div>
        )}
      </div>
    );
  }
  if (error) return <EmptyState message="Could not load this review." />;
  if (!data) return <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Loading…</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
      {meta}
      {/* key: a different review starts with a fresh "reviewed" tick and posted markers. */}
      <LiveAssessmentView key={summary.id} detail={data.assessment} />
    </div>
  );
}

const STATUS_BADGE: Record<AssessmentSummary['status'], { label: string; tone: 'primary' | 'secondary' | 'alert' | 'muted' }> = {
  pending: { label: 'Queued', tone: 'secondary' },
  running: { label: 'Running', tone: 'secondary' },
  succeeded: { label: 'Done', tone: 'primary' },
  failed: { label: 'Failed', tone: 'alert' },
};

function AssessmentHistoryList({ assessments, selectedId, onSelect }: { assessments: AssessmentSummary[]; selectedId: number | null; onSelect: (id: number) => void }) {
  return (
    <details style={{ border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-container)', padding: 'var(--space-sm) var(--space-md)' }}>
      <summary style={{ ...monoLabel, cursor: 'pointer' }}>Earlier reviews ({assessments.length})</summary>
      <ul style={{ listStyle: 'none', margin: 'var(--space-sm) 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {assessments.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => onSelect(a.id)}
              aria-current={a.id === selectedId}
              style={{
                width: '100%',
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 10,
                background: a.id === selectedId ? 'var(--surface-floor)' : 'transparent',
                border: 'none',
                borderRadius: 'var(--radius-control)',
                padding: '4px 8px',
                cursor: 'pointer',
                color: 'var(--text-primary)',
                fontSize: 14,
                textAlign: 'left',
              }}
            >
              <span className="tabular" style={{ minWidth: 110 }}>{formatEntryTime(a.createdAt)}</span>
              <TelemetryBadge tone={STATUS_BADGE[a.status].tone}>{STATUS_BADGE[a.status].label}</TelemetryBadge>
              {a.leakSuspected && <TelemetryBadge tone="alert">Check before use</TelemetryBadge>}
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                v{a.documentVersion} · {a.requestedBy}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
