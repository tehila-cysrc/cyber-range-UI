import { Router } from 'express';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import {
  emitInvestigationCanvasNodeCreated,
  emitInvestigationCanvasNodeUpdated,
  emitInvestigationCanvasNodeDeleted,
  emitInvestigationCanvasEdgeCreated,
  emitInvestigationCanvasEdgeDeleted,
} from '../sockets/emitters.js';
import { activeCyberRangeIdForTeam } from '../services/cyberRangeProgress.service.js';

const router = Router();

// Must match the client's palette (canvasNodeSpec.ts) — the client looks the spec up by type, so one
// unknown value (e.g. from a hand-crafted request) crashed the canvas for every teammate and the
// instructor viewing that team.
const CANVAS_NODE_TYPES = new Set(['entry', 'system', 'evidence', 'finding', 'decision', 'action', 'impact']);
const MAX_LABEL_LENGTH = 200;
const MAX_BODY_LENGTH = 10_000;

router.use(requireAuth);

// Same shape as documentation.routes.ts's resolveTeamId: instructor must pass ?teamId= explicitly
// (never a merged cross-team view), a student implicitly gets their own team.
function resolveTeamId(req: import('express').Request, res: import('express').Response): number | null {
  if (req.user!.role === 'instructor') {
    const teamId = Number(req.query.teamId);
    if (!teamId) {
      res.status(400).json({ error: 'instructor must pass ?teamId=' });
      return null;
    }
    return teamId;
  }
  if (!req.user!.teamId) {
    res.status(409).json({ error: 'user has no team assigned' });
    return null;
  }
  return req.user!.teamId;
}

const NODE_SELECT = `
  SELECT
    n.id AS id,
    n.node_type AS nodeType,
    n.label AS label,
    n.body AS body,
    n.pos_x AS posX,
    n.pos_y AS posY,
    n.metadata_json AS metadataJson,
    n.author_user_id AS authorUserId,
    u.display_name AS authorName,
    n.created_at AS createdAt,
    n.updated_at AS updatedAt
  FROM investigation_canvas_nodes n
  JOIN users u ON u.id = n.author_user_id
`;

const EDGE_SELECT = `
  SELECT
    e.id AS id,
    e.from_node_id AS fromNodeId,
    e.to_node_id AS toNodeId,
    e.label AS label,
    e.author_user_id AS authorUserId,
    e.created_at AS createdAt
  FROM investigation_canvas_edges e
`;

router.get('/cyber-ranges/:cyberRangeId/investigation-canvas', (req, res) => {
  const teamId = resolveTeamId(req, res);
  if (teamId === null) return;
  const cyberRangeId = Number(req.params.cyberRangeId);

  const nodes = db
    .prepare(`${NODE_SELECT} WHERE n.team_id = ? AND n.cyber_range_id = ? ORDER BY n.created_at ASC`)
    .all(teamId, cyberRangeId);
  const edges = db
    .prepare(`${EDGE_SELECT} WHERE e.team_id = ? AND e.cyber_range_id = ? ORDER BY e.created_at ASC`)
    .all(teamId, cyberRangeId);

  res.json({ nodes, edges });
});

