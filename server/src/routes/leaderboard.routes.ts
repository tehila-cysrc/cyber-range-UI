import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { leaderboardFor } from '../services/scoring.service.js';
import { requirePermission } from '../authz/requirePermission.js';

const router = Router();

router.use(requireAuth);

// Scoped per caller — see leaderboardFor (admin: all; instructor: assigned organizations; student: own).
router.get('/leaderboard', requirePermission('leaderboard.read'), (req, res) => {
  res.json(leaderboardFor(req.user!));
});

export default router;
