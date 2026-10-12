import { db } from '../db/index.js';
import type { Principal } from './principal.js';
import { loadScope } from './scope.js';

export interface ScopeSummary {
  all: boolean;
  organizations: { id: number; name: string }[];
  cyberRanges: { id: number; name: string }[];
  pairs: { organizationId: number; cyberRangeId: number }[];
}

// What the signed-in user may work on, by name — for the UI (navigation, filters, empty states) only.
// The server never trusts this back; every request re-checks scope on the row it loads.
export function describeScope(p: Principal): ScopeSummary | null {
  if (p.role === 'student') return null;
  const scope = loadScope(p);
  if (scope.all) return { all: true, organizations: [], cyberRanges: [], pairs: [] };
  const names = (table: 'organizations' | 'cyber_ranges', ids: Set<number>) => {
    if (ids.size === 0) return [];
    const list = [...ids];
    return db
      .prepare(`SELECT id, name FROM ${table} WHERE id IN (${list.map(() => '?').join(',')}) ORDER BY name COLLATE NOCASE`)
      .all(...list) as { id: number; name: string }[];
  };
  return {
    all: false,
    organizations: names('organizations', scope.orgIds),
    cyberRanges: names('cyber_ranges', scope.rangeIds),
    pairs: scope.pairs.map((pair) => ({ organizationId: pair.orgId, cyberRangeId: pair.rangeId })),
  };
}
