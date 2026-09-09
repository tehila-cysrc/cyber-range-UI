import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  checkConnectivity,
  createEnvironment,
  deleteEnvironment,
  getEnvironment,
  listEnvironments,
  updateEnvironment,
} from '../../services/environments.service.js';

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

export default router;
