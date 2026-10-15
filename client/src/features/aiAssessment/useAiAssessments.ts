import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { useCan } from '../../lib/permissions';
import { useToastStore } from '../../stores/toastStore';
import type { FeedbackVerdict } from '../documentation/EntryFeedback';

// AI Investigation Assessment — client side (docs/ai-investigation-assessment-plan.md §F, §H rows 1, 6–8).
// Everything here is staff-only (/admin, `ai_assessment.use`). Types mirror the server DTOs in
// server/src/services/ai/assessmentRunner.service.ts and the contract in assessmentContract.ts.

export type AssessmentMode = 'live' | 'final';
export type AssessmentStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export interface AssessmentSummary {
  id: number;
  teamId: number;
  cyberRangeId: number;
  mode: AssessmentMode;
  status: AssessmentStatus;
  documentVersion: number;
  requestedBy: string;
  createdAt: string;
  completedAt: string | null;
  errorCode: string | null;
  decision: 'approved' | 'edited' | 'rejected' | null;
  decidedScore: number | null;
  leakSuspected: boolean;
}

export interface SessionAiInfo {
  sessionStatus: string | null;
  pinnedVersion: number | null;
  pinnedAvailable: boolean;
  latestReadyVersion: number | null;
}

export type EvidenceType = 'timeline_entry' | 'canvas_node' | 'canvas_edge';
export interface Evidence {
  type: EvidenceType;
  id: number;
  quote: string | null;
}
export interface EvidenceRef {
  excerpt: string;
  createdAt: string | null;
  author: string | null;
}
export type EvidenceIndex = Record<EvidenceType, Record<string, EvidenceRef>>;

export type Judgement = 'correct' | 'partial' | 'incorrect' | 'not_documented' | 'insufficient_information';

export interface JudgedItem {
  concept: string;
  judgement: Judgement;
  evidence: Evidence[];
  interpretation: string;
  unsupported: boolean;
}

export interface LiveResult {
  status: 'on_track' | 'partially_on_track' | 'needs_guidance' | 'insufficient_evidence';
  summary: string;
  correctlyIdentified: JudgedItem[];
  partiallyUnderstood: JudgedItem[];
  missingOrUnclear: { topic: string; expectedByNow: 'yes' | 'no' | 'unknown'; whyItMatters: string; evidence: Evidence[] }[];
  direction: { assessment: 'right_direction' | 'mixed' | 'wrong_direction' | 'too_early'; explanation: string };
  instructorOnlyNotes: string;
  studentSafeFeedback: {
    teamLevel: string | null;
    entryFeedback: { entryId: number; verdict: FeedbackVerdict; text: string }[];
    guidingQuestion: string | null;
  };
  suggestedEntryScores: { entryId: number; points: number; rationale: string }[];
  confidence: { level: 'low' | 'medium' | 'high'; reason: string };
  warnings: string[];
}

export interface ValidationFlags {
  droppedEvidence: number;
  droppedQuotes: number;
  unsupportedItems: number;
  droppedEntryFeedback: number;
  droppedEntryScores: number;
  truncatedFields: number;
  scoreAdjusted: boolean;
  leakSuspected: boolean;
  leakedTechniqueIds: string[];
}

export interface AssessmentDetail extends AssessmentSummary {
  // Live only in this phase; the final view (Phase 7) reads the same field.
  result: { result: LiveResult; flags: ValidationFlags } | null;
  warnings: { validation: string[]; agent: string[] } | null;
  model: string | null;
  agentVersion: string | null;
  durationMs: number | null;
  evidenceIndex: EvidenceIndex;
}

const isRunning = (a: { status: AssessmentStatus }) => a.status === 'pending' || a.status === 'running';

export function useAiStatus() {
  const can = useCan('ai_assessment.use');
  const { data } = useQuery({
    queryKey: ['ai-status'],
    queryFn: () => apiFetch<{ enabled: boolean; configured: boolean }>('/admin/ai/status'),
    enabled: can,
    staleTime: 60_000,
  });
  // The kill switch hides every AI control (plan §J); so does a missing permission.
  return { available: can && !!data?.enabled };
}

export const assessmentsKey = (teamId: number, cyberRangeId: number, mode: AssessmentMode) => ['ai-assessments', teamId, cyberRangeId, mode];

