import { Router } from 'express';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

// Read-only catalog — used by the instructor admin UI to pick a range to start for a team, and by
// the Topology Admin picker. Only active ranges: a range is soft-hidden (is_active=0) rather than
// deleted once it's no longer meant to be picked from, since real history (progress/docs/scores) may
// already reference it and can't be cascaded away (see CLAUDE/db.md).
router.get('/cyber-ranges', (_req, res) => {
  const ranges = db
    .prepare(
      `SELECT
         cr.id AS id,
         cr.name AS name,
         cr.difficulty AS difficulty,
         cr.expected_duration_minutes AS expectedDurationMinutes,
         d.key AS dayKey,
         d.label AS dayLabel
       FROM cyber_ranges cr
       JOIN days d ON d.id = cr.day_id
       WHERE cr.is_active = 1
       ORDER BY d.sort_order, cr.sort_order`,
    )
    .all();
  res.json({ cyberRanges: ranges });
});

export default router;
