import { Router } from 'express';
import { db } from '../../db/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { emitLeaderboardUpdate } from '../../sockets/emitters.js';
import { computeLeaderboard } from '../../services/scoring.service.js';

const router = Router();

router.use(requireAuth, requireRole('instructor'));

router.get('/scoring-config', (_req, res) => {
  const config = db
    .prepare('SELECT leaderboard_enabled AS leaderboardEnabled, method_key AS methodKey FROM scoring_config WHERE id = 1')
    .get();
  res.json({ config });
});

router.put('/scoring-config', (req, res) => {
  const { leaderboardEnabled } = req.body ?? {};
  db.prepare('UPDATE scoring_config SET leaderboard_enabled = ? WHERE id = 1').run(
    leaderboardEnabled ? 1 : 0,
  );

  if (leaderboardEnabled) {
    emitLeaderboardUpdate(computeLeaderboard());
  }

  res.json({ ok: true });
});

export default router;
