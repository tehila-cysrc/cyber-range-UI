import { useState } from 'react';
import { Button } from '../../components/Button';
import { TelemetryBadge } from '../../components/TelemetryBadge';
import { useCan } from '../../lib/permissions';
import { EvidenceRefs } from './EvidenceRefs';
import { PostFeedbackDialog } from './PostFeedbackDialog';
import { CopyButton, JudgementBadges, LeakGate, ResultWarnings, ReviewFlags, Section } from './AiParts';
import { block, monoLabel, type Tone } from './aiStyles';
import type { JudgedItem, LiveDetail, LiveResult } from './useAiAssessments';

// The live "Analyze progress" result (plan §F-2), readable in 20–30 s: status, summary, what the team
// got right / partly / is missing, instructor-only notes, and student-safe suggestions the instructor
// may post (entry-linked, via the existing feedback form) or copy (team-level). Nothing here reaches
// students on its own.

const STATUS: Record<LiveResult['status'], { label: string; tone: Tone }> = {
  on_track: { label: 'On track', tone: 'primary' },
  partially_on_track: { label: 'Partially on track', tone: 'secondary' },
  needs_guidance: { label: 'Needs guidance', tone: 'tertiary' },
  insufficient_evidence: { label: 'Insufficient evidence', tone: 'muted' },
};
const DIRECTION: Record<LiveResult['direction']['assessment'], string> = {
  right_direction: 'Right direction',
  mixed: 'Mixed direction',
  wrong_direction: 'Wrong direction',
  too_early: 'Too early to tell',
};
// "unknown" is neutral on purpose: the platform does not know which attack stages have happened yet.
const EXPECTED: Record<'yes' | 'no' | 'unknown', { label: string; tone: Tone }> = {
  yes: { label: 'Expected by now', tone: 'tertiary' },
  no: { label: 'Not expected yet', tone: 'muted' },
  unknown: { label: 'May not have happened yet', tone: 'muted' },
};
const VERDICT_LABEL = { on_track: 'On track', off_track: 'Off track', comment: 'Comment' } as const;

function JudgedList({ items, empty, detail }: { items: JudgedItem[]; empty: string; detail: LiveDetail }) {
  if (items.length === 0) return <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>{empty}</div>;
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
      {items.map((it, i) => (
        <li key={i}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 15, color: 'var(--text-primary)' }}>{it.concept}</span>
            <JudgementBadges judgement={it.judgement} unsupported={it.unsupported} />
          </div>
          {it.interpretation && <div style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 2 }}>{it.interpretation}</div>}
          <EvidenceRefs evidence={it.evidence} index={detail.evidenceIndex} />
        </li>
      ))}
    </ul>
  );
}

