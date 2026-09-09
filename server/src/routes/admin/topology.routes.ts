import { Router } from 'express';
import { db } from '../../db/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { rotateCredential, storeCredential } from '../../services/credential.service.js';
import { writeAudit } from '../../services/audit.service.js';

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
  db.prepare('DELETE FROM access_targets WHERE topology_node_id = ?').run(nodeId);
  try {
    db.prepare('DELETE FROM topology_nodes WHERE id = ?').run(nodeId);
  } catch {
    // Deliberately NOT cleaning up access_sessions here — a node with real historical access-session
    // rows shouldn't be silently deletable out from under its own audit trail (see CLAUDE/db.md).
    res.status(409).json({ error: 'this node has recorded access-session history and cannot be deleted' });
    return;
  }
  res.json({ ok: true });
});

// Access target config (Phase 4 — student browser access broker). Makes a node connectable: stores
// the VM's login credential (encrypted — see credential.service.ts) and where/how to reach it. Only
// instructors can configure this; the credential is write-only (never read back, same rule as
// cloud_environments' Service Principal secret — see CLAUDE/invariants.md).
router.put('/topology/nodes/:nodeId/access-target', (req, res) => {
  const nodeId = Number(req.params.nodeId);
  const { protocol, host, port, username, password } = req.body ?? {};

  if (
    (protocol !== 'rdp' && protocol !== 'ssh') ||
    typeof host !== 'string' ||
    typeof port !== 'number' ||
    typeof username !== 'string' ||
    typeof password !== 'string'
  ) {
    res.status(400).json({ error: 'protocol (rdp|ssh), host, port, username and password are required' });
    return;
  }

  const node = db.prepare('SELECT id FROM topology_nodes WHERE id = ?').get(nodeId);
  if (!node) {
    res.status(404).json({ error: 'node not found' });
    return;
  }

  // Rotate the existing credential in place on re-configure rather than minting a new row each time
  // and leaving the old one orphaned (same "one credential per target" intent as cloud_environments'
  // rotate-on-update behavior).
  const existing = db.prepare('SELECT credential_id AS credentialId FROM access_targets WHERE topology_node_id = ?').get(nodeId) as
    | { credentialId: number | null }
    | undefined;

  let credentialId: number;
  if (existing?.credentialId) {
    rotateCredential(existing.credentialId, password);
    db.prepare('UPDATE credentials SET metadata_json = ? WHERE id = ?').run(JSON.stringify({ username }), existing.credentialId);
    credentialId = existing.credentialId;
  } else {
    credentialId = storeCredential('vm_login', password, { username }, req.user!.username);
  }

  db.prepare(
    `INSERT INTO access_targets (topology_node_id, protocol, host, port, credential_id) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (topology_node_id) DO UPDATE SET protocol = excluded.protocol, host = excluded.host, port = excluded.port, credential_id = excluded.credential_id`,
  ).run(nodeId, protocol, host, port, credentialId);

  writeAudit(req.user!.username, 'access_target.configured', 'topology_node', nodeId, { protocol, host });
  res.status(201).json({ ok: true });
});

router.get('/topology/nodes/:nodeId/access-target', (req, res) => {
  const nodeId = Number(req.params.nodeId);
  const target = db
    .prepare('SELECT protocol, host, port, credential_id AS credentialId FROM access_targets WHERE topology_node_id = ?')
    .get(nodeId) as { protocol: string; host: string; port: number; credentialId: number | null } | undefined;

  if (!target) {
    res.json({ accessTarget: null });
    return;
  }
  res.json({ accessTarget: { protocol: target.protocol, host: target.host, port: target.port, hasCredential: target.credentialId != null } });
});

router.delete('/topology/nodes/:nodeId/access-target', (req, res) => {
  const nodeId = Number(req.params.nodeId);
  const result = db.prepare('DELETE FROM access_targets WHERE topology_node_id = ?').run(nodeId);
  if (result.changes === 0) {
    res.status(404).json({ error: 'no access target configured for this node' });
    return;
  }
  writeAudit(req.user!.username, 'access_target.removed', 'topology_node', nodeId, null);
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
