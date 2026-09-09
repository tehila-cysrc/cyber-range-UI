import { Router } from 'express';
import { db } from '../../db/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';

const router = Router();

router.use(requireAuth, requireRole('instructor'));

router.get('/teams', (_req, res) => {
  const teams = db.prepare('SELECT id, name FROM teams ORDER BY sort_order').all() as {
    id: number;
    name: string;
  }[];

  const membersStmt = db.prepare(
    'SELECT id, username, display_name AS displayName FROM users WHERE team_id = ? ORDER BY display_name',
  );

  const result = teams.map((team) => ({
    ...team,
    members: membersStmt.all(team.id),
  }));

  res.json({ teams: result });
});

export default router;
