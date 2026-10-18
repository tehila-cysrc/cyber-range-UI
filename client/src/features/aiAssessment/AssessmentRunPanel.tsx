import { useState, type ReactNode } from 'react';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { TelemetryBadge } from '../../components/TelemetryBadge';
import { ApiError } from '../../lib/apiClient';
import { formatEntryTime } from '../documentation/InvestigationPage';
import { monoLabel } from './aiStyles';
import {
  describeAiError,
  useAssessmentDetail,
  useAssessmentList,
  useRunAssessment,
  type AssessmentDetail,
  type AssessmentMode,
  type AssessmentSummary,
  type SessionAiInfo,
} from './useAiAssessments';

// Shared frame for one team's AI assessments of ONE mode on ONE scenario (plan §F-2, §F-3): the
// session's pinned reference version, the run buttons, running / failed / result states and history.
// Every run uses the session's pinned ground truth (server-side) and starts only when staff ask.

export interface RunPanelConfig {
  mode: AssessmentMode;
  title: string;
  runLabel: string;
  againLabel: string;
  emptyHint: string;
  runningLabel: string;
  canRun: (session: SessionAiInfo) => boolean;
  notReadyReason: (session: SessionAiInfo) => string | null;
  // Optional confirmation before a run (e.g. a final assessment while the scenario is still running).
  confirmRun?: (session: SessionAiInfo) => Promise<boolean>;
  renderResult: (detail: AssessmentDetail, ctx: { summary: AssessmentSummary; assessments: AssessmentSummary[] }) => ReactNode;
  historyExtra?: (a: AssessmentSummary) => ReactNode;
}

function referenceLine(session: SessionAiInfo) {
  return (
    <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
      {session.pinnedVersion !== null ? `Reference document v${session.pinnedVersion} (pinned when this session started)` : 'No reference document pinned to this session'}
      {session.latestReadyVersion !== null && session.pinnedVersion !== null && session.latestReadyVersion !== session.pinnedVersion && (
        <span style={{ color: 'var(--text-telemetry)' }}> · latest is v{session.latestReadyVersion}</span>
      )}
    </span>
  );
}

export function AssessmentRunPanel({ teamId, cyberRangeId, scenarioName, config }: { teamId: number; cyberRangeId: number; scenarioName: string | null; config: RunPanelConfig }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { data, error } = useAssessmentList(teamId, cyberRangeId, config.mode);
  const { run, isPending } = useRunAssessment(config.mode);

  if (error) return <EmptyState message={error instanceof ApiError && error.reason ? describeAiError(error.reason) : 'Could not load AI assessments.'} />;
  if (!data) return <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Loading…</div>;

  const { assessments, session } = data;
  const selected = assessments.find((a) => a.id === selectedId) ?? assessments[0] ?? null;
  const running = assessments.some((a) => a.status === 'pending' || a.status === 'running');
  const reason = config.notReadyReason(session);
  const blocked = !config.canRun(session) || running || isPending;
  const start = async (force: boolean) => {
    if (config.confirmRun && !(await config.confirmRun(session))) return;
    run(teamId, cyberRangeId, force, (a) => setSelectedId(a.id));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-md)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={monoLabel}>
            {config.title}
            {scenarioName ? ` · ${scenarioName}` : ''}
          </span>
          {referenceLine(session)}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={() => start(false)} disabled={blocked} style={{ opacity: blocked ? 0.5 : 1 }}>
            {config.runLabel}
          </Button>
          {assessments.some((a) => a.status === 'succeeded') && (
            <Button variant="ghost" onClick={() => start(true)} disabled={blocked} style={{ opacity: blocked ? 0.5 : 1 }}>
              {config.againLabel}
            </Button>
          )}
        </div>
      </div>
      {reason && <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>{reason}</div>}

      {!selected ? (
        <EmptyState message={reason ? 'Nothing yet.' : config.emptyHint} />
      ) : (
        <SelectedAssessment
          summary={selected}
          assessments={assessments}
          config={config}
          onRetry={config.canRun(session) && !running ? () => start(true) : null}
        />
      )}

      {assessments.length > 1 && <AssessmentHistoryList assessments={assessments} selectedId={selected?.id ?? null} onSelect={setSelectedId} extra={config.historyExtra} />}
    </div>
  );
}

function SelectedAssessment({ summary, assessments, config, onRetry }: { summary: AssessmentSummary; assessments: AssessmentSummary[]; config: RunPanelConfig; onRetry: (() => void) | null }) {
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
        <span style={{ fontSize: 15, color: 'var(--text-primary)' }}>{config.runningLabel}</span>
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
  if (error) return <EmptyState message="Could not load this assessment." />;
  if (!data) return <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Loading…</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
      {meta}
      {config.renderResult(data.assessment, { summary, assessments })}
    </div>
  );
}

const STATUS_BADGE: Record<AssessmentSummary['status'], { label: string; tone: 'primary' | 'secondary' | 'alert' | 'muted' }> = {
  pending: { label: 'Queued', tone: 'secondary' },
  running: { label: 'Running', tone: 'secondary' },
  succeeded: { label: 'Done', tone: 'primary' },
  failed: { label: 'Failed', tone: 'alert' },
};

function AssessmentHistoryList({
  assessments,
  selectedId,
  onSelect,
  extra,
}: {
  assessments: AssessmentSummary[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  extra?: (a: AssessmentSummary) => ReactNode;
}) {
  return (
    <details style={{ border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-container)', padding: 'var(--space-sm) var(--space-md)' }}>
      <summary style={{ ...monoLabel, cursor: 'pointer' }}>History ({assessments.length})</summary>
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
              <span className="tabular" style={{ minWidth: 110 }}>
                {formatEntryTime(a.createdAt)}
              </span>
              <TelemetryBadge tone={STATUS_BADGE[a.status].tone}>{STATUS_BADGE[a.status].label}</TelemetryBadge>
              {a.leakSuspected && <TelemetryBadge tone="alert">Check before use</TelemetryBadge>}
              {extra?.(a)}
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }} title="Reference document version · requested by · agent version / reply format">
                doc v{a.documentVersion} · {a.requestedBy}
                {a.agentVersion ? ` · agent v${a.agentVersion}` : ''}
                {a.status === 'succeeded' ? ` · format ${a.contractVersion}` : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
