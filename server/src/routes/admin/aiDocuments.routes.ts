import { Router, type Request, type Response } from 'express';
import { db } from '../../db/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../authz/requirePermission.js';
import { assertScenarioInScope } from '../../authz/resolve.js';
import { isAiEnabled } from '../../services/ai/aiConfig.js';
import {
  executeCleanup,
  getRubric,
  listDocuments,
  listFoundryResources,
  retryVersion,
  setRubric,
  uploadVersion,
  type ServiceResult,
} from '../../services/ai/scenarioAiDocuments.service.js';

// AI Investigation Assessment — scenario ground-truth documents (plan §H rows 2–5) and the admin's
// explicit Foundry cleanup. Scenario content follows the existing scenario rules: read with
// scenario.inspect, change with scenario.author, both on a scenario in the caller's scope (edits apply
// to every organization using it). Responses never carry document bytes or Foundry ids — except the
// admin-only resource list, which exists precisely to show the exact Foundry ids before approval.
const router = Router();
router.use(requireAuth);

// The scenario row from the URL: must exist and be in scope (404 otherwise, audited like any out-of-scope).
function scenarioFromParam(req: Request, res: Response): number | null {
  const id = Number(req.params.cyberRangeId);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'invalid cyber range id' });
    return null;
  }
  if (!assertScenarioInScope(req, res, id)) return null;
  if (!db.prepare('SELECT 1 FROM cyber_ranges WHERE id = ?').get(id)) {
    res.status(404).json({ error: 'cyber range not found' });
    return null;
  }
  return id;
}

function send<T>(res: Response, result: ServiceResult<T>, okStatus: number, wrap: (v: T) => unknown) {
  if (result.ok) res.status(okStatus).json(wrap(result.value));
  else res.status(result.status).json({ error: result.error, ...(result.reason ? { reason: result.reason } : {}) });
}

router.get('/cyber-ranges/:cyberRangeId/ai-documents', requirePermission('scenario.inspect'), (req, res) => {
  const rangeId = scenarioFromParam(req, res);
  if (rangeId === null) return;
  const { current, versions } = listDocuments(req.user!, rangeId);
  res.json({ current, versions, ready: current?.status === 'ready', rubric: getRubric(rangeId), aiEnabled: isAiEnabled() });
});

router.post('/cyber-ranges/:cyberRangeId/ai-documents', requirePermission('scenario.author'), (req, res) => {
  const rangeId = scenarioFromParam(req, res);
  if (rangeId === null) return;
  send(res, uploadVersion(req.user!, rangeId, req.body), 202, (document) => ({ document }));
});

router.post('/cyber-ranges/:cyberRangeId/ai-documents/:documentId/retry', requirePermission('scenario.author'), (req, res) => {
  const rangeId = scenarioFromParam(req, res);
  if (rangeId === null) return;
  const documentId = Number(req.params.documentId);
  if (!Number.isInteger(documentId) || documentId <= 0) {
    res.status(400).json({ error: 'invalid document id' });
    return;
  }
  send(res, retryVersion(req.user!, rangeId, documentId), 202, (document) => ({ document }));
});

router.put('/cyber-ranges/:cyberRangeId/ai-rubric', requirePermission('scenario.author'), (req, res) => {
  const rangeId = scenarioFromParam(req, res);
  if (rangeId === null) return;
  const error = setRubric(rangeId, req.body, req.user!.username);
  if (error) {
    res.status(400).json({ error, reason: 'invalid_rubric' });
    return;
  }
  res.json({ rubric: getRubric(rangeId) });
});

// Admin only. Lists the app's recorded Foundry resources; ?state=candidates (default) = unused ones the
// admin may approve for deletion. Nothing is ever deleted by listing.
router.get('/ai/foundry-resources', requirePermission('ai_resources.manage'), (req, res) => {
  const state = req.query.state === 'all' ? 'all' : 'candidates';
  res.json({ state, resources: listFoundryResources(state) });
});

// Admin only. The ONLY path that deletes anything in Foundry: exactly the submitted ids, each re-checked
// to still be an unused candidate. Body: { resourceIds: number[] }.
router.post('/ai/foundry-resources/cleanup', requirePermission('ai_resources.manage'), async (req, res, next) => {
  try {
    send(res, await executeCleanup(req.body?.resourceIds, req.user!.username), 200, (outcome) => outcome);
  } catch (e) {
    next(e);
  }
});

export default router;
