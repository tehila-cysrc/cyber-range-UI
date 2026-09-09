import { Router } from 'express';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { emitDocumentationNew } from '../sockets/emitters.js';

const router = Router();

router.use(requireAuth);

router.get('/documentation-categories', (_req, res) => {
  const categories = db
    .prepare(
      'SELECT id, key, label FROM documentation_categories WHERE active = 1 ORDER BY sort_order',
    )
    .all();
  res.json({ categories });
});

function resolveTeamId(req: import('express').Request, res: import('express').Response): number | null {
  if (req.user!.role === 'instructor') {
    const teamId = Number(req.query.teamId);
    if (!teamId) {
      res.status(400).json({ error: 'instructor must pass ?teamId=' });
      return null;
    }
    return teamId;
  }
  if (!req.user!.teamId) {
    res.status(409).json({ error: 'user has no team assigned' });
    return null;
  }
  return req.user!.teamId;
}

router.get('/cyber-ranges/:cyberRangeId/documentation', (req, res) => {
  const teamId = resolveTeamId(req, res);
  if (teamId === null) return;

  const entries = db
    .prepare(
      `SELECT
         e.id AS id,
         e.body AS body,
         e.is_important_finding AS isImportantFinding,
         e.created_at AS createdAt,
         u.id AS authorUserId,
         u.display_name AS authorName,
         c.key AS categoryKey,
         c.label AS categoryLabel
       FROM documentation_entries e
       JOIN users u ON u.id = e.author_user_id
       LEFT JOIN documentation_categories c ON c.id = e.category_id
       WHERE e.team_id = ? AND e.cyber_range_id = ?
       ORDER BY e.created_at ASC`,
    )
    .all(teamId, Number(req.params.cyberRangeId));

  res.json({ entries });
});

router.post('/cyber-ranges/:cyberRangeId/documentation', (req, res) => {
  // Students only document their own team's investigation; instructors don't author entries.
  if (req.user!.role !== 'student' || !req.user!.teamId) {
    res.status(403).json({ error: 'only a student on a team can add documentation' });
    return;
  }

  const { body, categoryId, isImportantFinding } = req.body ?? {};
  if (typeof body !== 'string' || body.trim().length === 0) {
    res.status(400).json({ error: 'body is required' });
    return;
  }

  const createdAt = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO documentation_entries
         (team_id, cyber_range_id, author_user_id, category_id, body, is_important_finding, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      req.user!.teamId,
      Number(req.params.cyberRangeId),
      req.user!.id,
      categoryId ?? null,
      body.trim(),
      isImportantFinding ? 1 : 0,
      createdAt,
    );

  const entry = db
    .prepare(
      `SELECT
         e.id AS id,
         e.body AS body,
         e.is_important_finding AS isImportantFinding,
         e.created_at AS createdAt,
         u.id AS authorUserId,
         u.display_name AS authorName,
         c.key AS categoryKey,
         c.label AS categoryLabel
       FROM documentation_entries e
       JOIN users u ON u.id = e.author_user_id
       LEFT JOIN documentation_categories c ON c.id = e.category_id
       WHERE e.id = ?`,
    )
    .get(result.lastInsertRowid);

  emitDocumentationNew(req.user!.teamId, entry);

  res.status(201).json({ entry });
});

export default router;