export function useAssessmentList(teamId: number | null, cyberRangeId: number | null, mode: AssessmentMode, enabled = true) {
  return useQuery({
    queryKey: assessmentsKey(teamId ?? 0, cyberRangeId ?? 0, mode),
    queryFn: () =>
      apiFetch<{ assessments: AssessmentSummary[]; session: SessionAiInfo }>(`/admin/ai-assessments?teamId=${teamId}&cyberRangeId=${cyberRangeId}&mode=${mode}`),
    enabled: enabled && teamId != null && cyberRangeId != null,
    // Poll only while a job is running (typically 20–60 s).
    refetchInterval: (q) => (q.state.data?.assessments.some(isRunning) ? 3000 : false),
  });
}

export function useAssessmentDetail(summary: AssessmentSummary | null) {
  return useQuery({
    // Status in the key: a finished job is fetched once, after it finishes.
    queryKey: ['ai-assessment', summary?.id, summary?.status],
    queryFn: () => apiFetch<{ assessment: AssessmentDetail }>(`/admin/ai-assessments/${summary!.id}`),
    enabled: !!summary && !isRunning(summary),
    staleTime: Infinity,
  });
}

export function useRequestAssessment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { teamId: number; cyberRangeId: number; mode: AssessmentMode; force?: boolean }) =>
      apiFetch<{ assessment: AssessmentSummary; reused: boolean }>('/admin/ai-assessments', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: assessmentsKey(res.assessment.teamId, res.assessment.cyberRangeId, res.assessment.mode) });
    },
  });
}

// Starts a live review; "reused" (unchanged work) and refusals are explained in a toast.
export function useRunLiveReview() {
  const request = useRequestAssessment();
  const push = useToastStore((s) => s.push);
  const run = (teamId: number, cyberRangeId: number, force: boolean, onStarted?: (a: AssessmentSummary) => void) =>
    request.mutate(
      { teamId, cyberRangeId, mode: 'live', force },
      {
        onSuccess: (res) => {
          if (res.reused) push('No new activity since the last review, so the earlier result is shown. Use "Run a fresh review" to run it again.', 'info');
          onStarted?.(res.assessment);
        },
        onError: (err) => push(err instanceof ApiError ? describeAiError(err.reason) : 'Could not start the review.'),
      },
    );
  return { run, isPending: request.isPending };
}

// Server reason codes -> plain language. Unknown codes fall back to a generic line (never raw details).
export function describeAiError(code: string | null | undefined): string {
  switch (code) {
    case 'ai_disabled':
      return 'AI assessment is turned off on this server.';
    case 'ai_not_configured':
      return 'AI assessment is not configured on the server. Ask an admin.';
    case 'no_progress':
      return 'This team has not started this scenario.';
    case 'scenario_not_running':
      return 'A progress review needs the scenario to be active or paused.';
    case 'ground_truth_not_ready':
      return 'No reference document was ready when this session started. Upload one on the Scenarios page.';
    case 'ground_truth_unavailable':
      return "This session's reference document version is not available in Microsoft Foundry. Ask an admin.";
    case 'assessment_in_progress':
      return 'A review is already running for this team.';
    case 'ai_busy':
      return 'The AI assistant is busy with other reviews. Try again in a minute.';
    case 'rate_limited':
      return 'You have reached the hourly limit of AI reviews. Try again later.';
    case 'snapshot_too_large':
      return "This team's investigation is too large to send in one review.";
    case 'ai_timeout':
      return 'The AI assistant did not answer in time. Try again.';
    case 'ai_rate_limited':
    case 'ai_unavailable':
      return 'Microsoft Foundry was temporarily unavailable. Try again.';
    case 'ai_auth_failed':
      return 'The server could not authenticate to Microsoft Foundry. Ask an admin.';
    case 'ai_not_found':
      return 'The AI agent or the reference document was not found in Microsoft Foundry. Ask an admin.';
    case 'ai_bad_request':
      return 'Microsoft Foundry rejected the request. Ask an admin to check the AI configuration.';
    case 'ai_content_filtered':
      return "Microsoft's content safety filter blocked this review (often student text that looks like instructions to the AI). Review the timeline by hand.";
    case 'ai_no_retrieval':
      return 'The AI assistant did not consult the reference document, so no result was kept. Try again.';
    case 'invalid_response':
      return 'The AI assistant returned an answer in the wrong format twice, so no result was kept. Try again.';
    case 'contract_mismatch':
      return "The AI agent's answer format changed and no longer matches this app. Ask an admin to check the Foundry agent.";
    case 'interrupted':
      return 'The server restarted while this review was running. Run it again.';
    default:
      return 'The review failed. Try again.';
  }
}
