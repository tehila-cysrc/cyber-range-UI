import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { listCatalog } from '../services/mitreCatalog.js';

const router = Router();

router.use(requireAuth);

// The full public ATT&CK catalog, for both roles — students search the whole thing, never a list of
// "the right answers" (expected TTPs are served only under /admin). Static per deploy, so the client
// caches it indefinitely.
router.get('/mitre/catalog', (_req, res) => {
  res.set('Cache-Control', 'private, max-age=86400');
  res.json(listCatalog());
});

export default router;
