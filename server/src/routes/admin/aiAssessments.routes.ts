import { Router, type Request, type Response } from 'express';
import { db } from '../../db/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { auditDenied, requirePermission } from '../../authz/requirePermission.js';
import { can } from '../../authz/permissions.js';
import { assertPairInScope } from '../../authz/resolve.js';
import { aiStatusSummary } from '../../services/ai/aiConfig.js';
import {
  AssessmentRequestBody,
  DecisionBody,
  decideAssessment,
  finalAssessmentOverview,
  rateLimitStatus,
  getAssessmentDetail,
  listAssessments,
  loadAssessmentOwner,
  requestAssessment,
  sessionAiInfo,
  type RunnerResult,
} from '../../services/ai/assessmentRunner.service.js';

// AI Investigation Assessment — assessments (plan §H rows 1, 6–9). Staff only (`ai_assessment.use`).
// Every route checks PAIR scope (team's organization, scenario) on ids loaded from the DB — the
// request body's ids only select the row; out of scope answers 404 exactly like a missing row.
// Nothing here writes official scores or student-visible feedback.
const router = Router();
router.use(requireAuth);

function send<T>(res: Response, r: RunnerResult<T>) {
  if (r.ok) res.status(r.status).json(r.value);
  else res.status(r.status).json({ error: r.error, reason: r.reason });
}

function positiveInt(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// The team must exist in the active run AND be in the caller's pair scope for the scenario.
function assertTeamPair(req: Request, res: Response, teamId: number, cyberRangeId: number): boolean {
  if (!assertPairInScope(req, res, teamId, cyberRangeId)) return false;
  const exists = db
    .prepare('SELECT 1 FROM teams t JOIN event_runs r ON r.id = t.event_run_id WHERE t.id = ? AND r.is_active = 1')
    .get(teamId);
  const range = db.prepare('SELECT 1 FROM cyber_ranges WHERE id = ?').get(cyberRangeId);
  if (!exists || !range) {
    res.status(404).json({ error: 'team not found' });
    return false;
  }
  return true;
}

router.get('/ai/status', requirePermission('ai_assessment.use'), (_req, res) => {
  res.json(aiStatusSummary());
});

router.post('/ai-assessments', requirePermission('ai_assessment.use'), (req, res) => {
  const parsed = AssessmentRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'body must be {teamId, cyberRangeId, mode: "live"|"final", force?}', reason: 'invalid_request' });
    return;
  }
  if (!assertTeamPair(req, res, parsed.data.teamId, parsed.data.cyberRangeId)) return;
  send(res, requestAssessment(req.user!, parsed.data));
});

router.get('/ai-assessments', requirePermission('ai_assessment.use'), (req, res) => {
  const teamId = positiveInt(req.query.teamId);
  const cyberRangeId = positiveInt(req.query.cyberRangeId);
  const mode = req.query.mode === undefined ? null : req.query.mode;
  if (teamId === null || cyberRangeId === null || (mode !== null && mode !== 'live' && mode !== 'final')) {
    res.status(400).json({ error: 'pass ?teamId=&cyberRangeId= (and optionally &mode=live|final)', reason: 'invalid_request' });
    return;
  }
  if (!assertTeamPair(req, res, teamId, cyberRangeId)) return;
  res.json({ assessments: listAssessments(teamId, cyberRangeId, mode as 'live' | 'final' | null), session: sessionAiInfo(teamId, cyberRangeId) });
});

// Event Summary batch: every started session in the caller's pair scope with its latest final and
// whether a new request would reuse it. Read-only — no Foundry call, no write. Before /:id.
router.get('/ai-assessments/overview', requirePermission('ai_assessment.use'), (req, res) => {
  res.json({ rows: finalAssessmentOverview(req.user!), rateLimit: rateLimitStatus(req.user!) });
});

// Scope is checked on the ROW's own team + scenario, never on anything the client sends.
function loadOwnedAssessment(req: Request, res: Response): number | null {
  const id = positiveInt(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'invalid assessment id' });
    return null;
  }
  const owner = loadAssessmentOwner(id);
  if (!owner) {
    res.status(404).json({ error: 'assessment not found' });
    return null;
  }
  if (!assertPairInScope(req, res, owner.teamId, owner.cyberRangeId, 'assessment')) return null;
  return id;
}

router.get('/ai-assessments/:id', requirePermission('ai_assessment.use'), (req, res) => {
  const id = loadOwnedAssessment(req, res);
  if (id === null) return;
  res.json({ assessment: getAssessmentDetail(id) });
});

// Final-score decision: recorded on the assessment only — never a `scores` row, never the leaderboard.
router.post('/ai-assessments/:id/decision', requirePermission('ai_assessment.use'), (req, res) => {
  if (!can(req.user!.role, 'score.award')) {
    auditDenied(req, 'score.award');
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const id = loadOwnedAssessment(req, res);
  if (id === null) return;
  const parsed = DecisionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'body must be {decision: "approved"|"edited"|"rejected", score?: 0..100, note?: string, override?: boolean}', reason: 'invalid_request' });
    return;
  }
  send(res, decideAssessment(id, parsed.data, req.user!.username));
});

export default router;