export function LiveAssessmentView({ detail }: { detail: LiveDetail }) {
  const canFeedback = useCan('documentation.feedback');
  const [reviewed, setReviewed] = useState(false);
  const [posting, setPosting] = useState<LiveResult['studentSafeFeedback']['entryFeedback'][number] | null>(null);
  // "Posted" = saved instructor feedback that came from this assessment (server-side, survives reloads;
  // disappears if that feedback is deleted).
  const posted = new Set(detail.postedEntryIds ?? []);
  if (!detail.result) return null;
  const r = detail.result.result;
  const flags = detail.result.flags;
  // A suspected answer leak gates every path toward students until the instructor ticks "reviewed".
  const blocked = flags.leakSuspected && !reviewed;
  const s = r.studentSafeFeedback;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
      <section style={block}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <TelemetryBadge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</TelemetryBadge>
          <TelemetryBadge>{DIRECTION[r.direction.assessment]}</TelemetryBadge>
          <span style={{ fontSize: 13, color: 'var(--text-telemetry)' }} title={r.confidence.reason}>
            Confidence: {r.confidence.level}
          </span>
        </div>
        <p style={{ margin: 0, fontSize: 15, color: 'var(--text-primary)', lineHeight: 1.5 }}>{r.summary}</p>
        {r.direction.explanation && <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)' }}>{r.direction.explanation}</p>}
        <div style={{ fontSize: 13, color: 'var(--text-telemetry)' }}>
          Attack-stage progress: unknown (the platform does not track which stages have happened for this team). Missing items may simply not have happened yet.
        </div>
        {r.confidence.reason && <div style={{ fontSize: 13, color: 'var(--text-telemetry)' }}>Confidence reason: {r.confidence.reason}</div>}
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--space-md)' }}>
        <Section title="Correctly identified">
          <JudgedList items={r.correctlyIdentified} empty="Nothing yet." detail={detail} />
        </Section>
        <Section title="Partially understood">
          <JudgedList items={r.partiallyUnderstood} empty="Nothing partial." detail={detail} />
        </Section>
        <Section title="Missing or unclear">
          {r.missingOrUnclear.length === 0 ? (
            <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>No gaps noted.</div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
              {r.missingOrUnclear.map((g, i) => (
                <li key={i}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 15, color: 'var(--text-primary)' }}>{g.topic}</span>
                    <TelemetryBadge tone={EXPECTED[g.expectedByNow].tone}>{EXPECTED[g.expectedByNow].label}</TelemetryBadge>
                  </div>
                  {g.whyItMatters && <div style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 2 }}>{g.whyItMatters}</div>}
                  <EvidenceRefs evidence={g.evidence} index={detail.evidenceIndex} />
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section title="Instructor only — never shown to students" style={{ borderColor: 'var(--signal-tertiary)' }}>
        <div className="prose-pre" style={{ fontSize: 14, color: 'var(--text-primary)' }}>
          {r.instructorOnlyNotes || 'No notes.'}
        </div>
      </Section>

      <Section title="Suggested feedback for the team">
        <LeakGate flags={flags} reviewed={reviewed} onReviewed={setReviewed} />
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
          Nothing here is sent automatically. Posting opens the normal feedback form so you can edit it first.
        </p>

        {s.entryFeedback.length > 0 && (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            {s.entryFeedback.map((f) => {
              const entry = detail.evidenceIndex.timeline_entry[String(f.entryId)];
              return (
                <li key={f.entryId} style={{ borderLeft: '3px solid var(--surface-border-strong)', paddingLeft: 10 }}>
                  <div style={{ fontSize: 13, color: 'var(--text-telemetry)' }}>
                    On {entry?.author ? `${entry.author}'s entry` : `entry #${f.entryId}`}: “{entry ? (entry.excerpt.length > 90 ? `${entry.excerpt.slice(0, 90)}…` : entry.excerpt) : ''}”
                  </div>
                  <div style={{ fontSize: 14, color: 'var(--text-primary)', marginTop: 2 }}>
                    <span style={{ ...monoLabel, marginRight: 6 }}>{VERDICT_LABEL[f.verdict]}</span>
                    {f.text}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                    {posted.has(f.entryId) && <TelemetryBadge tone="primary">Posted</TelemetryBadge>}
                    {canFeedback && (
                      <Button variant="ghost" onClick={() => setPosting(f)} disabled={blocked} style={{ padding: '4px 12px', fontSize: 14, opacity: blocked ? 0.5 : 1 }}>
                        {posted.has(f.entryId) ? 'Post again…' : 'Post as feedback…'}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {[
          { label: 'Team-level feedback', text: s.teamLevel },
          { label: 'Guiding question', text: s.guidingQuestion },
        ]
          .filter((x): x is { label: string; text: string } => !!x.text)
          .map((x) => (
            <div key={x.label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={monoLabel}>{x.label} (copy only)</span>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span style={{ flex: 1, fontSize: 14, color: 'var(--text-primary)' }}>{x.text}</span>
                <CopyButton text={x.text} disabled={blocked} />
              </div>
            </div>
          ))}
        {s.entryFeedback.length === 0 && !s.teamLevel && !s.guidingQuestion && <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>No suggestions.</div>}
      </Section>

      {r.suggestedEntryScores.length > 0 && (
        <Section title="Suggested entry points (not awarded)">
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>For reference only. To award points, use the Scoring tab.</p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {r.suggestedEntryScores.map((sc) => {
              const entry = detail.evidenceIndex.timeline_entry[String(sc.entryId)];
              return (
                <li key={sc.entryId} style={{ fontSize: 14, color: 'var(--text-primary)' }}>
                  <span className="tabular" style={{ color: 'var(--signal-primary)' }}>
                    +{sc.points}
                  </span>{' '}
                  {entry?.author ? `${entry.author}: ` : ''}
                  <span style={{ color: 'var(--text-muted)' }}>“{entry ? (entry.excerpt.length > 70 ? `${entry.excerpt.slice(0, 70)}…` : entry.excerpt) : `entry #${sc.entryId}`}”</span>
                  {sc.rationale && <div style={{ fontSize: 13, color: 'var(--text-telemetry)' }}>{sc.rationale}</div>}
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      <ReviewFlags flags={flags} evidence={detail.evidenceIndex} />
      <ResultWarnings warnings={detail.warnings} />

      {posting && (
        <PostFeedbackDialog
          assessmentId={detail.id}
          cyberRangeId={detail.cyberRangeId}
          entryId={posting.entryId}
          entry={detail.evidenceIndex.timeline_entry[String(posting.entryId)]}
          verdict={posting.verdict}
          text={posting.text}
          onClose={() => setPosting(null)}
          onPosted={() => setPosting(null)}
        />
      )}
    </div>
  );
}
