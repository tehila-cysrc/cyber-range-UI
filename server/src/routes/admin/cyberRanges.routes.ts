import { Router } from 'express';
import { db } from '../../db/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';

const router = Router();

router.use(requireAuth, requireRole('instructor'));

const VALID_DIFFICULTIES = ['intermediate', 'advanced'];
const MAX_BRIEFING_LENGTH = 4000;

function normalizeBriefing(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, MAX_BRIEFING_LENGTH) : null;
}

const SELECT_DETAILS = `
  SELECT cr.id AS id, cr.name AS name, cr.difficulty AS difficulty, cr.day_id AS dayId,
         cr.expected_duration_minutes AS expectedDurationMinutes, cr.student_briefing AS studentBriefing,
         d.key AS dayKey, d.label AS dayLabel
  FROM cyber_ranges cr JOIN days d ON d.id = cr.day_id
  WHERE cr.id = ?`;

router.get('/days', (_req, res) => {
  const days = db.prepare('SELECT id, key, label FROM days ORDER BY sort_order').all();
  res.json({ days });
});

// Instructor-authored catalog entry — the seeded catalog is just a starting point, not a fixed list;
// an instructor can add a new Cyber Range at any time (e.g. from the Environments registration flow).
router.post('/cyber-ranges', (req, res) => {
  const { dayId, name, difficulty, expectedDurationMinutes, studentBriefing } = req.body ?? {};

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
      `INSERT INTO cyber_ranges (day_id, name, difficulty, expected_duration_minutes, sort_order, student_briefing)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(dayId, name.trim(), difficulty, expectedDurationMinutes ?? null, maxSort + 1, normalizeBriefing(studentBriefing));

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

// Scenario details for the Scenarios page (UX-08/UX-37): name, track, difficulty, duration and the
// instructor-written student briefing.
router.get('/cyber-ranges/:id', (req, res) => {
  const cyberRange = db.prepare(SELECT_DETAILS).get(Number(req.params.id));
  if (!cyberRange) {
    res.status(404).json({ error: 'cyber range not found' });
    return;
  }
  res.json({ cyberRange });
});

router.patch('/cyber-ranges/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM cyber_ranges WHERE id = ?').get(id)) {
    res.status(404).json({ error: 'cyber range not found' });
    return;
  }
  const { name, dayId, difficulty, expectedDurationMinutes, studentBriefing } = req.body ?? {};
  if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
    res.status(400).json({ error: 'name must be a non-empty string' });
    return;
  }
  if (difficulty !== undefined && !VALID_DIFFICULTIES.includes(difficulty)) {
    res.status(400).json({ error: "difficulty must be 'intermediate' or 'advanced'" });
    return;
  }
  if (dayId !== undefined && !db.prepare('SELECT 1 FROM days WHERE id = ?').get(dayId)) {
    res.status(400).json({ error: 'unknown dayId' });
    return;
  }
  if (
    expectedDurationMinutes !== undefined &&
    expectedDurationMinutes !== null &&
    (!Number.isInteger(expectedDurationMinutes) || expectedDurationMinutes < 1 || expectedDurationMinutes > 24 * 60)
  ) {
    res.status(400).json({ error: 'expectedDurationMinutes must be a whole number of minutes (1–1440) or null' });
    return;
  }
  // Only the fields sent are changed. A running team's clock keeps its original time limit — a new
  // duration applies from the next (re)start.
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  if (name !== undefined) (sets.push('name = ?'), params.push(name.trim()));
  if (dayId !== undefined) (sets.push('day_id = ?'), params.push(dayId));
  if (difficulty !== undefined) (sets.push('difficulty = ?'), params.push(difficulty));
  if (expectedDurationMinutes !== undefined) (sets.push('expected_duration_minutes = ?'), params.push(expectedDurationMinutes));
  if (studentBriefing !== undefined) (sets.push('student_briefing = ?'), params.push(normalizeBriefing(studentBriefing)));
  if (sets.length) db.prepare(`UPDATE cyber_ranges SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  res.json({ cyberRange: db.prepare(SELECT_DETAILS).get(id) });
});

export default router;
