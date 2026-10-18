import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { EntryFeedbackForm, type FeedbackVerdict } from '../documentation/EntryFeedback';
import { formatEntryTime } from '../documentation/InvestigationPage';
import { useToastStore } from '../../stores/toastStore';
import type { EvidenceRef } from './useAiAssessments';

// "Post as feedback" (plan §F-2, decision 4): opens the EXISTING entry-feedback form for the entry the
// AI referenced, pre-filled with its suggestion. The instructor edits and sends it through the existing
// POST /cyber-ranges/:id/documentation/:entryId/feedback — nothing is sent until they click Send.
export function PostFeedbackDialog({
  assessmentId,
  cyberRangeId,
  entryId,
  entry,
  verdict,
  text,
  onClose,
  onPosted,
}: {
  assessmentId: number;
  cyberRangeId: number;
  entryId: number;
  entry: EvidenceRef | undefined;
  verdict: FeedbackVerdict;
  text: string;
  onClose: () => void;
  onPosted: () => void;
}) {
  const queryClient = useQueryClient();
  const push = useToastStore((s) => s.push);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{ position: 'fixed', inset: 0, background: 'var(--overlay-backdrop)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 2000 }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="post-feedback-title"
        style={{
          width: 'min(560px, 100%)',
          maxHeight: '90vh',
          overflowY: 'auto',
          background: 'var(--surface-1)',
          border: '1px solid var(--surface-border-strong)',
          borderRadius: 'var(--radius-container)',
          boxShadow: '0 12px 40px rgba(0, 0, 0, 0.5)',
          padding: 'var(--space-lg)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-sm)',
        }}
      >
        <h2 id="post-feedback-title" style={{ fontSize: 18, margin: 0, color: 'var(--text-primary)' }}>
          Post feedback on this entry
        </h2>
        <div style={{ borderLeft: '3px solid var(--surface-border-strong)', background: 'var(--surface-floor)', borderRadius: 'var(--radius-control)', padding: '6px 10px' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-telemetry)' }}>
            {[entry?.author, entry?.createdAt ? formatEntryTime(entry.createdAt) : null].filter(Boolean).join(' · ') || `Entry #${entryId}`}
          </div>
          <div className="prose-pre" style={{ fontSize: 14, color: 'var(--text-primary)', marginTop: 2 }}>
            {entry?.excerpt ?? 'Entry text unavailable.'}
          </div>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
          Suggested by the AI assistant. Edit it as needed: the team sees exactly what you send, under this entry.
        </p>
        <EntryFeedbackForm<unknown>
          cyberRangeId={cyberRangeId}
          entryId={entryId}
          initialVerdict={verdict}
          initialBody={text}
          startOpen
          sourceAiAssessmentId={assessmentId}
          onCancel={onClose}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['documentation'] });
            queryClient.invalidateQueries({ queryKey: ['ai-assessment', assessmentId] }); // refresh "Posted"
            push('Feedback sent to the team.', 'success');
            onPosted();
          }}
        />
      </div>
    </div>
  );
}
