import { Router } from 'express';
import { db } from '../../db/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';

const router = Router();

router.use(requireAuth, requireRole('instructor'));

const VALID_DIFFICULTIES = ['intermediate', 'advanced'];

router.get('/days', (_req, res) => {
  const days = db.prepare('SELECT id, key, label FROM days ORDER BY sort_order').all();
  res.json({ days });
});

// Instructor-authored catalog entry — the seeded catalog is just a starting point, not a fixed list;
// an instructor can add a new Cyber Range at any time (e.g. from the Environments registration flow).
router.post('/cyber-ranges', (req, res) => {
  const { dayId, name, difficulty, expectedDurationMinutes } = req.body ?? {};

  if (typeof dayId !== 'number' || typeof name !== 'string' || !name.trim() || !VALID_DIFFICULTIES.includes(difficulty)) {
    res.status(400).json({ error: `dayId (number), name (string) and difficulty ('intermediate'|'advanced') are required` });
    return;
  }

  const day = db.prepare('SELECT id FROM days WHERE id = ?').get(dayId);
  if (!day) {
    res.status(400).json({ error: 'unknown dayId' });
    return;
  }

  const { maxSort } = db
    .prepare('SELECT COALESCE(MAX(sort_order), 0) AS maxSort FROM cyber_ranges WHERE day_id = ?')
    .get(dayId) as { maxSort: number };

  const result = db
    .prepare(
      `INSERT INTO cyber_ranges (day_id, name, difficulty, expected_duration_minutes, sort_order)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(dayId, name.trim(), difficulty, expectedDurationMinutes ?? null, maxSort + 1);

  const cyberRange = db
    .prepare(
      `SELECT cr.id AS id, cr.name AS name, cr.difficulty AS difficulty,
              cr.expected_duration_minutes AS expectedDurationMinutes,
              d.key AS dayKey, d.label AS dayLabel
       FROM cyber_ranges cr JOIN days d ON d.id = cr.day_id
       WHERE cr.id = ?`,
    )
    .get(result.lastInsertRowid);

  res.status(201).json({ cyberRange });
});

export default router;
