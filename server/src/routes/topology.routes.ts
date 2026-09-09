import { Router } from 'express';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

// Read-only viewer data — US-004. Topology is CONFIG (tied to the cyber range, not a team), so any
// authenticated user may read it; there is nothing team-specific to leak here.
router.get('/cyber-ranges/:cyberRangeId/topology', (req, res) => {
  const cyberRangeId = Number(req.params.cyberRangeId);

  const nodes = db
    .prepare(
      `SELECT id, external_key AS externalKey, label, node_type AS nodeType,
              pos_x AS posX, pos_y AS posY, metadata_json AS metadataJson
       FROM topology_nodes WHERE cyber_range_id = ?`,
    )
    .all(cyberRangeId);

  const edges = db
    .prepare(
      `SELECT id, from_node_id AS fromNodeId, to_node_id AS toNodeId, label
       FROM topology_edges WHERE cyber_range_id = ?`,
    )
    .all(cyberRangeId);

  res.json({ nodes, edges });
});

export default router;
