// AI assessment jobs (plan §E "assessmentRunner.service.ts", Phase 5).
//
// requestAssessment: validates the request against the loaded session row (the route has already
// checked pair scope), enforces limits, builds the snapshot, reuses an identical earlier result, or
// inserts a `pending` row and runs the Foundry call in the background (202 + polling).
// executeAssessment: invokes the ONE configured agent with the session's PINNED ground-truth store,
// validates the reply (assessmentValidation.ts), retries once on a retryable validation failure, and
// stores the outcome. A failed job stores NO result, so nothing from it can ever be shown or posted.
//
// Never touches `scores` or `documentation_feedback` (static guards): AI output reaches students only
// when an instructor submits it through the existing feedback form. No Azure resource is created here.
import { z } from 'zod';
import { db } from '../../db/index.js';
import type { Principal } from '../../authz/principal.js';
import { writeAudit } from '../audit.service.js';
import { getAiConfig } from './aiConfig.js';
import { CONTRACT_VERSION, type AssessmentMode } from './assessmentContract.js';
import { FoundryError, getFoundryClient } from './foundryClient.js';
import { SnapshotError, buildSnapshot, evidenceIndexFromSnapshot, leakScanContext, type InvestigationSnapshot } from './assessmentSnapshot.service.js';
import { validateAssessment, type RubricCriterion } from './assessmentValidation.js';
import { getRubric, resolveSessionVersion } from './scenarioAiDocuments.service.js';

const now = () => new Date().toISOString();

export const RATE_LIMIT_PER_HOUR = 30;
const RAW_OUTPUT_EXCERPT_MAX = 20_000;
const MAX_OUTPUT_TOKENS: Record<AssessmentMode, number> = { live: 3000, final: 5000 };

export const AssessmentRequestBody = z
  .object({
    teamId: z.number().int().positive(),
    cyberRangeId: z.number().int().positive(),
    mode: z.enum(['live', 'final']),
    force: z.boolean().optional(),
  })
  .strict();

export type RunnerResult<T> = { ok: true; status: number; value: T } | { ok: false; status: number; error: string; reason: string };
const refuse = (status: number, reason: string, error: string): RunnerResult<never> => ({ ok: false, status, error, reason });

// ---------------------------------------------------------------------------------------------
// The request message (plan §I.2): data and factual labels only — never instructions.

export function buildAssessmentInput(
  mode: AssessmentMode,
  snapshot: InvestigationSnapshot,
  groundTruthVersion: number,
  rubric: RubricCriterion[] | null,
): string {
  return JSON.stringify({
    contractVersion: CONTRACT_VERSION,
    mode,
    scenario: { ...snapshot.scenario, groundTruthVersion },
    exerciseState: snapshot.exerciseState,
    attackProgress: snapshot.attackProgress,
    recordedTechniqueOccurrences: snapshot.recordedTechniqueOccurrences,
    rubric: mode === 'final' ? { criteria: rubric } : null,
    untrustedStudentInvestigation: snapshot.untrustedStudentInvestigation,
  });
}

// ---------------------------------------------------------------------------------------------
// Rate limit: per account, sliding hour, in memory (like loginThrottle). Only NEW jobs count.

const recentByAccount = new Map<string, number[]>();
function underRateLimit(p: Principal): boolean {
  const key = p.accountId !== null ? `a${p.accountId}` : `u${p.id}`;
  const cutoff = Date.now() - 3600_000;
  const recent = (recentByAccount.get(key) ?? []).filter((t) => t > cutoff);
  recentByAccount.set(key, recent);
  return recent.length < RATE_LIMIT_PER_HOUR;
}
function countForRateLimit(p: Principal) {
  const key = p.accountId !== null ? `a${p.accountId}` : `u${p.id}`;
  recentByAccount.set(key, [...(recentByAccount.get(key) ?? []), Date.now()]);
}
export function resetAiRateLimitsForTests() {
  recentByAccount.clear();
}

// ---------------------------------------------------------------------------------------------
// DTOs. The summary/detail never carry the raw model output or the snapshot itself.

