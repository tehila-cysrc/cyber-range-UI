import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { leaderboardFor } from '../services/scoring.service.js';

const router = Router();

router.use(requireAuth);

// Scoped per caller — see leaderboardFor (students: own organization only).
router.get('/leaderboard', (req, res) => {
  res.json(leaderboardFor(req.user!));
});

export default router;
