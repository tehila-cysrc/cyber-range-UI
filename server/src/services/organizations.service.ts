import { db } from '../db/index.js';

export interface Organization {
  id: number;
  name: string;
  teamCount: number;
}

export type OrgResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

function cleanName(name: unknown): string | null {
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

function nameTaken(name: string, exceptId: number | null): boolean {
  return !!db
    .prepare('SELECT 1 FROM organizations WHERE name = ? COLLATE NOCASE AND id IS NOT ?')
    .get(name, exceptId);
}

// teamCount only counts teams of the current event runs still in the DB — after a reset an
// organization simply shows 0 teams until the next cohort is assigned to it.
export function listOrganizations(): Organization[] {
  return db
    .prepare(
      `SELECT o.id, o.name, COUNT(t.id) AS teamCount
       FROM organizations o LEFT JOIN teams t ON t.organization_id = o.id
       GROUP BY o.id ORDER BY o.name COLLATE NOCASE`,
    )
    .all() as unknown as Organization[];
}

export function createOrganization(rawName: unknown): OrgResult<Organization> {
  const name = cleanName(rawName);
  if (!name) return { ok: false, status: 400, error: 'name is required' };
  if (nameTaken(name, null)) return { ok: false, status: 409, error: 'an organization with this name already exists' };
  const result = db
    .prepare('INSERT INTO organizations (name, created_at) VALUES (?, ?)')
    .run(name, new Date().toISOString());
  return { ok: true, value: { id: Number(result.lastInsertRowid), name, teamCount: 0 } };
}

export function renameOrganization(id: number, rawName: unknown): OrgResult<{ id: number; name: string }> {
  const name = cleanName(rawName);
  if (!name) return { ok: false, status: 400, error: 'name is required' };
  if (!db.prepare('SELECT 1 FROM organizations WHERE id = ?').get(id)) {
    return { ok: false, status: 404, error: 'organization not found' };
  }
  if (nameTaken(name, id)) return { ok: false, status: 409, error: 'an organization with this name already exists' };
  db.prepare('UPDATE organizations SET name = ? WHERE id = ?').run(name, id);
  return { ok: true, value: { id, name } };
}

// Teams of a deleted organization are un-assigned (FK ON DELETE SET NULL), never deleted.
export function deleteOrganization(id: number): OrgResult<{ unassignedTeams: number }> {
  const teams = db.prepare('SELECT COUNT(*) AS n FROM teams WHERE organization_id = ?').get(id) as { n: number };
  const result = db.prepare('DELETE FROM organizations WHERE id = ?').run(id);
  if (result.changes === 0) return { ok: false, status: 404, error: 'organization not found' };
  return { ok: true, value: { unassignedTeams: teams.n } };
}

// null/'' clears the assignment. Returns 404 for an unknown team, 400 for an unknown organization.
export function setTeamOrganization(teamId: number, rawOrgId: unknown): OrgResult<{ organizationId: number | null }> {
  let orgId: number | null = null;
  if (rawOrgId !== null && rawOrgId !== undefined && rawOrgId !== '') {
    orgId = Number(rawOrgId);
    if (!Number.isInteger(orgId) || !db.prepare('SELECT 1 FROM organizations WHERE id = ?').get(orgId)) {
      return { ok: false, status: 400, error: 'unknown organization' };
    }
  }
  const result = db.prepare('UPDATE teams SET organization_id = ? WHERE id = ?').run(orgId, teamId);
  if (result.changes === 0) return { ok: false, status: 404, error: 'team not found' };
  return { ok: true, value: { organizationId: orgId } };
}
