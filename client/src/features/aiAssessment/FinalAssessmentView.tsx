import { useState } from 'react';
import { TelemetryBadge } from '../../components/TelemetryBadge';
import { EvidenceRefs } from './EvidenceRefs';
import { CopyButton, JudgementBadges, LeakGate, ResultWarnings, ReviewFlags, Section } from './AiParts';
import { ScoreDecisionForm } from './ScoreDecisionForm';
import { block, monoLabel, type Tone } from './aiStyles';
import type { FinalDetail, FinalResult } from './useAiAssessments';

// The final AI assessment (plan §F-3), readable in 1–2 minutes: overall level, stage-by-stage
// judgements with evidence, incorrect conclusions, strengths and gaps, the RECOMMENDED score per
// rubric criterion, suggested final feedback (instructor version + copy-only student-safe version) and
// the instructor's score decision. Nothing here reaches students or official scores on its own.

const LEVEL: Record<FinalResult['overallAssessment']['level'], { label: string; tone: Tone }> = {
  excellent: { label: 'Excellent', tone: 'primary' },
  good: { label: 'Good', tone: 'primary' },
  fair: { label: 'Fair', tone: 'secondary' },
  limited: { label: 'Limited', tone: 'tertiary' },
  insufficient: { label: 'Insufficient', tone: 'muted' },
};

const listStyle = { margin: 0, paddingLeft: 18, fontSize: 14, color: 'var(--text-primary)', display: 'flex', flexDirection: 'column', gap: 4 } as const;

export function FinalAssessmentView({ detail, previousTotal }: { detail: FinalDetail; previousTotal: number | null }) {
  const [reviewed, setReviewed] = useState(false);
  if (!detail.result) return null;
  const r = detail.result.result;
  const flags = detail.result.flags;
  const blocked = flags.leakSuspected && !reviewed;
  const labels = new Map((detail.rubric ?? []).map((c) => [c.key, c.label]));
  const delta = previousTotal == null ? null : r.score.recommendedTotal - previousTotal;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
      <section style={{ ...block, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-lg)' }}>
        <div style={{ flex: '1 1 380px', display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', minWidth: 0 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <TelemetryBadge tone={LEVEL[r.overallAssessment.level].tone}>{LEVEL[r.overallAssessment.level].label}</TelemetryBadge>
            <span style={{ fontSize: 13, color: 'var(--text-telemetry)' }} title={r.confidence.reason}>
              Confidence: {r.confidence.level}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 15, color: 'var(--text-primary)', lineHeight: 1.5 }}>{r.investigationSummary}</p>
          {r.overallAssessment.text && <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)' }}>{r.overallAssessment.text}</p>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={monoLabel}>AI recommended score · advisory</div>
          <div className="tabular" style={{ fontSize: 32, fontWeight: 600, color: 'var(--signal-primary)' }}>
            {r.score.recommendedTotal}
            <span style={{ fontSize: 16, color: 'var(--text-muted)' }}>/{r.score.maxTotal}</span>
          </div>
          {delta !== null && (
            <div className="tabular" style={{ fontSize: 12, color: 'var(--text-telemetry)' }}>
              {delta === 0 ? 'Same as the previous final' : `${delta > 0 ? '+' : ''}${delta} vs the previous final`}
            </div>
          )}
        </div>
      </section>

      <div role="note" style={{ border: '1px solid var(--signal-tertiary, var(--surface-border-strong))', borderRadius: 'var(--radius-control)', padding: '8px 12px', fontSize: 14, color: 'var(--text-primary)' }}>
        <strong>Advisory only.</strong> AI scores are not calibrated yet and can differ between runs on the same work. An instructor reviews and decides; the
        recommendation never changes team points or the leaderboard.
      </div>

      <ReviewFlags flags={flags} evidence={detail.evidenceIndex} />

      <Section title="Score breakdown (recommendation)">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          {r.score.criteria.map((c) => (
            <div key={c.key}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 14, color: 'var(--text-primary)' }}>
                <span>{labels.get(c.key) ?? c.key}</span>
                <span className="tabular">
                  {c.awardedPoints}/{c.maxPoints}
                </span>
              </div>
              <div aria-hidden style={{ height: 6, borderRadius: 3, background: 'var(--surface-floor)', marginTop: 3 }}>
                <div style={{ width: `${c.maxPoints ? (100 * c.awardedPoints) / c.maxPoints : 0}%`, height: '100%', borderRadius: 3, background: 'var(--signal-primary)' }} />
              </div>
              {c.rationale && <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{c.rationale}</div>}
            </div>
          ))}
        </div>
        {r.score.explanation && <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)' }}>{r.score.explanation}</p>}
      </Section>

      <Section title="Score decision" style={{ borderColor: 'var(--signal-primary)' }}>
        <ScoreDecisionForm detail={detail} recommended={r.score.recommendedTotal} />
      </Section>

      <Section title="Attack stages">
        {r.stages.length === 0 ? (
          <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>No stages listed.</div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            {r.stages.map((st, i) => (
              <li key={i}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 15, color: 'var(--text-primary)' }}>{st.stage}</span>
                  <JudgementBadges judgement={st.judgement} unsupported={st.unsupported} />
                </div>
                {st.interpretation && <div style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 2 }}>{st.interpretation}</div>}
                <EvidenceRefs evidence={st.evidence} index={detail.evidenceIndex} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      {r.incorrectConclusions.length > 0 && (
        <Section title="Incorrect conclusions">
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            {r.incorrectConclusions.map((c, i) => (
              <li key={i}>
                <div style={{ fontSize: 15, color: 'var(--text-primary)' }}>{c.claim}</div>
                <div style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 2 }}>Correction: {c.correction}</div>
                <EvidenceRefs evidence={c.evidence} index={detail.evidenceIndex} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--space-md)' }}>
        <Section title="Strengths">
          {r.strengths.length ? <ul style={listStyle}>{r.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul> : <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>None listed.</span>}
        </Section>
        <Section title="Areas for improvement">
          {r.areasForImprovement.length ? (
            <ul style={listStyle}>{r.areasForImprovement.map((s, i) => <li key={i}>{s}</li>)}</ul>
          ) : (
            <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>None listed.</span>
          )}
        </Section>
      </div>

      <Section title="Instructor version — never shown to students" style={{ borderColor: 'var(--signal-tertiary)' }}>
        <div className="prose-pre" style={{ fontSize: 14, color: 'var(--text-primary)' }}>
          {r.suggestedFinalFeedback.instructorVersion || 'None.'}
        </div>
      </Section>

      <Section title="Suggested final feedback for the team (copy only)">
        <LeakGate flags={flags} reviewed={reviewed} onReviewed={setReviewed} />
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>Nothing here is sent automatically. Copy it if you want to share it, and edit it first.</p>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <span className="prose-pre" style={{ flex: 1, fontSize: 14, color: 'var(--text-primary)' }}>
            {r.suggestedFinalFeedback.studentSafeVersion || 'None.'}
          </span>
          {r.suggestedFinalFeedback.studentSafeVersion && <CopyButton text={r.suggestedFinalFeedback.studentSafeVersion} disabled={blocked} />}
        </div>
      </Section>

      <ResultWarnings warnings={detail.warnings} />
    </div>
  );
}
