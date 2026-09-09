import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { computeLeaderboard, isLeaderboardEnabled } from '../services/scoring.service.js';

const router = Router();

router.use(requireAuth);

// US-008: only show the leaderboard once the instructor has defined a measurement method.
router.get('/leaderboard', (_req, res) => {
  if (!isLeaderboardEnabled()) {
    res.json({ enabled: false, teams: [] });
    return;
  }
  res.json({ enabled: true, teams: computeLeaderboard() });
});

export default router;
