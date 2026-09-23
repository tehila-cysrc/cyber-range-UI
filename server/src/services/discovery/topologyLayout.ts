import { db } from '../../db/index.js';

// A cyber-range topology must come out fully organized on its own — an instructor should never need
// to touch a node just to make the canvas readable. Dragging stays available, but only as a rare,
// optional override, never something this layout relies on. Deliberately a fixed grid, not
// dagre/elkjs/force-directed: these topologies are a handful of hosts per zone (training scenarios,
// not enterprise-scale graphs), so a predictable grid reads better on a classroom screen, and it adds
// no new dependency to either workspace.

// Mirrors client/src/features/topology/TopologyGraph.tsx's CARD_WIDTH/CARD_HEIGHT/ZONE_PADDING/
// ZONE_LABEL_HEIGHT (duplicated, not imported — client and server are separate npm workspaces with no
// shared package). Keep both in sync if either changes.
const CARD_WIDTH = 176;
const CARD_HEIGHT = 60;
const ZONE_PADDING = 36;
const ZONE_LABEL_HEIGHT = 30;

const GRID_COLUMNS = 3; // wrap a zone's own node grid after this many cards per row
const NODE_GAP_X = 40;
const NODE_GAP_Y = 30;
// Comfortably larger than 2 * (ZONE_PADDING + ZONE_LABEL_HEIGHT) = 132, so two zones' padded chrome
// boxes can never touch even when both are as small as a single node.
const ZONE_GAP_X = 140;
const ZONE_ROW_GAP_Y = 140;
const MAX_ROW_WIDTH = 2600; // wrap to a new row of zones once a row would exceed this canvas width

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Pure col/row math for a slot within a zone's own fixed-column grid, relative to that zone's origin
// (the top-left of its member CONTENT area, not its padded chrome box).
export function gridSlotOffset(index: number): Point {
  const col = index % GRID_COLUMNS;
  const row = Math.floor(index / GRID_COLUMNS);
  return { x: col * (CARD_WIDTH + NODE_GAP_X), y: row * (CARD_HEIGHT + NODE_GAP_Y) };
}

function zoneContentFootprint(memberCount: number): { width: number; height: number } {
  const cols = Math.max(1, Math.min(memberCount, GRID_COLUMNS));
  const rows = Math.max(1, Math.ceil(memberCount / GRID_COLUMNS));
  return {
    width: cols * CARD_WIDTH + (cols - 1) * NODE_GAP_X,
    height: rows * CARD_HEIGHT + (rows - 1) * NODE_GAP_Y,
  };
}

// A zone's full padded chrome rect for a given content origin/member count — mirrors
// TopologyGraph.tsx's zoneRects bounding-box formula exactly, since that's the source of truth for
// what actually renders. Also used (without a border rendered) to reserve space around the unzoned
// node pool, so it never collides with a real zone either.
export function zoneChromeRect(origin: Point, memberCount: number): Rect {
  const { width, height } = zoneContentFootprint(memberCount);
  return {
    x: origin.x - ZONE_PADDING,
    y: origin.y - ZONE_PADDING - ZONE_LABEL_HEIGHT,
    width: width + ZONE_PADDING * 2,
    height: height + ZONE_PADDING * 2 + ZONE_LABEL_HEIGHT,
  };
}

// Mints a brand-new zone's content-grid origin, placed to the right of whatever else already occupies
// the same row, wrapping to a new row once MAX_ROW_WIDTH would be exceeded. Stateless — recomputed
// fresh from the *current* set of chrome rects on every call (no persisted cursor), so it always
// reflects zones that have grown earlier in the same batch, not a stale snapshot from when the batch
// started. Given the small zone counts a training topology actually has, recomputing from scratch each
// time is trivially cheap and avoids a whole class of cursor/row-tracking bugs a persistent packer
// would need to get right.
export function allocateZoneOrigin(existingChromeRects: Rect[], countHint: number): Point {
  const footprint = zoneContentFootprint(Math.max(1, countHint));
  const chromeWidth = footprint.width + ZONE_PADDING * 2;

  if (existingChromeRects.length === 0) {
    return { x: ZONE_PADDING, y: ZONE_PADDING + ZONE_LABEL_HEIGHT };
  }

  // "Current row" = whichever existing rects share the largest y (the most recently started row).
  const currentRowY = Math.max(...existingChromeRects.map((r) => r.y));
  const rowRight = Math.max(...existingChromeRects.filter((r) => r.y === currentRowY).map((r) => r.x + r.width));

  if (rowRight + ZONE_GAP_X + chromeWidth <= MAX_ROW_WIDTH) {
    return { x: rowRight + ZONE_GAP_X + ZONE_PADDING, y: currentRowY + ZONE_PADDING + ZONE_LABEL_HEIGHT };
  }

  const overallBottom = Math.max(...existingChromeRects.map((r) => r.y + r.height));
  return { x: ZONE_PADDING, y: overallBottom + ZONE_ROW_GAP_Y + ZONE_PADDING + ZONE_LABEL_HEIGHT };
}

interface ZoneOccupancy {
  origin: Point; // top-left of this zone's member CONTENT grid (not its padded chrome box)
  nextIndex: number; // next free slot index in this zone's own grid
}

// Single entry point for both discovery's batch insert and the manual "add node" route — snapshots
// current node occupancy once (one query), then hands out grid positions in-memory. `null` represents
// the unzoned pool (nodes with no zone_id), grouped and packed exactly like a real zone.
export class TopologyLayoutPlanner {
  private occupancy = new Map<number | null, ZoneOccupancy>();

  // `fromScratch` ignores every node's current position — used by the instructor's explicit
  // "Auto-arrange" action, which re-lays-out a whole range rather than slotting in around what's there.
  constructor(cyberRangeId: number, { fromScratch = false }: { fromScratch?: boolean } = {}) {
    if (fromScratch) return;
    const rows = db
      .prepare(
        `SELECT zone_id AS zoneId, MIN(pos_x) AS minX, MIN(pos_y) AS minY, COUNT(*) AS count
         FROM topology_nodes WHERE cyber_range_id = ? GROUP BY zone_id`,
      )
      .all(cyberRangeId) as { zoneId: number | null; minX: number; minY: number; count: number }[];

    for (const row of rows) {
      this.occupancy.set(row.zoneId, { origin: { x: row.minX, y: row.minY }, nextIndex: row.count });
    }
  }

  private currentChromeRects(excludeZoneId: number | null): Rect[] {
    const rects: Rect[] = [];
    for (const [zoneId, occ] of this.occupancy) {
      if (zoneId === excludeZoneId) continue;
      rects.push(zoneChromeRect(occ.origin, occ.nextIndex));
    }
    return rects;
  }

  // Returns the next open grid slot's absolute canvas position for `zoneId` (null = unzoned pool).
  // `countHint` is only consulted the first time this zoneId is seen with zero existing members — pass
  // the zone's full eventual member count for this batch so a brand-new zone is sized (and other zones
  // placed around it) correctly up front, not resized after the fact.
  nextPosition(zoneId: number | null, countHint = 1): Point {
    let occ = this.occupancy.get(zoneId);
    if (!occ) {
      const origin = allocateZoneOrigin(this.currentChromeRects(zoneId), countHint);
      occ = { origin, nextIndex: 0 };
      this.occupancy.set(zoneId, occ);
    }

    const offset = gridSlotOffset(occ.nextIndex);
    occ.nextIndex += 1;
    return { x: occ.origin.x + offset.x, y: occ.origin.y + offset.y };
  }
}
