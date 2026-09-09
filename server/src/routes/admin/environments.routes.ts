import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  checkConnectivity,
  createEnvironment,
  deleteEnvironment,
  getEnvironment,
  linkEnvironmentToCyberRange,
  listEnvironments,
  listLinkedCyberRanges,
  unlinkEnvironmentFromCyberRange,
  updateEnvironment,
} from '../../services/environments.service.js';
import { getDiscoveryRun, listDiscoveryRuns, triggerDiscovery } from '../../services/discovery/discovery.service.js';

const router = Router();

router.use(requireAuth, requireRole('instructor'));

router.get('/environments', (_req, res) => {
  res.json({ environments: listEnvironments() });
});

router.post('/environments', (req, res) => {
  const { provider, name, externalAccountId, externalScope, tenantId, clientId, clientSecret, discoveryMode, discoveryIntervalMinutes } =
    req.body ?? {};

  if (
    (provider !== 'azure' && provider !== 'aws') ||
    typeof name !== 'string' ||
    typeof externalAccountId !== 'string' ||
    typeof tenantId !== 'string' ||
    typeof clientId !== 'string' ||
    typeof clientSecret !== 'string'
  ) {
    res.status(400).json({ error: "provider must be 'azure' or 'aws'; name, externalAccountId, tenantId, clientId and clientSecret are required" });
    return;
  }

  const environment = createEnvironment(
    {
      provider,
      name,
      externalAccountId,
      externalScope: externalScope ?? null,
      tenantId,
      clientId,
      clientSecret,
      discoveryMode,
      discoveryIntervalMinutes: discoveryIntervalMinutes ?? null,
    },
    req.user!.username,
  );

  res.status(201).json({ environment });
});

router.patch('/environments/:id', (req, res) => {
  const id = Number(req.params.id);
  const { name, externalScope, clientSecret, discoveryMode, discoveryIntervalMinutes } = req.body ?? {};

  const environment = updateEnvironment(id, { name, externalScope, clientSecret, discoveryMode, discoveryIntervalMinutes }, req.user!.username);
  if (!environment) {
    res.status(404).json({ error: 'environment not found' });
    return;
  }

  res.json({ environment });
});

router.delete('/environments/:id', (req, res) => {
  const id = Number(req.params.id);
  const deleted = deleteEnvironment(id, req.user!.username);
  if (!deleted) {
    res.status(404).json({ error: 'environment not found' });
    return;
  }
  res.json({ ok: true });
});

router.post('/environments/:id/connectivity-check', async (req, res) => {
  const id = Number(req.params.id);
  if (!getEnvironment(id)) {
    res.status(404).json({ error: 'environment not found' });
    return;
  }

  const result = await checkConnectivity(id, req.user!.username);
  res.json(result);
});

router.get('/environments/:id/linked-cyber-ranges', (req, res) => {
  const id = Number(req.params.id);
  if (!getEnvironment(id)) {
    res.status(404).json({ error: 'environment not found' });
    return;
  }
  res.json({ cyberRanges: listLinkedCyberRanges(id) });
});

router.post('/environments/:id/discover', (req, res) => {
  const id = Number(req.params.id);
  const outcome = triggerDiscovery(id, req.user!.username);
  if (!outcome.ok) {
    res.status(outcome.status).json({ error: outcome.error });
    return;
  }
  res.status(202).json({ runId: outcome.runId });
});

router.get('/environments/:id/discovery-runs', (req, res) => {
  const id = Number(req.params.id);
  if (!getEnvironment(id)) {
    res.status(404).json({ error: 'environment not found' });
    return;
  }
  res.json({ runs: listDiscoveryRuns(id) });
});

router.get('/environments/:id/discovery-runs/:runId', (req, res) => {
  const run = getDiscoveryRun(Number(req.params.runId));
  if (!run || run.environmentId !== Number(req.params.id)) {
    res.status(404).json({ error: 'discovery run not found' });
    return;
  }
  res.json({ run });
});

router.post('/cyber-ranges/:cyberRangeId/environments', (req, res) => {
  const cyberRangeId = Number(req.params.cyberRangeId);
  const { environmentId } = req.body ?? {};
  if (typeof environmentId !== 'number') {
    res.status(400).json({ error: 'environmentId is required' });
    return;
  }

  const linked = linkEnvironmentToCyberRange(cyberRangeId, environmentId, req.user!.username);
  if (!linked) {
    res.status(404).json({ error: 'cyber range or environment not found' });
    return;
  }
  res.status(201).json({ ok: true });
});

router.delete('/cyber-ranges/:cyberRangeId/environments/:environmentId', (req, res) => {
  const cyberRangeId = Number(req.params.cyberRangeId);
  const environmentId = Number(req.params.environmentId);

  const unlinked = unlinkEnvironmentFromCyberRange(cyberRangeId, environmentId, req.user!.username);
  if (!unlinked) {
    res.status(404).json({ error: 'link not found' });
    return;
  }
  res.json({ ok: true });
});

export default router;
