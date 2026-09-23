import { Router } from 'express';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { teamHasProgressOn } from '../services/cyberRangeProgress.service.js';

const router = Router();

router.use(requireAuth);

// Read-only viewer data — US-004. Topology is CONFIG (tied to the cyber range, not a team), so any
// authenticated user may read it; there is nothing team-specific to leak here. Only the *node
// visibility* filter differs by role: a student never receives a node the instructor hasn't marked
// is_visible_to_students, enforced here (server-side), not just hidden client-side.
router.get('/cyber-ranges/:cyberRangeId/topology', (req, res) => {
  const cyberRangeId = Number(req.params.cyberRangeId);
  const isInstructor = req.user!.role === 'instructor';

  // A student may only look at scenarios their team has actually been assigned — otherwise any
  // student could preview the next day's range (hosts, IPs, zones) before the instructor starts it.
  if (!isInstructor && (!req.user!.teamId || !teamHasProgressOn(req.user!.teamId, cyberRangeId))) {
    res.status(403).json({ error: 'this Cyber Range is not assigned to your team' });
    return;
  }

  const zones = db
    .prepare(
      `SELECT id, external_key AS externalKey, name, cidr, sort_order AS sortOrder
       FROM topology_zones WHERE cyber_range_id = ? ORDER BY sort_order, name`,
    )
    .all(cyberRangeId);

  const nodes = db
    .prepare(
      `SELECT tn.id AS id, tn.external_key AS externalKey, tn.label AS label, tn.node_type AS nodeType, tn.role AS role,
              tn.zone_id AS zoneId, tn.status AS status, tn.pos_x AS posX, tn.pos_y AS posY, tn.metadata_json AS metadataJson,
              tn.environment_id AS environmentId, tn.is_visible_to_students AS isVisibleToStudents,
              (at.id IS NOT NULL) AS hasAccessTarget
       FROM topology_nodes tn LEFT JOIN access_targets at ON at.topology_node_id = tn.id
       WHERE tn.cyber_range_id = ?${isInstructor ? '' : ' AND tn.is_visible_to_students = 1'}`,
    )
    .all(cyberRangeId);

  // A student must never even see a reference to a hidden node's id, so an edge touching one is
  // dropped server-side too — the frontend's own filtering is a rendering convenience, not the
  // security boundary.
  const edges = db
    .prepare(
      `SELECT te.id AS id, te.from_node_id AS fromNodeId, te.to_node_id AS toNodeId,
              te.from_zone_id AS fromZoneId, te.to_zone_id AS toZoneId, te.label
       FROM topology_edges te
       LEFT JOIN topology_nodes fn ON fn.id = te.from_node_id
       LEFT JOIN topology_nodes tn ON tn.id = te.to_node_id
       WHERE te.cyber_range_id = ?${
         isInstructor
           ? ''
           : ' AND (fn.id IS NULL OR fn.is_visible_to_students = 1) AND (tn.id IS NULL OR tn.is_visible_to_students = 1)'
       }`,
    )
    .all(cyberRangeId);

  res.json({ zones, nodes, edges });
});

export default router;
