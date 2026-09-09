import { Router } from 'express';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

// Read-only catalog — used by the instructor admin UI to pick a range to start for a team.
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
       ORDER BY d.sort_order, cr.sort_order`,
    )
    .all();
  res.json({ cyberRanges: ranges });
});

export default router;
