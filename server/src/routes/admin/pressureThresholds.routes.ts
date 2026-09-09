import { Router } from 'express';
import { db } from '../../db/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';

const router = Router();

router.use(requireAuth, requireRole('instructor'));

router.get('/cyber-ranges/:cyberRangeId/pressure-thresholds', (req, res) => {
  const thresholds = db
    .prepare(
      `SELECT id, label, trigger_seconds_remaining AS triggerSecondsRemaining, visual_style AS visualStyle
       FROM pressure_stages WHERE cyber_range_id = ? ORDER BY trigger_seconds_remaining DESC`,
    )
    .all(Number(req.params.cyberRangeId));
  res.json({ thresholds });
});

router.post('/cyber-ranges/:cyberRangeId/pressure-thresholds', (req, res) => {
  const { label, triggerSecondsRemaining, visualStyle } = req.body ?? {};
  if (typeof label !== 'string' || typeof triggerSecondsRemaining !== 'number') {
    res.status(400).json({ error: 'label and triggerSecondsRemaining are required' });
    return;
  }

  const result = db
    .prepare(
      `INSERT INTO pressure_stages (cyber_range_id, label, trigger_seconds_remaining, visual_style)
       VALUES (?, ?, ?, ?)`,
    )
    .run(Number(req.params.cyberRangeId), label, triggerSecondsRemaining, visualStyle ?? 'amber');

  res.status(201).json({ id: result.lastInsertRowid });
});

router.delete('/pressure-thresholds/:id', (req, res) => {
  db.prepare('DELETE FROM pressure_stages WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

export default router;
