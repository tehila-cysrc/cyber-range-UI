import { Router } from 'express';
import { db } from '../../db/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../authz/requirePermission.js';
import { assertScenarioInScope } from '../../authz/resolve.js';
import { writeAudit } from '../../services/audit.service.js';

const router = Router();

router.use(requireAuth);

router.get('/cyber-ranges/:cyberRangeId/pressure-thresholds', requirePermission('scenario.inspect'), (req, res) => {
  if (!assertScenarioInScope(req, res, Number(req.params.cyberRangeId))) return;
  const thresholds = db
    .prepare(
      `SELECT id, label, trigger_seconds_remaining AS triggerSecondsRemaining, visual_style AS visualStyle
       FROM pressure_stages WHERE cyber_range_id = ? ORDER BY trigger_seconds_remaining DESC`,
    )
    .all(Number(req.params.cyberRangeId));
  res.json({ thresholds });
});

router.post('/cyber-ranges/:cyberRangeId/pressure-thresholds', requirePermission('scenario.author'), (req, res) => {
  const cyberRangeId = Number(req.params.cyberRangeId);
  if (!db.prepare('SELECT 1 FROM cyber_ranges WHERE id = ?').get(cyberRangeId)) {
    res.status(404).json({ error: 'cyber range not found' });
    return;
  }
  if (!assertScenarioInScope(req, res, cyberRangeId)) return;
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
    .run(cyberRangeId, label, triggerSecondsRemaining, visualStyle ?? 'amber');
  writeAudit(req.user!.username, 'pressure_stage.created', 'pressure_stage', Number(result.lastInsertRowid), { label }, { cyberRangeId });

  res.status(201).json({ id: result.lastInsertRowid });
});

// The stage's own scenario decides scope — the URL carries no scenario to trust.
router.delete('/pressure-thresholds/:id', requirePermission('scenario.author'), (req, res) => {
  const id = Number(req.params.id);
  const stage = db.prepare('SELECT cyber_range_id AS cyberRangeId FROM pressure_stages WHERE id = ?').get(id) as
    | { cyberRangeId: number }
    | undefined;
  if (!stage) {
    res.status(404).json({ error: 'pressure threshold not found' });
    return;
  }
  if (!assertScenarioInScope(req, res, stage.cyberRangeId, 'pressure threshold')) return;
  db.prepare('DELETE FROM pressure_stages WHERE id = ?').run(id);
  writeAudit(req.user!.username, 'pressure_stage.deleted', 'pressure_stage', id, null, { cyberRangeId: stage.cyberRangeId });
  res.json({ ok: true });
});

export default router;
