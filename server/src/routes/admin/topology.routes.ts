import { Router } from 'express';
import { db } from '../../db/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { writeAudit } from '../../services/audit.service.js';
import { getResolvedCredential } from '../../services/environments.service.js';
import { deleteVmLoginSecret, storeVmLoginSecret, vmLoginSecretName } from '../../services/keyVaultCredential.service.js';

const router = Router();

router.use(requireAuth, requireRole('instructor'));

router.post('/cyber-ranges/:cyberRangeId/topology/nodes', (req, res) => {
  const cyberRangeId = Number(req.params.cyberRangeId);
  const { label, nodeType, posX, posY, metadata, role, zoneId } = req.body ?? {};

  if (typeof label !== 'string' || typeof nodeType !== 'string') {
    res.status(400).json({ error: 'label and nodeType are required' });
    return;
  }

  const result = db
    .prepare(
      `INSERT INTO topology_nodes (cyber_range_id, external_key, label, node_type, pos_x, pos_y, metadata_json, role, zone_id, is_visible_to_students)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    )
    .run(
      cyberRangeId,
      'pending',
      label,
      nodeType,
      posX ?? 0,
      posY ?? 0,
      metadata ? JSON.stringify(metadata) : null,
      typeof role === 'string' ? role : null,
      typeof zoneId === 'number' ? zoneId : null,
    );

  const id = result.lastInsertRowid as number;
  db.prepare('UPDATE topology_nodes SET external_key = ? WHERE id = ?').run(String(id), id);

  const node = db
    .prepare(
      `SELECT id, external_key AS externalKey, label, node_type AS nodeType, role, zone_id AS zoneId,
              pos_x AS posX, pos_y AS posY, metadata_json AS metadataJson, is_visible_to_students AS isVisibleToStudents
       FROM topology_nodes WHERE id = ?`,
    )
    .get(id);

  res.status(201).json({ node });
});

router.patch('/cyber-ranges/:cyberRangeId/topology/nodes/:nodeId', (req, res) => {
  const nodeId = Number(req.params.nodeId);
  const { label, nodeType, posX, posY, role, zoneId, isVisibleToStudents, status } = req.body ?? {};

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
       pos_y = COALESCE(?, pos_y),
       role = COALESCE(?, role),
       zone_id = COALESCE(?, zone_id),
       is_visible_to_students = COALESCE(?, is_visible_to_students),
       status = COALESCE(?, status)
     WHERE id = ?`,
  ).run(
    label ?? null,
    nodeType ?? null,
    posX ?? null,
    posY ?? null,
    typeof role === 'string' ? role : null,
    typeof zoneId === 'number' ? zoneId : null,
    typeof isVisibleToStudents === 'boolean' ? (isVisibleToStudents ? 1 : 0) : null,
    typeof status === 'string' ? status : null,
    nodeId,
  );

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

// Access target config (Phase 4, now Bastion Shareable Link + Key Vault-backed — Phase 2). Makes a
// node connectable: stores the VM's login credential in the environment's Key Vault (never locally)
// and derives protocol/host from the node's own discovered metadata rather than trusting instructor
// input for values Bastion doesn't actually need picked (it auto-detects RDP vs SSH per VM). Only
// instructors can configure this; the credential is write-only (never read back — see
// CLAUDE/invariants.md, same rule as cloud_environments' Service Principal secret).
router.put('/topology/nodes/:nodeId/access-target', async (req, res) => {
  const nodeId = Number(req.params.nodeId);
  const { username, password } = req.body ?? {};

  if (typeof username !== 'string' || !username.trim() || typeof password !== 'string' || !password) {
    res.status(400).json({ error: 'username and password are required' });
    return;
  }

  const node = db
    .prepare(
      `SELECT tn.metadata_json AS metadataJson, tn.environment_id AS environmentId, ce.key_vault_uri AS keyVaultUri
       FROM topology_nodes tn LEFT JOIN cloud_environments ce ON ce.id = tn.environment_id
       WHERE tn.id = ?`,
    )
    .get(nodeId) as { metadataJson: string | null; environmentId: number | null; keyVaultUri: string | null } | undefined;

  if (!node) {
    res.status(404).json({ error: 'node not found' });
    return;
  }
  if (!node.environmentId || !node.keyVaultUri) {
    res
      .status(400)
      .json({ error: 'this node has no Azure environment/Key Vault registered — browser access requires an Azure-discovered VM (run discovery first)' });
    return;
  }

  const credential = getResolvedCredential(node.environmentId);
  if (!credential) {
    res.status(500).json({ error: 'could not resolve the environment credential' });
    return;
  }

  const metadata = node.metadataJson ? JSON.parse(node.metadataJson) : {};
  const protocol: 'rdp' | 'ssh' = metadata.osType === 'Linux' ? 'ssh' : 'rdp';
  const host = typeof metadata.privateIpAddress === 'string' ? metadata.privateIpAddress : 'unknown';
  const port = protocol === 'ssh' ? 22 : 3389;
  const secretName = vmLoginSecretName(nodeId);

  try {
    await storeVmLoginSecret(credential, node.keyVaultUri, secretName, password);
  } catch {
    res.status(502).json({ error: 'failed to store the credential in Key Vault' });
    return;
  }

  db.prepare(
    `INSERT INTO access_targets (topology_node_id, protocol, host, port, username, key_vault_secret_name) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (topology_node_id) DO UPDATE SET
       protocol = excluded.protocol, host = excluded.host, port = excluded.port,
       username = excluded.username, key_vault_secret_name = excluded.key_vault_secret_name`,
  ).run(nodeId, protocol, host, port, username.trim(), secretName);

  writeAudit(req.user!.username, 'access_target.configured', 'topology_node', nodeId, { protocol, host, storage: 'key_vault' });
  res.status(201).json({ ok: true });
});

router.get('/topology/nodes/:nodeId/access-target', (req, res) => {
  const nodeId = Number(req.params.nodeId);
  const target = db
    .prepare(
      'SELECT protocol, host, port, username, credential_id AS credentialId, key_vault_secret_name AS keyVaultSecretName FROM access_targets WHERE topology_node_id = ?',
    )
    .get(nodeId) as
    | { protocol: string; host: string; port: number; username: string | null; credentialId: number | null; keyVaultSecretName: string | null }
    | undefined;

  if (!target) {
    res.json({ accessTarget: null });
    return;
  }
  res.json({
    accessTarget: {
      protocol: target.protocol,
      host: target.host,
      port: target.port,
      username: target.username,
      hasCredential: target.credentialId != null || target.keyVaultSecretName != null,
    },
  });
});

router.delete('/topology/nodes/:nodeId/access-target', async (req, res) => {
  const nodeId = Number(req.params.nodeId);
  const existing = db
    .prepare(
      `SELECT at.key_vault_secret_name AS keyVaultSecretName, tn.environment_id AS environmentId, ce.key_vault_uri AS keyVaultUri
       FROM access_targets at
       JOIN topology_nodes tn ON tn.id = at.topology_node_id
       LEFT JOIN cloud_environments ce ON ce.id = tn.environment_id
       WHERE at.topology_node_id = ?`,
    )
    .get(nodeId) as { keyVaultSecretName: string | null; environmentId: number | null; keyVaultUri: string | null } | undefined;

  const result = db.prepare('DELETE FROM access_targets WHERE topology_node_id = ?').run(nodeId);
  if (result.changes === 0) {
    res.status(404).json({ error: 'no access target configured for this node' });
    return;
  }

  if (existing?.keyVaultSecretName && existing.environmentId && existing.keyVaultUri) {
    try {
      const credential = getResolvedCredential(existing.environmentId);
      if (credential) await deleteVmLoginSecret(credential, existing.keyVaultUri, existing.keyVaultSecretName);
    } catch (err) {
      console.error(`[topology] failed to delete Key Vault secret for node ${nodeId}:`, (err as Error).message);
    }
  }

  writeAudit(req.user!.username, 'access_target.removed', 'topology_node', nodeId, null);
  res.json({ ok: true });
});

// Each side of an edge is either a node or a zone (never both, never neither) — lets an instructor
// draw a boundary like Internet -> Firewall -> Zone, not just node-to-node lines. Mirrored by the
// CHECK constraints on topology_edges itself (belt-and-suspenders, not just app-level validation).
router.post('/cyber-ranges/:cyberRangeId/topology/edges', (req, res) => {
  const cyberRangeId = Number(req.params.cyberRangeId);
  const { fromNodeId, toNodeId, fromZoneId, toZoneId, label } = req.body ?? {};

  const fromOk = (!!fromNodeId) !== (!!fromZoneId);
  const toOk = (!!toNodeId) !== (!!toZoneId);
  if (!fromOk || !toOk) {
    res.status(400).json({ error: 'each side of an edge needs exactly one of a node id or a zone id' });
    return;
  }

  const result = db
    .prepare(
      `INSERT INTO topology_edges (cyber_range_id, from_node_id, to_node_id, from_zone_id, to_zone_id, label)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(cyberRangeId, fromNodeId ?? null, toNodeId ?? null, fromZoneId ?? null, toZoneId ?? null, label ?? null);

  const edge = db
    .prepare(
      'SELECT id, from_node_id AS fromNodeId, to_node_id AS toNodeId, from_zone_id AS fromZoneId, to_zone_id AS toZoneId, label FROM topology_edges WHERE id = ?',
    )
    .get(result.lastInsertRowid);

  res.status(201).json({ edge });
});

router.delete('/cyber-ranges/:cyberRangeId/topology/edges/:edgeId', (req, res) => {
  db.prepare('DELETE FROM topology_edges WHERE id = ?').run(Number(req.params.edgeId));
  res.json({ ok: true });
});

// Zones — the visual grouping container. Auto-created one-per-Azure-subnet by discovery; these
// endpoints cover the manual side (a hand-added zone for a manual-only cyber range, or renaming an
// auto-created one).
router.post('/cyber-ranges/:cyberRangeId/topology/zones', (req, res) => {
  const cyberRangeId = Number(req.params.cyberRangeId);
  const { name, cidr } = req.body ?? {};

  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  const result = db
    .prepare('INSERT INTO topology_zones (cyber_range_id, name, cidr) VALUES (?, ?, ?)')
    .run(cyberRangeId, name.trim(), typeof cidr === 'string' && cidr.trim() ? cidr.trim() : null);

  const zone = db
    .prepare('SELECT id, external_key AS externalKey, name, cidr, sort_order AS sortOrder FROM topology_zones WHERE id = ?')
    .get(result.lastInsertRowid);

  res.status(201).json({ zone });
});

router.patch('/cyber-ranges/:cyberRangeId/topology/zones/:zoneId', (req, res) => {
  const zoneId = Number(req.params.zoneId);
  const { name, cidr, sortOrder } = req.body ?? {};

  const existing = db.prepare('SELECT id FROM topology_zones WHERE id = ?').get(zoneId);
  if (!existing) {
    res.status(404).json({ error: 'zone not found' });
    return;
  }

  db.prepare(
    `UPDATE topology_zones SET
       name = COALESCE(?, name),
       cidr = COALESCE(?, cidr),
       sort_order = COALESCE(?, sort_order)
     WHERE id = ?`,
  ).run(typeof name === 'string' && name.trim() ? name.trim() : null, cidr ?? null, typeof sortOrder === 'number' ? sortOrder : null, zoneId);

  res.json({ ok: true });
});

// Deleting a zone un-assigns (doesn't delete) any node placed in it — a zone is just a grouping
// container, so removing it shouldn't take hosts down with it.
router.delete('/cyber-ranges/:cyberRangeId/topology/zones/:zoneId', (req, res) => {
  const zoneId = Number(req.params.zoneId);
  db.prepare('UPDATE topology_nodes SET zone_id = NULL WHERE zone_id = ?').run(zoneId);
  db.prepare('DELETE FROM topology_edges WHERE from_zone_id = ? OR to_zone_id = ?').run(zoneId, zoneId);
  db.prepare('DELETE FROM topology_zones WHERE id = ?').run(zoneId);
  res.json({ ok: true });
});

export default router;
