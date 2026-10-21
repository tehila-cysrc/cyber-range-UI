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
  rebuildVersion,
  documentContent,
  retryVersion,
  uploadVersion,
  type ServiceResult,
} from '../../services/ai/scenarioAiDocuments.service.js';
import { aiConfigView, foundryInventory } from '../../services/ai/aiResources.service.js';

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

function documentIdParam(req: Request, res: Response): number | null {
  const documentId = Number(req.params.documentId);
  if (!Number.isInteger(documentId) || documentId <= 0) {
    res.status(400).json({ error: 'invalid document id' });
    return null;
  }
  return documentId;
}

// Re-upload a version whose Foundry copy is gone, from the stored bytes (sessions pinned to it can be
// assessed again). Creates Foundry resources like an upload; never deletes anything.
router.post('/cyber-ranges/:cyberRangeId/ai-documents/:documentId/rebuild', requirePermission('scenario.author'), (req, res) => {
  const id = scenarioFromParam(req, res);
  if (id === null) return;
  const documentId = documentIdParam(req, res);
  if (documentId === null) return;
  send(res, rebuildVersion(req.user!, id, documentId), 202, (document) => ({ document }));
});

// The original file of a version (scenario authors only; audited). Never a student route.
router.get('/cyber-ranges/:cyberRangeId/ai-documents/:documentId/content', requirePermission('scenario.author'), (req, res) => {
  const id = scenarioFromParam(req, res);
  if (id === null) return;
  const documentId = documentIdParam(req, res);
  if (documentId === null) return;
  const r = documentContent(id, documentId, req.user!.username);
  if (!r.ok) {
    res.status(r.status).json({ error: r.error });
    return;
  }
  const safeName = r.value.filename.replace(/[^\w.\- ]/g, '_').slice(0, 200) || 'reference-document';
  res.setHeader('Content-Type', r.value.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(Buffer.from(r.value.bytes));
});

// The final-assessment rubric is defined in code (2026-10-21) — no route edits it.

// Admin only. Lists the app's recorded Foundry resources; ?state=candidates (default) = unused ones the
// admin may approve for deletion. Nothing is ever deleted by listing.
router.get('/ai/foundry-resources', requirePermission('ai_resources.manage'), (req, res) => {
  const state = req.query.state === 'all' ? 'all' : 'candidates';
  res.json({ state, resources: listFoundryResources(state) });
});

// Admin only. Configuration summary for the AI resources screen (setting names, never values/secrets).
router.get('/ai/config', requirePermission('ai_resources.manage'), (_req, res) => {
  res.json({ config: aiConfigView() });
});

// Admin only. READ-ONLY listing of the Foundry project (vector stores, files, agent versions), matched to
// the app's registry. Called only when the admin asks for it (never polled); changes nothing in Foundry.
router.get('/ai/foundry-inventory', requirePermission('ai_resources.manage'), async (_req, res, next) => {
  try {
    const r = await foundryInventory();
    if (r.ok) res.json({ inventory: r.value });
    else res.status(r.status).json({ error: r.error, reason: r.reason });
  } catch (e) {
    next(e);
  }
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
