import { useState } from 'react';
import { EmptyState } from '../../components/EmptyState';
import { AssessmentRunPanel, type RunPanelConfig } from './AssessmentRunPanel';
import { FinalAssessmentPanel } from './FinalAssessmentPanel';
import { LiveAssessmentView } from './LiveAssessmentView';
import { describeAiError, type LiveDetail } from './useAiAssessments';

// Team workspace "AI Review" tab (plan §F-2/§F-3): live progress reviews and the final assessment of
// ONE team on its active scenario. The Debrief shows the final assessment for any scenario.

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

export function AiAssessmentPanel({ teamId, cyberRangeId, scenarioName }: { teamId: number; cyberRangeId: number | null; scenarioName: string | null }) {
  const [view, setView] = useState<View>('live');
  if (cyberRangeId == null) return <EmptyState message="AI review needs an active scenario. Assign one to this team first; past scenarios have their final assessment in the Debrief." />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
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
            onClick={() => setView(v.key)}
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
      {view === 'live' ? (
        <AssessmentRunPanel teamId={teamId} cyberRangeId={cyberRangeId} scenarioName={scenarioName} config={LIVE} />
      ) : (
        <FinalAssessmentPanel teamId={teamId} cyberRangeId={cyberRangeId} scenarioName={scenarioName} />
      )}
    </div>
  );
}
