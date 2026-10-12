import { Router } from 'express';
import { db } from '../../db/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../authz/requirePermission.js';
import { assertScenarioInScope } from '../../authz/resolve.js';
import { writeAudit } from '../../services/audit.service.js';
import {
  VALID_DIFFICULTIES,
  deleteCyberRange,
  insertCyberRange,
  normalizeBriefing,
  validateNewCyberRange,
} from '../../services/cyberRangeCatalog.service.js';

const router = Router();

router.use(requireAuth);

const SELECT_DETAILS = `
  SELECT cr.id AS id, cr.name AS name, cr.difficulty AS difficulty, cr.day_id AS dayId,
         cr.expected_duration_minutes AS expectedDurationMinutes, cr.student_briefing AS studentBriefing,
         d.key AS dayKey, d.label AS dayLabel
  FROM cyber_ranges cr JOIN days d ON d.id = cr.day_id
  WHERE cr.id = ?`;

router.get('/days', requirePermission('scenario.inspect'), (_req, res) => {
  const days = db.prepare('SELECT id, key, label FROM days ORDER BY sort_order').all();
  res.json({ days });
});

// Instructor-authored catalog entry — the seeded catalog is just a starting point, not a fixed list;
// an instructor can add a new Cyber Range at any time (e.g. from the Environments registration flow).
router.post('/cyber-ranges', requirePermission('scenario.create'), (req, res) => {
  const invalid = validateNewCyberRange(req.body);
  if (invalid) {
    res.status(400).json({ error: invalid });
    return;
  }
  const { dayId, name, difficulty, expectedDurationMinutes, studentBriefing } = req.body;
  const id = insertCyberRange({ dayId, name, difficulty, expectedDurationMinutes, studentBriefing });
  writeAudit(req.user!.username, 'cyber_range.created', 'cyber_range', id, { name }, { cyberRangeId: id });

  const cyberRange = db
    .prepare(
      `SELECT cr.id AS id, cr.name AS name, cr.difficulty AS difficulty,
              cr.expected_duration_minutes AS expectedDurationMinutes,
              d.key AS dayKey, d.label AS dayLabel
       FROM cyber_ranges cr JOIN days d ON d.id = cr.day_id
       WHERE cr.id = ?`,
    )
    .get(id);

  res.status(201).json({ cyberRange });
});

// Scenario details for the Scenarios page (UX-08/UX-37): name, track, difficulty, duration and the
// instructor-written student briefing.
router.get('/cyber-ranges/:id', requirePermission('scenario.inspect'), (req, res) => {
  if (!assertScenarioInScope(req, res, Number(req.params.id))) return;
  const cyberRange = db.prepare(SELECT_DETAILS).get(Number(req.params.id));
  if (!cyberRange) {
    res.status(404).json({ error: 'cyber range not found' });
    return;
  }
  res.json({ cyberRange });
});

// Scenario content is shared by every organization that runs it (decision 2026-10-07): an assigned
// instructor's edit applies to all of them, and is audited.
router.patch('/cyber-ranges/:id', requirePermission('scenario.author'), (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM cyber_ranges WHERE id = ?').get(id)) {
    res.status(404).json({ error: 'cyber range not found' });
    return;
  }
  if (!assertScenarioInScope(req, res, id)) return;
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
  if (sets.length) {
    db.prepare(`UPDATE cyber_ranges SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
    writeAudit(req.user!.username, 'cyber_range.updated', 'cyber_range', id, { changes: Object.keys(req.body ?? {}) }, { cyberRangeId: id });
  }
  res.json({ cyberRange: db.prepare(SELECT_DETAILS).get(id) });
});

// Scenarios page "Delete scenario" — see deleteCyberRange for what blocks it.
router.delete('/cyber-ranges/:id', requirePermission('scenario.delete'), (req, res) => {
  const result = deleteCyberRange(Number(req.params.id), req.user!.username);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json({ ok: true });
});

export default router;