export interface AssessmentSummary {
  id: number;
  teamId: number;
  cyberRangeId: number;
  mode: AssessmentMode;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  documentVersion: number;
  requestedBy: string;
  createdAt: string;
  completedAt: string | null;
  errorCode: string | null;
  decision: 'approved' | 'edited' | 'rejected' | null;
  decidedScore: number | null;
  leakSuspected: boolean;
}

const SUMMARY_COLUMNS = `a.id, a.team_id AS teamId, a.cyber_range_id AS cyberRangeId, a.mode, a.status, a.document_version AS documentVersion,
  a.requested_by_username AS requestedBy, a.created_at AS createdAt, a.completed_at AS completedAt, a.error_code AS errorCode,
  a.decision, a.decided_score AS decidedScore, a.result_json AS resultJson`;

type SummaryRow = Omit<AssessmentSummary, 'leakSuspected'> & { resultJson: string | null };
function toSummary(r: SummaryRow): AssessmentSummary {
  const { resultJson, ...rest } = r;
  let leakSuspected = false;
  if (resultJson) {
    try {
      leakSuspected = !!JSON.parse(resultJson)?.flags?.leakSuspected;
    } catch {
      /* stored by us; ignore */
    }
  }
  return { ...rest, leakSuspected };
}

export function getAssessmentSummary(id: number): AssessmentSummary | null {
  const r = db.prepare(`SELECT ${SUMMARY_COLUMNS} FROM ai_assessments a WHERE a.id = ?`).get(id) as SummaryRow | undefined;
  return r ? toSummary(r) : null;
}

export function listAssessments(teamId: number, cyberRangeId: number, mode: AssessmentMode | null): AssessmentSummary[] {
  const rows = db
    .prepare(
      `SELECT ${SUMMARY_COLUMNS} FROM ai_assessments a
       WHERE a.team_id = ? AND a.cyber_range_id = ? ${mode ? 'AND a.mode = ?' : ''}
       ORDER BY a.created_at DESC, a.id DESC LIMIT 100`,
    )
    .all(...(mode ? [teamId, cyberRangeId, mode] : [teamId, cyberRangeId])) as SummaryRow[];
  return rows.map(toSummary);
}

export function loadAssessmentOwner(id: number): { teamId: number; cyberRangeId: number; organizationId: number | null } | null {
  return (
    (db.prepare('SELECT team_id AS teamId, cyber_range_id AS cyberRangeId, organization_id AS organizationId FROM ai_assessments WHERE id = ?').get(id) as
      | { teamId: number; cyberRangeId: number; organizationId: number | null }
      | undefined) ?? null
  );
}

export interface EvidenceRef {
  excerpt: string;
  createdAt: string | null;
  author: string | null; // REAL display name (staff-only route) — mapped from the record id, never sent to Foundry
}

export interface AssessmentDetail extends AssessmentSummary {
  result: unknown | null; // validated result + flags (succeeded only)
  warnings: { validation: string[]; agent: string[] } | null;
  rubric: RubricCriterion[] | null;
  model: string | null;
  agentVersion: string | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  evidenceIndex: { timeline_entry: Record<number, EvidenceRef>; canvas_node: Record<number, EvidenceRef>; canvas_edge: Record<number, EvidenceRef> };
}

const excerpt = (s: string) => (s.length > 200 ? `${s.slice(0, 200)}…` : s);

