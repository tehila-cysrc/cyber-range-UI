import { Router } from 'express';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { emitDocumentationNew } from '../sockets/emitters.js';
import { OTHER_CATEGORY_SORT_ORDER } from '../db/seed.js';
import { activeCyberRangeIdForTeam } from '../services/cyberRangeProgress.service.js';

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
         e.image_data_url AS imageDataUrl,
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

// Free-text categories (e.g. a student typing "IOC" or something not in the seeded list) are
// find-or-created here rather than requiring an instructor to pre-configure every category —
// documentation_categories is CONFIG data, so it survives an event reset and benefits future runs.
const MAX_IMAGE_DATA_URL_LENGTH = 6_000_000; // ~4.5MB raw image, generous for a screenshot

function slugifyCategoryKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function findOrCreateCategoryId(label: string): number | null {
  const key = slugifyCategoryKey(label);
  if (!key) return null;

  const existing = db.prepare('SELECT id FROM documentation_categories WHERE key = ?').get(key) as
    | { id: number }
    | undefined;
  if (existing) return existing.id;

  // Excludes 'other' from the max so a free-typed category always sorts before it, never after —
  // see OTHER_CATEGORY_SORT_ORDER's comment in db/seed.ts.
  const nextSort = db
    .prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM documentation_categories WHERE key != 'other'")
    .get() as { n: number };
  const clampedSort = Math.min(nextSort.n, OTHER_CATEGORY_SORT_ORDER - 1);

  const result = db
    .prepare('INSERT INTO documentation_categories (key, label, sort_order, active) VALUES (?, ?, ?, 1)')
    .run(key, label.trim(), clampedSort);

  return Number(result.lastInsertRowid);
}

router.post('/cyber-ranges/:cyberRangeId/documentation', (req, res) => {
  // Students only document their own team's investigation; instructors don't author entries.
  if (req.user!.role !== 'student' || !req.user!.teamId) {
    res.status(403).json({ error: 'only a student on a team can add documentation' });
    return;
  }

  const { body, categoryId, newCategoryLabel, isImportantFinding, imageDataUrl } = req.body ?? {};
  if (typeof body !== 'string' || body.trim().length === 0) {
    res.status(400).json({ error: 'body is required' });
    return;
  }

  if (imageDataUrl != null) {
    if (typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:image/')) {
      res.status(400).json({ error: 'imageDataUrl must be a data:image/... URL' });
      return;
    }
    if (imageDataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
      res.status(400).json({ error: 'image is too large' });
      return;
    }
  }

  const cyberRangeId = Number(req.params.cyberRangeId);
  if (activeCyberRangeIdForTeam(req.user!.teamId) !== cyberRangeId) {
    res.status(409).json({ error: "this isn't your team's active Cyber Range — refresh the page" });
    return;
  }

  let resolvedCategoryId: number | null = categoryId ?? null;
  if (typeof newCategoryLabel === 'string' && newCategoryLabel.trim().length > 0) {
    resolvedCategoryId = findOrCreateCategoryId(newCategoryLabel);
  } else if (resolvedCategoryId != null) {
    const exists = db
      .prepare('SELECT 1 FROM documentation_categories WHERE id = ? AND active = 1')
      .get(Number(resolvedCategoryId));
    if (!exists) {
      res.status(400).json({ error: 'unknown category' });
      return;
    }
  }

  const createdAt = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO documentation_entries
         (team_id, cyber_range_id, author_user_id, category_id, body, image_data_url, is_important_finding, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      req.user!.teamId,
      cyberRangeId,
      req.user!.id,
      resolvedCategoryId,
      body.trim(),
      imageDataUrl ?? null,
      isImportantFinding ? 1 : 0,
      createdAt,
    );

  const entry = db
    .prepare(
      `SELECT
         e.id AS id,
         e.body AS body,
         e.image_data_url AS imageDataUrl,
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
