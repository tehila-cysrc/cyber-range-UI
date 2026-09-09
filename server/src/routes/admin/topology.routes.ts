import { Router } from 'express';
import { db } from '../../db/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';

const router = Router();

router.use(requireAuth, requireRole('instructor'));

router.post('/cyber-ranges/:cyberRangeId/topology/nodes', (req, res) => {
  const cyberRangeId = Number(req.params.cyberRangeId);
  const { label, nodeType, posX, posY, metadata } = req.body ?? {};

  if (typeof label !== 'string' || typeof nodeType !== 'string') {
    res.status(400).json({ error: 'label and nodeType are required' });
    return;
  }

  const result = db
    .prepare(
      `INSERT INTO topology_nodes (cyber_range_id, external_key, label, node_type, pos_x, pos_y, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      cyberRangeId,
      'pending',
      label,
      nodeType,
      posX ?? 0,
      posY ?? 0,
      metadata ? JSON.stringify(metadata) : null,
    );

  const id = result.lastInsertRowid as number;
  db.prepare('UPDATE topology_nodes SET external_key = ? WHERE id = ?').run(String(id), id);

  const node = db
    .prepare(
      `SELECT id, external_key AS externalKey, label, node_type AS nodeType,
              pos_x AS posX, pos_y AS posY, metadata_json AS metadataJson
       FROM topology_nodes WHERE id = ?`,
    )
    .get(id);

  res.status(201).json({ node });
});

router.patch('/cyber-ranges/:cyberRangeId/topology/nodes/:nodeId', (req, res) => {
  const nodeId = Number(req.params.nodeId);
  const { label, nodeType, posX, posY } = req.body ?? {};

  const existing = db.prepare('SELECT id FROM topology_nodes WHERE id = ?').get(nodeId);
  if (!existing) {
    res.status(404).json({ error: 'node not found' });
    return;
  }

  db.prepare(
    `UPDATE topology_nodes SET
       label = COALESCE(?, label),
       node_type = COALESCE(?, node_type),
       pos_x = COALESCE(?, pos_x),
       pos_y = COALESCE(?, pos_y)
     WHERE id = ?`,
  ).run(label ?? null, nodeType ?? null, posX ?? null, posY ?? null, nodeId);

  res.json({ ok: true });
});

router.delete('/cyber-ranges/:cyberRangeId/topology/nodes/:nodeId', (req, res) => {
  const nodeId = Number(req.params.nodeId);
  db.prepare('DELETE FROM topology_edges WHERE from_node_id = ? OR to_node_id = ?').run(nodeId, nodeId);
  db.prepare('DELETE FROM topology_nodes WHERE id = ?').run(nodeId);
  res.json({ ok: true });
});

router.post('/cyber-ranges/:cyberRangeId/topology/edges', (req, res) => {
  const cyberRangeId = Number(req.params.cyberRangeId);
  const { fromNodeId, toNodeId, label } = req.body ?? {};

  if (!fromNodeId || !toNodeId) {
    res.status(400).json({ error: 'fromNodeId and toNodeId are required' });
    return;
  }

  const result = db
    .prepare(
      `INSERT INTO topology_edges (cyber_range_id, from_node_id, to_node_id, label)
       VALUES (?, ?, ?, ?)`,
    )
    .run(cyberRangeId, fromNodeId, toNodeId, label ?? null);

  const edge = db
    .prepare(
      'SELECT id, from_node_id AS fromNodeId, to_node_id AS toNodeId, label FROM topology_edges WHERE id = ?',
    )
    .get(result.lastInsertRowid);

  res.status(201).json({ edge });
});

router.delete('/cyber-ranges/:cyberRangeId/topology/edges/:edgeId', (req, res) => {
  db.prepare('DELETE FROM topology_edges WHERE id = ?').run(Number(req.params.edgeId));
  res.json({ ok: true });
});

export default router;
