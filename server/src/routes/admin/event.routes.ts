import { Router } from 'express';
import { db } from '../../db/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  getActiveEventRunId,
  createFreshEventRun,
  DEFAULT_INSTRUCTOR_USERNAME,
  DEFAULT_INSTRUCTOR_PASSWORD,
} from '../../db/seed.js';

const router = Router();

router.use(requireAuth, requireRole('instructor'));

const CONFIRMATION_PHRASE = 'RESET EVENT';

// Wipes every RUN table (teams, users, auth_tokens, progress, documentation, scores, help_requests)
// by deleting the active event_runs row — ON DELETE CASCADE does the rest — then creates a fresh
// empty run with one instructor account, so the system is immediately usable for a new cohort.
// CONFIG tables (cyber_ranges, days, topology, categories, scoring_config, pressure_stages) are
// never touched; see CLAUDE/invariants.md for why that split makes this safe by construction.
router.post('/event/reset', (req, res) => {
  const { confirm } = req.body ?? {};
  if (confirm !== CONFIRMATION_PHRASE) {
    res.status(400).json({ error: `confirm must be exactly "${CONFIRMATION_PHRASE}"` });
    return;
  }

  const activeRunId = getActiveEventRunId();

  db.exec('BEGIN');
  try {
    if (activeRunId !== null) {
      db.prepare('DELETE FROM event_runs WHERE id = ?').run(activeRunId);
    }
    const newRunId = createFreshEventRun();
    db.exec('COMMIT');

    res.json({
      ok: true,
      newEventRunId: newRunId,
      newInstructor: { username: DEFAULT_INSTRUCTOR_USERNAME, password: DEFAULT_INSTRUCTOR_PASSWORD },
      note: 'Your session token was just deleted along with the old run — log in again with the credentials above.',
    });
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
});

export default router;
