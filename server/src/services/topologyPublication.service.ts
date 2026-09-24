import { db } from '../db/index.js';

// Students see the topology the instructor last PUBLISHED, not the live draft (UX-38, decided
// 2026-09-24): the instructor arranges and edits freely, then approves with "Publish to students".
// Re-running discovery or moving cards never changes what students see until the next publish.
// Layout, labels, zones and edges come from the snapshot; operational fields (status, whether a
// remote-access target exists) are overlaid live for nodes that still exist and are still visible.

export interface StudentTopology {
  zones: unknown[];
  nodes: { id: number; [key: string]: unknown }[];
  edges: unknown[];
}

// The student-filtered view of the CURRENT draft — what a publish would freeze.
export function buildStudentView(cyberRangeId: number): StudentTopology {
  const zones = db
    .prepare(
      `SELECT id, external_key AS externalKey, name, cidr, sort_order AS sortOrder
       FROM topology_zones WHERE cyber_range_id = ? ORDER BY sort_order, name`,
    )
    .all(cyberRangeId);
  const nodes = db
    .prepare(
      `SELECT id, external_key AS externalKey, label, node_type AS nodeType, role, zone_id AS zoneId,
              pos_x AS posX, pos_y AS posY, metadata_json AS metadataJson, environment_id AS environmentId
       FROM topology_nodes WHERE cyber_range_id = ? AND is_visible_to_students = 1 ORDER BY id`,
    )
    .all(cyberRangeId) as { id: number }[];
  // A student must never see a reference to a hidden node's id — edges touching one are dropped.
  const edges = db
    .prepare(
      `SELECT te.id AS id, te.from_node_id AS fromNodeId, te.to_node_id AS toNodeId,
              te.from_zone_id AS fromZoneId, te.to_zone_id AS toZoneId, te.label
       FROM topology_edges te
       LEFT JOIN topology_nodes fn ON fn.id = te.from_node_id
       LEFT JOIN topology_nodes tn ON tn.id = te.to_node_id
       WHERE te.cyber_range_id = ?
         AND (fn.id IS NULL OR fn.is_visible_to_students = 1) AND (tn.id IS NULL OR tn.is_visible_to_students = 1)
       ORDER BY te.id`,
    )
    .all(cyberRangeId);
  return { zones, nodes, edges };
}

function readSnapshot(cyberRangeId: number): { snapshot: StudentTopology; publishedAt: string; publishedBy: string | null } | null {
  const row = db
    .prepare(
      `SELECT snapshot_json AS snapshotJson, published_at AS publishedAt, published_by AS publishedBy
       FROM cyber_range_topology_publications WHERE cyber_range_id = ?`,
    )
    .get(cyberRangeId) as { snapshotJson: string; publishedAt: string; publishedBy: string | null } | undefined;
  if (!row) return null;
  return { snapshot: JSON.parse(row.snapshotJson) as StudentTopology, publishedAt: row.publishedAt, publishedBy: row.publishedBy };
}

export function publishTopology(cyberRangeId: number, actorUsername: string) {
  const snapshot = buildStudentView(cyberRangeId);
  const publishedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO cyber_range_topology_publications (cyber_range_id, snapshot_json, published_at, published_by)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (cyber_range_id) DO UPDATE SET
       snapshot_json = excluded.snapshot_json, published_at = excluded.published_at, published_by = excluded.published_by`,
  ).run(cyberRangeId, JSON.stringify(snapshot), publishedAt, actorUsername);
  return { publishedAt, nodeCount: snapshot.nodes.length };
}

// What students get: the published snapshot with live status / hasAccessTarget, or null if the
// instructor never published this range.
export function getPublishedTopology(cyberRangeId: number): (StudentTopology & { publishedAt: string }) | null {
  const published = readSnapshot(cyberRangeId);
  if (!published) return null;
  const live = new Map(
    (
      db
        .prepare(
          `SELECT tn.id AS id, tn.status AS status, (at.id IS NOT NULL) AS hasAccessTarget
           FROM topology_nodes tn LEFT JOIN access_targets at ON at.topology_node_id = tn.id
           WHERE tn.cyber_range_id = ? AND tn.is_visible_to_students = 1`,
        )
        .all(cyberRangeId) as { id: number; status: string | null; hasAccessTarget: number }[]
    ).map((n) => [n.id, n]),
  );
  return {
    zones: published.snapshot.zones,
    edges: published.snapshot.edges,
    nodes: published.snapshot.nodes.map((n) => {
      const current = live.get(n.id);
      return { ...n, isVisibleToStudents: 1, status: current?.status ?? null, hasAccessTarget: current ? current.hasAccessTarget : 0 };
    }),
    publishedAt: published.publishedAt,
  };
}

// A student may only reach a node that is in the published snapshot (and, separately, still visible).
export function isNodePublished(cyberRangeId: number, nodeId: number): boolean {
  const published = readSnapshot(cyberRangeId);
  return !!published?.snapshot.nodes.some((n) => n.id === nodeId);
}

export function publicationStatus(cyberRangeId: number) {
  const published = readSnapshot(cyberRangeId);
  if (!published) return { published: false as const, publishedAt: null, publishedBy: null, hasUnpublishedChanges: buildStudentView(cyberRangeId).nodes.length > 0 };
  return {
    published: true as const,
    publishedAt: published.publishedAt,
    publishedBy: published.publishedBy,
    hasUnpublishedChanges: JSON.stringify(buildStudentView(cyberRangeId)) !== JSON.stringify(published.snapshot),
  };
}
