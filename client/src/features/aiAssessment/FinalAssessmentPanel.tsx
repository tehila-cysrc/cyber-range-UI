import { TelemetryBadge } from '../../components/TelemetryBadge';
import { confirmAction } from '../../components/ConfirmDialog';
import { AssessmentRunPanel, type RunPanelConfig } from './AssessmentRunPanel';
import { FinalAssessmentView } from './FinalAssessmentView';
import { describeAiError, type FinalDetail } from './useAiAssessments';

// "Generate final AI assessment" for one team on one scenario (plan §F-3). Shown in the team
// workspace's AI Review tab and in the staff Debrief. Allowed for any started session; a still-running
// scenario asks for confirmation first (plan §N-3).

const DECISION_BADGE = { approved: 'Approved', edited: 'Edited', rejected: 'Rejected' } as const;

const FINAL: RunPanelConfig = {
  mode: 'final',
  title: 'Final AI assessment',
  runLabel: 'Generate final AI assessment',
  againLabel: 'Generate again',
  runningLabel: 'Generating the final assessment… (usually 30–90 seconds)',
  emptyHint: 'No final assessment yet. It compares the whole investigation with the reference document and recommends a score out of 100. The score is never added to the team\'s points.',
  canRun: (s) => s.pinnedAvailable && s.sessionStatus !== null,
  notReadyReason: (s) => {
    if (s.sessionStatus === null) return describeAiError('no_progress');
    if (s.pinnedVersion === null) return describeAiError('ground_truth_not_ready');
    if (!s.pinnedAvailable) return describeAiError('ground_truth_unavailable');
    return null;
  },
  confirmRun: (s) =>
    s.sessionStatus === 'active'
      ? confirmAction({
          title: 'The scenario is still running',
          message: 'A final assessment now only covers what the team has documented so far. Generate it anyway?',
          confirmLabel: 'Generate now',
        })
      : Promise.resolve(true),
  renderResult: (detail, { summary, assessments }) => {
    // "Δ vs previous final": the newest earlier succeeded final.
    const previous = assessments.find((a) => a.id < summary.id && a.status === 'succeeded' && a.recommendedTotal !== null);
    return (
      <FinalAssessmentView
        key={summary.id}
        detail={detail as FinalDetail}
        previousTotal={previous?.recommendedTotal ?? null}
      />
    );
  },
  historyExtra: (a) => (
    <>
      {a.recommendedTotal !== null && <span className="tabular" style={{ fontSize: 13, color: 'var(--text-primary)' }}>AI {a.recommendedTotal}/100</span>}
      {a.decision && (
        <TelemetryBadge tone={a.decision === 'rejected' ? 'muted' : 'primary'}>
          {DECISION_BADGE[a.decision]}
          {a.decidedScore != null ? ` ${a.decidedScore}` : ''}
        </TelemetryBadge>
      )}
    </>
  ),
};

export function FinalAssessmentPanel({ teamId, cyberRangeId, scenarioName }: { teamId: number; cyberRangeId: number; scenarioName: string | null }) {
  return <AssessmentRunPanel teamId={teamId} cyberRangeId={cyberRangeId} scenarioName={scenarioName} config={FINAL} />;
}