export function getAssessmentDetail(id: number): AssessmentDetail | null {
  const row = db
    .prepare(
      `SELECT ${SUMMARY_COLUMNS}, a.warnings_json AS warningsJson, a.rubric_json AS rubricJson, a.snapshot_json AS snapshotJson,
              a.model, a.agent_version AS agentVersion, a.duration_ms AS durationMs, a.input_tokens AS inputTokens, a.output_tokens AS outputTokens,
              a.decision_note AS decisionNote, a.decided_by_username AS decidedBy, a.decided_at AS decidedAt
       FROM ai_assessments a WHERE a.id = ?`,
    )
    .get(id) as
    | (SummaryRow & { warningsJson: string | null; rubricJson: string | null; snapshotJson: string; model: string | null; agentVersion: string | null; durationMs: number | null; inputTokens: number | null; outputTokens: number | null; decisionNote: string | null; decidedBy: string | null; decidedAt: string | null })
    | undefined;
  if (!row) return null;
  const snapshot = JSON.parse(row.snapshotJson) as InvestigationSnapshot;
  const idx = evidenceIndexFromSnapshot(snapshot);
  // Real authors for the records in THIS snapshot, from the DB (filtered on the row's team + scenario).
  const authors = new Map<number, string>(
    (
      db
        .prepare(
          `SELECT e.id, u.display_name AS name FROM documentation_entries e JOIN users u ON u.id = e.author_user_id
           WHERE e.team_id = ? AND e.cyber_range_id = ?`,
        )
        .all(row.teamId, row.cyberRangeId) as { id: number; name: string }[]
    ).map((r) => [r.id, r.name]),
  );
  const nodeAuthors = new Map<number, string>(
    (
      db
        .prepare(
          `SELECT n.id, u.display_name AS name FROM investigation_canvas_nodes n JOIN users u ON u.id = n.author_user_id
           WHERE n.team_id = ? AND n.cyber_range_id = ?`,
        )
        .all(row.teamId, row.cyberRangeId) as { id: number; name: string }[]
    ).map((r) => [r.id, r.name]),
  );
  const entryTimes = new Map(snapshot.untrustedStudentInvestigation.timelineEntries.map((e) => [e.id, e.createdAt]));
  const nodeTimes = new Map(snapshot.untrustedStudentInvestigation.canvas.nodes.map((n) => [n.id, n.createdAt]));
  const { resultJson, warningsJson, rubricJson, snapshotJson: _s, ...rest } = row;
  const parsed = resultJson ? JSON.parse(resultJson) : null;
  return {
    ...toSummary({ ...rest, resultJson } as SummaryRow),
    result: parsed,
    warnings: warningsJson ? JSON.parse(warningsJson) : null,
    rubric: rubricJson ? JSON.parse(rubricJson) : null,
    model: rest.model,
    agentVersion: rest.agentVersion,
    durationMs: rest.durationMs,
    inputTokens: rest.inputTokens,
    outputTokens: rest.outputTokens,
    decisionNote: rest.decisionNote,
    decidedBy: rest.decidedBy,
    decidedAt: rest.decidedAt,
    evidenceIndex: {
      timeline_entry: Object.fromEntries([...idx.timeline_entry].map(([k, v]) => [k, { excerpt: excerpt(v), createdAt: entryTimes.get(k) ?? null, author: authors.get(k) ?? null }])),
      canvas_node: Object.fromEntries([...idx.canvas_node].map(([k, v]) => [k, { excerpt: excerpt(v), createdAt: nodeTimes.get(k) ?? null, author: nodeAuthors.get(k) ?? null }])),
      canvas_edge: Object.fromEntries([...idx.canvas_edge].map(([k, v]) => [k, { excerpt: excerpt(v), createdAt: null, author: null }])),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Request

export function requestAssessment(p: Principal, body: z.infer<typeof AssessmentRequestBody>): RunnerResult<{ assessment: AssessmentSummary; reused: boolean }> {
  const config = getAiConfig();
  if (!config.enabled) return refuse(503, 'ai_disabled', 'AI assessment is disabled on this server');
  const { teamId, cyberRangeId, mode } = body;

  const progress = db
    .prepare(
      `SELECT tcp.status, t.organization_id AS organizationId FROM team_cyber_range_progress tcp JOIN teams t ON t.id = tcp.team_id
       WHERE tcp.team_id = ? AND tcp.cyber_range_id = ?`,
    )
    .get(teamId, cyberRangeId) as { status: string; organizationId: number | null } | undefined;
  if (!progress) return refuse(409, 'no_progress', 'this team has no session on this scenario');
  if (mode === 'live' && progress.status !== 'active' && progress.status !== 'paused') {
    return refuse(409, 'scenario_not_running', 'a live review needs an active or paused session');
  }

  // The session's PINNED version — never "current", never from the client.
  const version = resolveSessionVersion(teamId, cyberRangeId);
  if (!version) return refuse(409, 'ground_truth_not_ready', 'no ground-truth document is ready for this session');
  if (!version.vectorStoreId || version.foundryDeleted || (version.status !== 'ready' && version.status !== 'superseded')) {
    return refuse(409, 'ground_truth_unavailable', "this session's ground-truth version is not available in Microsoft Foundry");
  }

  const active = db
    .prepare("SELECT 1 FROM ai_assessments WHERE team_id = ? AND cyber_range_id = ? AND mode = ? AND status IN ('pending', 'running')")
    .get(teamId, cyberRangeId, mode);
  if (active) return refuse(409, 'assessment_in_progress', 'an assessment of this kind is already running for this team');

  let built;
  try {
    built = buildSnapshot(teamId, cyberRangeId);
  } catch (e) {
    if (e instanceof SnapshotError) return e.code === 'snapshot_too_large' ? refuse(422, e.code, e.message) : refuse(409, e.code, e.message);
    throw e;
  }
  const rubric = mode === 'final' ? getRubric(cyberRangeId).criteria.map((c) => ({ key: c.key, maxPoints: c.maxPoints })) : null;
  const rubricJson = rubric ? JSON.stringify(rubric) : null;

  // Unchanged work, same pinned version, same rubric -> return the earlier result (no new call, no cost).
  if (!body.force) {
    const prev = db
      .prepare(
        `SELECT id FROM ai_assessments
         WHERE team_id = ? AND cyber_range_id = ? AND mode = ? AND status = 'succeeded' AND document_id = ? AND snapshot_sha256 = ?
           AND COALESCE(rubric_json, '') = COALESCE(?, '')
         ORDER BY created_at DESC, id DESC LIMIT 1`,
      )
      .get(teamId, cyberRangeId, mode, version.documentId, built.sha256, rubricJson) as { id: number } | undefined;
    if (prev) return { ok: true, status: 200, value: { assessment: getAssessmentSummary(prev.id)!, reused: true } };
  }

  const inFlight = (db.prepare("SELECT COUNT(*) AS n FROM ai_assessments WHERE status IN ('pending', 'running')").get() as { n: number }).n;
  if (inFlight >= config.maxConcurrent) return refuse(429, 'ai_busy', 'the AI assistant is busy — try again in a minute');
  if (!underRateLimit(p)) return refuse(429, 'rate_limited', `limit of ${RATE_LIMIT_PER_HOUR} AI assessments per hour reached`);
  countForRateLimit(p);

  const id = Number(
    db
      .prepare(
        `INSERT INTO ai_assessments (team_id, cyber_range_id, organization_id, mode, status, document_id, document_version, document_sha256,
           rubric_json, snapshot_json, snapshot_sha256, agent_name, contract_version, requested_by_user_id, requested_by_username, created_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(teamId, cyberRangeId, progress.organizationId, mode, version.documentId, version.version, version.sha256, rubricJson, built.json, built.sha256, config.agentName, CONTRACT_VERSION, p.id, p.username, now()).lastInsertRowid,
  );
  writeAudit(p.username, 'ai_assessment.requested', 'ai_assessment', id, { mode, teamId, documentVersion: version.version, forced: !!body.force, ...built.counts }, { organizationId: progress.organizationId, cyberRangeId });
  // Read before starting: the job flips the row to `running` synchronously.
  const assessment = getAssessmentSummary(id)!;
  startExecution(id, version.vectorStoreId, p.username);
  return { ok: true, status: 202, value: { assessment, reused: false } };
}

// ---------------------------------------------------------------------------------------------
// Background execution

const inFlight = new Map<number, Promise<void>>();
function startExecution(id: number, vectorStoreId: string, actor: string) {
  const job = executeAssessment(id, vectorStoreId, actor).finally(() => inFlight.delete(id));
  inFlight.set(id, job);
}
export async function waitForAiAssessmentsIdle(): Promise<void> {
  while (inFlight.size) await Promise.allSettled([...inFlight.values()]);
}

function fail(id: number, code: string, extra: { rawOutput?: string; issues?: string[]; tokens?: { in: number; out: number }; started: number; filterCategories?: string[] }, actor: string) {
  const row = db.prepare('SELECT team_id AS teamId, cyber_range_id AS r, organization_id AS o, mode FROM ai_assessments WHERE id = ?').get(id) as { teamId: number; r: number; o: number | null; mode: string };
  db.prepare(
    `UPDATE ai_assessments SET status = 'failed', error_code = ?, result_json = NULL, warnings_json = ?, raw_output_excerpt = ?,
       input_tokens = ?, output_tokens = ?, duration_ms = ?, completed_at = ? WHERE id = ?`,
  ).run(
    code,
    extra.issues?.length ? JSON.stringify({ validation: extra.issues.slice(0, 20), agent: [] }) : null,
    extra.rawOutput ? extra.rawOutput.slice(0, RAW_OUTPUT_EXCERPT_MAX) : null, // staff-only debugging; never returned by the API
    extra.tokens?.in ?? null,
    extra.tokens?.out ?? null,
    Date.now() - extra.started,
    now(),
    id,
  );
  writeAudit(actor, 'ai_assessment.failed', 'ai_assessment', id, { mode: row.mode, teamId: row.teamId, errorCode: code, ...(extra.filterCategories?.length ? { filterCategories: extra.filterCategories } : {}), inputTokens: extra.tokens?.in ?? null, outputTokens: extra.tokens?.out ?? null }, { organizationId: row.o, cyberRangeId: row.r });
}

export async function executeAssessment(id: number, vectorStoreId: string, actor: string): Promise<void> {
  const started = Date.now();
  const tokens = { in: 0, out: 0 };
  try {
    const row = db
      .prepare('SELECT mode, team_id AS teamId, cyber_range_id AS r, organization_id AS o, document_version AS v, snapshot_json AS s, rubric_json AS rj FROM ai_assessments WHERE id = ? AND status = ?')
      .get(id, 'pending') as { mode: AssessmentMode; teamId: number; r: number; o: number | null; v: number; s: string; rj: string | null } | undefined;
    if (!row) return;
    db.prepare("UPDATE ai_assessments SET status = 'running' WHERE id = ?").run(id);
    const snapshot = JSON.parse(row.s) as InvestigationSnapshot;
    const rubric = row.rj ? (JSON.parse(row.rj) as RubricCriterion[]) : null;
    const input = buildAssessmentInput(row.mode, snapshot, row.v, rubric);
    const evidenceIndex = evidenceIndexFromSnapshot(snapshot);
    const leak = leakScanContext(row.teamId, row.r);
    const client = getFoundryClient();

    for (let attempt = 1; attempt <= 2; attempt++) {
      let response;
      try {
        response = await client.invokeAssessment({ vectorStoreId, input, maxOutputTokens: MAX_OUTPUT_TOKENS[row.mode] });
      } catch (e) {
        if (e instanceof FoundryError) {
          // Transport retries already happened in the client; content-filter blocks are never retried.
          fail(id, e.code, { tokens, started, filterCategories: e.filterCategories }, actor);
          return;
        }
        throw e;
      }
      tokens.in += response.usage?.inputTokens ?? 0;
      tokens.out += response.usage?.outputTokens ?? 0;
      const v = validateAssessment({ outputText: response.outputText, mode: row.mode, fileSearchCalls: response.fileSearchCalls, evidenceIndex, rubric, leak });
      if (!v.ok) {
        if (v.retryable && attempt === 1) continue; // one retry with the same input
        fail(id, v.errorCode, { rawOutput: response.outputText, issues: v.issues, tokens, started }, actor);
        return;
      }
      db.prepare(
        `UPDATE ai_assessments SET status = 'succeeded', error_code = NULL, result_json = ?, warnings_json = ?, agent_version = ?, model = ?,
           foundry_response_id = ?, input_tokens = ?, output_tokens = ?, duration_ms = ?, completed_at = ?, raw_output_excerpt = NULL
         WHERE id = ?`,
      ).run(
        JSON.stringify({ result: v.result, flags: v.flags }),
        JSON.stringify({ validation: v.warnings, agent: v.agentWarnings }),
        response.agentVersion,
        response.model,
        response.responseId,
        tokens.in,
        tokens.out,
        Date.now() - started,
        now(),
        id,
      );
      writeAudit(actor, 'ai_assessment.completed', 'ai_assessment', id, {
        mode: row.mode,
        teamId: row.teamId,
        attempts: attempt,
        agentVersion: response.agentVersion,
        inputTokens: tokens.in,
        outputTokens: tokens.out,
        leakSuspected: v.flags.leakSuspected,
        unsupportedItems: v.flags.unsupportedItems,
        droppedEvidence: v.flags.droppedEvidence,
      }, { organizationId: row.o, cyberRangeId: row.r });
      return;
    }
  } catch {
    // Unexpected error: never log its contents (could carry request details).
    console.error(`[ai-assessment] job ${id} failed unexpectedly`);
    try {
      fail(id, 'internal_error', { tokens, started }, actor);
    } catch {
      /* row may be gone (team deleted mid-run) */
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Instructor decision on a FINAL assessment — recorded on the assessment only; never a score row.

export const DecisionBody = z
  .object({
    decision: z.enum(['approved', 'edited', 'rejected']),
    score: z.number().int().min(0).max(100).optional(),
    note: z.string().max(1000).optional(),
    override: z.boolean().optional(),
  })
  .strict();

export function decideAssessment(id: number, body: z.infer<typeof DecisionBody>, actorUsername: string): RunnerResult<{ assessment: AssessmentSummary }> {
  const row = db
    .prepare('SELECT mode, status, decision, result_json AS r, team_id AS teamId, cyber_range_id AS rangeId, organization_id AS o FROM ai_assessments WHERE id = ?')
    .get(id) as { mode: string; status: string; decision: string | null; r: string | null; teamId: number; rangeId: number; o: number | null } | undefined;
  if (!row) return refuse(404, 'not_found', 'assessment not found');
  if (row.mode !== 'final') return refuse(409, 'not_final', 'only a final assessment takes a score decision');
  if (row.status !== 'succeeded' || !row.r) return refuse(409, 'not_succeeded', 'only a completed assessment can be decided');
  if (row.decision && !body.override) return refuse(409, 'already_decided', 'this assessment already has a decision (send override to change it)');
  const note = body.note?.trim() || null;
  let score: number | null = null;
  if (body.decision === 'approved') {
    score = (JSON.parse(row.r) as { result: { score: { recommendedTotal: number } } }).result.score.recommendedTotal;
  } else if (body.decision === 'edited') {
    if (body.score === undefined) return refuse(400, 'score_required', 'an edited decision needs a score from 0 to 100');
    if (!note) return refuse(400, 'note_required', 'explain the edited score in a note');
    score = body.score;
  } else if (body.score !== undefined) {
    return refuse(400, 'score_not_allowed', 'a rejected recommendation has no score');
  }
  db.prepare('UPDATE ai_assessments SET decision = ?, decided_score = ?, decision_note = ?, decided_by_username = ?, decided_at = ? WHERE id = ?').run(
    body.decision,
    score,
    note,
    actorUsername,
    now(),
    id,
  );
  writeAudit(actorUsername, 'ai_assessment.decided', 'ai_assessment', id, { decision: body.decision, score, previousDecision: row.decision, teamId: row.teamId }, { organizationId: row.o, cyberRangeId: row.rangeId });
  return { ok: true, status: 200, value: { assessment: getAssessmentSummary(id)! } };
}
