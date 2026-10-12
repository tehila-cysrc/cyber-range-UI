import { Router } from 'express';
import { db } from '../../db/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../authz/requirePermission.js';
import { assertPairInScope, assertTeamInScope, teamWorkWhere } from '../../authz/resolve.js';
import { teamOrganization } from '../../authz/scope.js';
import { writeAudit } from '../../services/audit.service.js';
import { emitScoreAwarded, emitLeaderboardUpdate } from '../../sockets/emitters.js';
import { teamTotal, studentTotal } from '../../services/scoring.service.js';

const router = Router();

router.use(requireAuth);

const MAX_POINTS_PER_AWARD = 1000;

// Instructor's view of one team's awards — lets the scoring panel show what each entry has already
// earned, so an instructor switching between teams mid-event doesn't double-award by accident.
router.get('/scores', requirePermission('score.read'), (req, res) => {
  const teamId = Number(req.query.teamId);
  if (!teamId) {
    res.status(400).json({ error: 'teamId is required' });
    return;
  }
  if (!assertTeamInScope(req, res, teamId)) return;
  // Awards on scenarios outside the caller's pairs stay hidden (team-level awards stay visible).
  const scoped = teamWorkWhere(req, 't.organization_id', 's.cyber_range_id');
  const entries = db
    .prepare(
      `SELECT
         s.id AS id, s.points AS points, s.is_gamified AS isGamified, s.note AS note,
         s.created_at AS createdAt, s.student_user_id AS studentUserId,
         s.documentation_entry_id AS documentationEntryId, s.cyber_range_id AS cyberRangeId,
         s.source AS source, u.display_name AS studentName
       FROM scores s
       JOIN teams t ON t.id = s.team_id
       LEFT JOIN users u ON u.id = s.student_user_id
       WHERE s.team_id = ? AND ${scoped.sql}
       ORDER BY s.created_at DESC`,
    )
    .all(teamId, ...scoped.params);
  res.json({ entries, teamTotal: teamTotal(teamId) });
});

// US-007: instructor gives free-form points against a documentation entry (or a standalone
// team-level award — no separate "milestones" entity, see CLAUDE/invariants.md).
router.post('/scores', requirePermission('score.award'), (req, res) => {
  const { teamId, studentUserId, documentationEntryId, cyberRangeId, points, isGamified, note } =
    req.body ?? {};

  if (!teamId || typeof points !== 'number') {
    res.status(400).json({ error: 'teamId and points are required' });
    return;
  }
  if (!Number.isInteger(points) || points === 0 || Math.abs(points) > MAX_POINTS_PER_AWARD) {
    res.status(400).json({ error: `points must be a non-zero whole number between -${MAX_POINTS_PER_AWARD} and ${MAX_POINTS_PER_AWARD}` });
    return;
  }
  if (note != null && (typeof note !== 'string' || note.length > 500)) {
    res.status(400).json({ error: 'note must be text of at most 500 characters' });
    return;
  }

  // Every id is cross-checked against the team, so a score can never be credited to a student of a
  // different team or hang off another team's documentation entry (the leaderboard and each team's
  // Progress page are computed from these rows — a mis-attributed row silently corrupts both).
  if (!assertTeamInScope(req, res, Number(teamId))) return;
  if (studentUserId != null && !db.prepare("SELECT 1 FROM users WHERE id = ? AND team_id = ? AND role = 'student' AND deactivated_at IS NULL").get(studentUserId, teamId)) {
    res.status(400).json({ error: 'that student is not a member of this team' });
    return;
  }
  let resolvedCyberRangeId: number | null = cyberRangeId ?? null;
  if (documentationEntryId != null) {
    const entry = db
      .prepare('SELECT cyber_range_id AS cyberRangeId FROM documentation_entries WHERE id = ? AND team_id = ?')
      .get(documentationEntryId, teamId) as { cyberRangeId: number } | undefined;
    if (!entry) {
      res.status(400).json({ error: "that documentation entry doesn't belong to this team" });
      return;
    }
    resolvedCyberRangeId = entry.cyberRangeId;
  }
  if (resolvedCyberRangeId != null && !db.prepare('SELECT 1 FROM cyber_ranges WHERE id = ?').get(resolvedCyberRangeId)) {
    res.status(404).json({ error: 'cyber range not found' });
    return;
  }
  // A scenario award needs the pair; a team-level award (no scenario) only the team.
  if (resolvedCyberRangeId != null && !assertPairInScope(req, res, Number(teamId), resolvedCyberRangeId)) return;

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
      resolvedCyberRangeId,
      points,
      isGamified ? 1 : 0,
      req.user!.id,
      typeof note === 'string' && note.trim() ? note.trim() : null,
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

  emitScoreAwarded(teamId, resolvedCyberRangeId, {
    score,
    isGamified: !!isGamified,
    teamTotal: teamTotal(teamId),
    studentTotal: studentUserId ? studentTotal(studentUserId) : null,
  });

  emitLeaderboardUpdate();
  writeAudit(req.user!.username, 'score.awarded', 'score', Number(result.lastInsertRowid), { teamId, points }, {
    organizationId: teamOrganization(Number(teamId))?.orgId ?? null,
    cyberRangeId: resolvedCyberRangeId,
  });

  res.status(201).json({ score });
});

export default router;
