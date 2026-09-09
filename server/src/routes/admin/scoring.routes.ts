import { Router } from 'express';
import { db } from '../../db/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { emitScoreAwarded, emitLeaderboardUpdate } from '../../sockets/emitters.js';
import { computeLeaderboard, isLeaderboardEnabled, teamTotal, studentTotal } from '../../services/scoring.service.js';

const router = Router();

router.use(requireAuth, requireRole('instructor'));

// US-007: instructor gives free-form points against a documentation entry (or a standalone
// team-level award — no separate "milestones" entity, see CLAUDE/invariants.md).
router.post('/scores', (req, res) => {
  const { teamId, studentUserId, documentationEntryId, cyberRangeId, points, isGamified, note } =
    req.body ?? {};

  if (!teamId || typeof points !== 'number') {
    res.status(400).json({ error: 'teamId and points are required' });
    return;
  }

  const createdAt = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO scores
         (team_id, student_user_id, documentation_entry_id, cyber_range_id, points, is_gamified, awarded_by_user_id, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      teamId,
      studentUserId ?? null,
      documentationEntryId ?? null,
      cyberRangeId ?? null,
      points,
      isGamified ? 1 : 0,
      req.user!.id,
      note ?? null,
      createdAt,
    );

  const score = db
    .prepare(
      `SELECT
         s.id AS id, s.points AS points, s.is_gamified AS isGamified, s.note AS note,
         s.created_at AS createdAt, s.team_id AS teamId, s.student_user_id AS studentUserId,
         u.display_name AS studentName
       FROM scores s
       LEFT JOIN users u ON u.id = s.student_user_id
       WHERE s.id = ?`,
    )
    .get(result.lastInsertRowid);

  emitScoreAwarded(teamId, {
    score,
    isGamified: !!isGamified,
    teamTotal: teamTotal(teamId),
    studentTotal: studentUserId ? studentTotal(studentUserId) : null,
  });

  if (isLeaderboardEnabled()) {
    emitLeaderboardUpdate(computeLeaderboard());
  }

  res.status(201).json({ score });
});

export default router;