router.post('/cyber-ranges/:cyberRangeId/investigation-canvas/nodes', (req, res) => {
  // Students only build their own team's canvas; instructors view but never author it — same
  // authorship split as documentation_entries' Timeline.
  if (req.user!.role !== 'student' || !req.user!.teamId) {
    res.status(403).json({ error: 'only a student on a team can add canvas nodes' });
    return;
  }

  const { nodeType, label, body, posX, posY } = req.body ?? {};
  if (typeof nodeType !== 'string' || !nodeType.trim() || typeof label !== 'string' || !label.trim()) {
    res.status(400).json({ error: 'nodeType and label are required' });
    return;
  }
  if (!CANVAS_NODE_TYPES.has(nodeType.trim())) {
    res.status(400).json({ error: 'unknown nodeType' });
    return;
  }
  if (label.length > MAX_LABEL_LENGTH || (typeof body === 'string' && body.length > MAX_BODY_LENGTH)) {
    res.status(400).json({ error: 'label or body is too long' });
    return;
  }

  const cyberRangeId = Number(req.params.cyberRangeId);
  if (activeCyberRangeIdForTeam(req.user!.teamId) !== cyberRangeId) {
    res.status(409).json({ error: "this isn't your team's active Cyber Range — refresh the page" });
    return;
  }
  const now = new Date().toISOString();

  const result = db
    .prepare(
      `INSERT INTO investigation_canvas_nodes
         (team_id, cyber_range_id, author_user_id, node_type, label, body, pos_x, pos_y, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      req.user!.teamId,
      cyberRangeId,
      req.user!.id,
      nodeType.trim(),
      label.trim(),
      typeof body === 'string' && body.trim() ? body.trim() : null,
      typeof posX === 'number' ? posX : 0,
      typeof posY === 'number' ? posY : 0,
      now,
      now,
    );

  const node = db.prepare(`${NODE_SELECT} WHERE n.id = ?`).get(result.lastInsertRowid);
  emitInvestigationCanvasNodeCreated(req.user!.teamId, node);
  res.status(201).json({ node });
});

// Serves three call sites from the client with one endpoint: drag-stop (posX/posY only), inline
// label/body edit, and a node-type change — all COALESCE-patched, same pattern as
// admin/topology.routes.ts's node PATCH.
router.patch('/cyber-ranges/:cyberRangeId/investigation-canvas/nodes/:nodeId', (req, res) => {
  if (req.user!.role !== 'student' || !req.user!.teamId) {
    res.status(403).json({ error: 'only a student on a team can edit canvas nodes' });
    return;
  }

  const nodeId = Number(req.params.nodeId);
  const cyberRangeId = Number(req.params.cyberRangeId);

  // Team AND range must both match — not just team ownership in isolation. A team can have canvas
  // history across more than one cyber range over time; without the range check too, a crafted
  // request could reach a real node the team owns but that belongs to a different range than the
  // one named in the URL. Mismatch on either dimension -> 404, never 403 (same cross-team-leakage
  // precedent as elsewhere in this codebase, e.g. access-sessions' end endpoint).
  const existing = db
    .prepare('SELECT team_id AS teamId, cyber_range_id AS cyberRangeId FROM investigation_canvas_nodes WHERE id = ?')
    .get(nodeId) as { teamId: number; cyberRangeId: number } | undefined;

  if (!existing || existing.teamId !== req.user!.teamId || existing.cyberRangeId !== cyberRangeId) {
    res.status(404).json({ error: 'node not found' });
    return;
  }

  const { label, body, nodeType, posX, posY } = req.body ?? {};
  if (typeof nodeType === 'string' && nodeType.trim() && !CANVAS_NODE_TYPES.has(nodeType.trim())) {
    res.status(400).json({ error: 'unknown nodeType' });
    return;
  }
  if ((typeof label === 'string' && label.length > MAX_LABEL_LENGTH) || (typeof body === 'string' && body.length > MAX_BODY_LENGTH)) {
    res.status(400).json({ error: 'label or body is too long' });
    return;
  }

  db.prepare(
    `UPDATE investigation_canvas_nodes SET
       label = COALESCE(?, label),
       body = COALESCE(?, body),
       node_type = COALESCE(?, node_type),
       pos_x = COALESCE(?, pos_x),
       pos_y = COALESCE(?, pos_y),
       updated_at = ?
     WHERE id = ?`,
  ).run(
    typeof label === 'string' && label.trim() ? label.trim() : null,
    typeof body === 'string' ? body : null,
    typeof nodeType === 'string' && nodeType.trim() ? nodeType.trim() : null,
    typeof posX === 'number' ? posX : null,
    typeof posY === 'number' ? posY : null,
    new Date().toISOString(),
    nodeId,
  );

  const node = db.prepare(`${NODE_SELECT} WHERE n.id = ?`).get(nodeId);
  emitInvestigationCanvasNodeUpdated(req.user!.teamId, node);
  res.json({ node });
});

// Atomic: deleting a node removes every edge touching it in the same transaction, so a node is
// never left dangling-edge-free-but-still-present (or vice versa) even if the process dies
// mid-operation. node:sqlite's DatabaseSync has no .transaction() helper (see CLAUDE/invariants.md),
// so this uses the same explicit BEGIN/COMMIT/ROLLBACK pattern as admin/event.routes.ts's reset handler.
router.delete('/cyber-ranges/:cyberRangeId/investigation-canvas/nodes/:nodeId', (req, res) => {
  if (req.user!.role !== 'student' || !req.user!.teamId) {
    res.status(403).json({ error: 'only a student on a team can delete canvas nodes' });
    return;
  }

  const nodeId = Number(req.params.nodeId);
  const cyberRangeId = Number(req.params.cyberRangeId);

  const existing = db
    .prepare('SELECT team_id AS teamId, cyber_range_id AS cyberRangeId FROM investigation_canvas_nodes WHERE id = ?')
    .get(nodeId) as { teamId: number; cyberRangeId: number } | undefined;

  if (!existing || existing.teamId !== req.user!.teamId || existing.cyberRangeId !== cyberRangeId) {
    res.status(404).json({ error: 'node not found' });
    return;
  }

  const removedEdges = db
    .prepare('SELECT id FROM investigation_canvas_edges WHERE from_node_id = ? OR to_node_id = ?')
    .all(nodeId, nodeId) as { id: number }[];

  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM investigation_canvas_edges WHERE from_node_id = ? OR to_node_id = ?').run(nodeId, nodeId);
    db.prepare('DELETE FROM investigation_canvas_nodes WHERE id = ?').run(nodeId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  // Edges first, so a connected client's local graph drops edges before the node they reference
  // disappears (avoids a dangling-edge render flash).
  for (const edge of removedEdges) {
    emitInvestigationCanvasEdgeDeleted(req.user!.teamId, edge.id);
  }
  emitInvestigationCanvasNodeDeleted(req.user!.teamId, nodeId);

  res.json({ ok: true });
});

router.post('/cyber-ranges/:cyberRangeId/investigation-canvas/edges', (req, res) => {
  if (req.user!.role !== 'student' || !req.user!.teamId) {
    res.status(403).json({ error: 'only a student on a team can connect canvas nodes' });
    return;
  }

  const { fromNodeId, toNodeId, label } = req.body ?? {};
  const cyberRangeId = Number(req.params.cyberRangeId);

  if (typeof fromNodeId !== 'number' || typeof toNodeId !== 'number') {
    res.status(400).json({ error: 'fromNodeId and toNodeId are required' });
    return;
  }
  if (fromNodeId === toNodeId) {
    res.status(400).json({ error: 'a node cannot connect to itself' });
    return;
  }

  const nodes = db
    .prepare('SELECT id, team_id AS teamId, cyber_range_id AS cyberRangeId FROM investigation_canvas_nodes WHERE id IN (?, ?)')
    .all(fromNodeId, toNodeId) as { id: number; teamId: number; cyberRangeId: number }[];

  const bothValid =
    nodes.length === 2 && nodes.every((n) => n.teamId === req.user!.teamId && n.cyberRangeId === cyberRangeId);

  if (!bothValid) {
    res.status(400).json({ error: 'both nodes must exist and belong to your team and this cyber range' });
    return;
  }

  const now = new Date().toISOString();
  let result;
  try {
    result = db
      .prepare(
        `INSERT INTO investigation_canvas_edges
           (team_id, cyber_range_id, author_user_id, from_node_id, to_node_id, label, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        req.user!.teamId,
        cyberRangeId,
        req.user!.id,
        fromNodeId,
        toNodeId,
        typeof label === 'string' && label.trim() ? label.trim() : null,
        now,
      );
  } catch (err) {
    // idx_investigation_canvas_edges_unique_pair is the DB-enforced backstop for "no duplicate edge
    // in the same direction" — translate its constraint violation into a clean 409, same pattern as
    // environment_discovery_runs'/script_executions' one-in-flight partial unique indexes.
    if (err instanceof Error && /UNIQUE constraint failed/.test(err.message)) {
      res.status(409).json({ error: 'these two nodes are already connected in this direction' });
      return;
    }
    throw err;
  }

  const edge = db.prepare(`${EDGE_SELECT} WHERE e.id = ?`).get(result.lastInsertRowid);
  emitInvestigationCanvasEdgeCreated(req.user!.teamId, edge);
  res.status(201).json({ edge });
});

router.delete('/cyber-ranges/:cyberRangeId/investigation-canvas/edges/:edgeId', (req, res) => {
  if (req.user!.role !== 'student' || !req.user!.teamId) {
    res.status(403).json({ error: 'only a student on a team can delete canvas edges' });
    return;
  }

  const edgeId = Number(req.params.edgeId);
  const cyberRangeId = Number(req.params.cyberRangeId);

  const existing = db
    .prepare('SELECT team_id AS teamId, cyber_range_id AS cyberRangeId FROM investigation_canvas_edges WHERE id = ?')
    .get(edgeId) as { teamId: number; cyberRangeId: number } | undefined;

  if (!existing || existing.teamId !== req.user!.teamId || existing.cyberRangeId !== cyberRangeId) {
    res.status(404).json({ error: 'edge not found' });
    return;
  }

  db.prepare('DELETE FROM investigation_canvas_edges WHERE id = ?').run(edgeId);
  emitInvestigationCanvasEdgeDeleted(req.user!.teamId, edgeId);
  res.json({ ok: true });
});

export default router;
