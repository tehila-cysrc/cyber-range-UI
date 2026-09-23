import { db } from '../../db/index.js';
import { readCredentialPlaintext } from '../credential.service.js';
import { readVmLoginSecret } from '../keyVaultCredential.service.js';
import { getResolvedCredential } from '../environments.service.js';
import { createShareableLink, deleteShareableLink } from './bastionConnect.service.js';
import { classifyAzureError } from '../azureErrors.js';
import { writeAudit } from '../audit.service.js';
import { emitAccessSessionEnded, emitAccessSessionStarted } from '../../sockets/emitters.js';

const SESSION_TTL_MINUTES = Number(process.env.ACCESS_SESSION_TTL_MINUTES ?? 15);

export type RequestOutcome =
  | { ok: true; accessSessionId: number; shareableLinkUrl: string; expiresAt: string }
  | { ok: false; status: number; reason: string; message: string };

interface RequestingUser {
  id: number;
  teamId: number;
  username: string;
}

// The student-facing entry point. Mirrors the existing help_requests pattern (see
// helpRequests.routes.ts): the target's scope is re-derived server-side from the team's currently
// -active cyber range, never trusted from the client — see CLAUDE/invariants.md. A malicious request
// naming another team's node is rejected here, before any credential is ever touched, and the
// rejection itself is audited, not silently dropped.
//
// Phase 2: Connect is Azure Bastion Shareable Link-backed, which only exists for a real Azure VM — a
// hand-drawn node with no environment_id (a manual-only cyber range) has no network path to broker at
// all, so it's rejected with 'not_connectable' just like a node with no access_targets row.
export async function requestAccessSession(user: RequestingUser, topologyNodeId: number, clientIp: string | null): Promise<RequestOutcome> {
  const activeProgress = db
    .prepare(`SELECT cyber_range_id AS cyberRangeId FROM team_cyber_range_progress WHERE team_id = ? AND status = 'active' LIMIT 1`)
    .get(user.teamId) as { cyberRangeId: number } | undefined;

  if (!activeProgress) {
    writeAudit(user.username, 'access_session.denied', 'topology_node', topologyNodeId, { reason: 'no_active_range', teamId: user.teamId });
    return { ok: false, status: 409, reason: 'no_active_range', message: "your team has no active cyber range" };
  }

  const node = db
    .prepare(
      `SELECT tn.id AS id, tn.cyber_range_id AS cyberRangeId, tn.external_key AS externalKey, tn.environment_id AS environmentId,
              tn.is_visible_to_students AS isVisibleToStudents, ce.bastion_host_id AS bastionHostId
       FROM topology_nodes tn LEFT JOIN cloud_environments ce ON ce.id = tn.environment_id
       WHERE tn.id = ?`,
    )
    .get(topologyNodeId) as
    | { id: number; cyberRangeId: number; externalKey: string; environmentId: number | null; isVisibleToStudents: number; bastionHostId: string | null }
    | undefined;

  // A node that doesn't exist can't be recorded in access_sessions (FK) — audit and refuse without
  // the insert that used to surface as a 500 (FOLLOWUPS.md P3).
  if (!node) {
    writeAudit(user.username, 'access_session.denied', 'topology_node', topologyNodeId, { reason: 'node_not_found', teamId: user.teamId });
    return { ok: false, status: 403, reason: 'node_not_in_active_range', message: "this node is not part of your team's active cyber range" };
  }

  // A node the instructor hid from students is treated exactly like one outside the range — the
  // student UI never shows it, so reaching it would mean a hand-crafted request by id.
  if (node.cyberRangeId !== activeProgress.cyberRangeId || node.isVisibleToStudents !== 1) {
    return deny(user, topologyNodeId, activeProgress.cyberRangeId, 'node_not_in_active_range', 403, "this node is not part of your team's active cyber range");
  }

  const target = db
    .prepare('SELECT protocol, credential_id AS credentialId, key_vault_secret_name AS keyVaultSecretName, username FROM access_targets WHERE topology_node_id = ?')
    .get(topologyNodeId) as
    | { protocol: 'rdp' | 'ssh'; credentialId: number | null; keyVaultSecretName: string | null; username: string | null }
    | undefined;

  if (!target) {
    return deny(user, topologyNodeId, activeProgress.cyberRangeId, 'not_connectable', 400, 'this node has no configured access target');
  }

  if (!node.environmentId || !node.bastionHostId) {
    return deny(
      user,
      topologyNodeId,
      activeProgress.cyberRangeId,
      'bastion_unavailable',
      400,
      'remote connection is temporarily unavailable for this machine',
    );
  }

  const credential = getResolvedCredential(node.environmentId);
  if (!credential) {
    return deny(user, topologyNodeId, activeProgress.cyberRangeId, 'credential_error', 500, 'platform permissions do not allow this action — contact an administrator');
  }

  // Resolving the VM login credential isn't actually needed to open the Bastion connection itself
  // (the shareable link never carries it), but confirms one is configured before we hand the student
  // a link that will just fail at their own login prompt — see revealSessionCredential for the
  // separate, explicitly-audited "Show" action that actually returns it to the client.
  try {
    await resolveNodeCredential(target, node.environmentId);
  } catch {
    return deny(user, topologyNodeId, activeProgress.cyberRangeId, 'no_credential_configured', 400, 'no login credential is configured for this node');
  }

  let shareableLinkUrl: string;
  try {
    const link = await createShareableLink(credential, node.bastionHostId, node.externalKey);
    shareableLinkUrl = link.url;
  } catch (err) {
    const { message } = classifyAzureError(err);
    return deny(user, topologyNodeId, activeProgress.cyberRangeId, 'bastion_error', 502, message);
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MINUTES * 60_000).toISOString();

  const result = db
    .prepare(
      `INSERT INTO access_sessions
         (team_id, user_id, cyber_range_id, topology_node_id, protocol, requested_at, started_at, expires_at, outcome, client_ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    )
    .run(user.teamId, user.id, activeProgress.cyberRangeId, topologyNodeId, target.protocol, now.toISOString(), now.toISOString(), expiresAt, clientIp);
  const accessSessionId = result.lastInsertRowid as number;

  writeAudit(user.username, 'access_session.requested', 'access_session', accessSessionId, { teamId: user.teamId, topologyNodeId });
  emitAccessSessionStarted(user.teamId, { id: accessSessionId, topologyNodeId, protocol: target.protocol, expiresAt });

  return { ok: true, accessSessionId, shareableLinkUrl, expiresAt };
}

// The instructor-facing entry point (Topology Admin's own "Connect" button) — same Bastion Shareable
// Link mechanism as requestAccessSession, but not team-scoped: an instructor can diagnostically
// connect to any node in any cyber range regardless of which team (if any) currently has it active,
// since they already have full read/write access to every range's topology. Recorded as an
// access_sessions row with team_id NULL (see CLAUDE/db.md) so it still shows up in the instructor
// dashboard's "Active access sessions" list and gets cleaned up by the same expiry sweep.
export async function requestInstructorAccessSession(
  topologyNodeId: number,
  actor: { id: number; username: string },
  clientIp: string | null,
): Promise<RequestOutcome> {
  const node = db
    .prepare(
      `SELECT tn.id AS id, tn.cyber_range_id AS cyberRangeId, tn.external_key AS externalKey, tn.environment_id AS environmentId,
              ce.bastion_host_id AS bastionHostId
       FROM topology_nodes tn LEFT JOIN cloud_environments ce ON ce.id = tn.environment_id
       WHERE tn.id = ?`,
    )
    .get(topologyNodeId) as
    | { id: number; cyberRangeId: number; externalKey: string; environmentId: number | null; bastionHostId: string | null }
    | undefined;

  if (!node) {
    return { ok: false, status: 404, reason: 'node_not_found', message: 'this node does not exist' };
  }

  const target = db
    .prepare('SELECT protocol, credential_id AS credentialId, key_vault_secret_name AS keyVaultSecretName, username FROM access_targets WHERE topology_node_id = ?')
    .get(topologyNodeId) as
    | { protocol: 'rdp' | 'ssh'; credentialId: number | null; keyVaultSecretName: string | null; username: string | null }
    | undefined;

  if (!target) {
    return denyInstructor(actor, node, 'not_connectable', 400, 'this node has no configured access target');
  }

  if (!node.environmentId || !node.bastionHostId) {
    return denyInstructor(actor, node, 'bastion_unavailable', 400, 'remote connection is temporarily unavailable for this machine');
  }

  const credential = getResolvedCredential(node.environmentId);
  if (!credential) {
    return denyInstructor(actor, node, 'credential_error', 500, 'platform permissions do not allow this action — contact an administrator');
  }

  try {
    await resolveNodeCredential(target, node.environmentId);
  } catch {
    return denyInstructor(actor, node, 'no_credential_configured', 400, 'no login credential is configured for this node');
  }

  let shareableLinkUrl: string;
  try {
    const link = await createShareableLink(credential, node.bastionHostId, node.externalKey);
    shareableLinkUrl = link.url;
  } catch (err) {
    const { message } = classifyAzureError(err);
    return denyInstructor(actor, node, 'bastion_error', 502, message);
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MINUTES * 60_000).toISOString();

  const result = db
    .prepare(
      `INSERT INTO access_sessions
         (team_id, user_id, cyber_range_id, topology_node_id, protocol, requested_at, started_at, expires_at, outcome, client_ip)
       VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    )
    .run(actor.id, node.cyberRangeId, topologyNodeId, target.protocol, now.toISOString(), now.toISOString(), expiresAt, clientIp);
  const accessSessionId = result.lastInsertRowid as number;

  writeAudit(actor.username, 'access_session.requested', 'access_session', accessSessionId, { teamId: null, topologyNodeId, instructor: true });
  emitAccessSessionStarted(null, { id: accessSessionId, topologyNodeId, protocol: target.protocol, expiresAt });

  return { ok: true, accessSessionId, shareableLinkUrl, expiresAt };
}

function denyInstructor(
  actor: { id: number; username: string },
  node: { id: number; cyberRangeId: number },
  reason: string,
  status: number,
  message: string,
): RequestOutcome {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO access_sessions (team_id, user_id, cyber_range_id, topology_node_id, protocol, requested_at, expires_at, outcome, denial_reason)
     VALUES (NULL, ?, ?, ?, 'rdp', ?, ?, 'denied', ?)`,
  ).run(actor.id, node.cyberRangeId, node.id, now, now, reason);
  writeAudit(actor.username, 'access_session.denied', 'topology_node', node.id, { reason, instructor: true });
  return { ok: false, status, reason, message };
}

async function resolveNodeCredential(
  target: { credentialId: number | null; keyVaultSecretName: string | null; username: string | null },
  environmentId: number,
): Promise<{ username: string; password: string }> {
  if (!target.username) throw new Error('no username configured');

  if (target.keyVaultSecretName) {
    const row = db.prepare('SELECT key_vault_uri AS keyVaultUri FROM cloud_environments WHERE id = ?').get(environmentId) as
      | { keyVaultUri: string | null }
      | undefined;
    if (!row?.keyVaultUri) throw new Error('environment has no Key Vault registered');
    const credential = getResolvedCredential(environmentId);
    if (!credential) throw new Error('no resolvable environment credential');
    const password = await readVmLoginSecret(credential, row.keyVaultUri, target.keyVaultSecretName);
    return { username: target.username, password };
  }

  if (target.credentialId) {
    return { username: target.username, password: readCredentialPlaintext(target.credentialId) };
  }

  throw new Error('no credential configured');
}

// The side panel's explicit "Show"/"Copy" action (design doc §11.5) — separate from opening the
// connection itself, and separately audited, since revealing a plaintext credential to the browser is
// a more sensitive event than just opening a (credential-free) Bastion link.
export async function revealSessionCredential(
  accessSessionId: number,
  teamId: number,
  username: string,
): Promise<{ username: string; password: string } | null> {
  const row = db
    .prepare(`SELECT topology_node_id AS topologyNodeId, team_id AS teamId, outcome FROM access_sessions WHERE id = ?`)
    .get(accessSessionId) as { topologyNodeId: number; teamId: number; outcome: string } | undefined;
  if (!row || row.teamId !== teamId || row.outcome !== 'active') return null;

  const target = db
    .prepare('SELECT credential_id AS credentialId, key_vault_secret_name AS keyVaultSecretName, username FROM access_targets WHERE topology_node_id = ?')
    .get(row.topologyNodeId) as { credentialId: number | null; keyVaultSecretName: string | null; username: string | null } | undefined;
  const environmentId = (db.prepare('SELECT environment_id AS environmentId FROM topology_nodes WHERE id = ?').get(row.topologyNodeId) as { environmentId: number | null } | undefined)
    ?.environmentId;
  if (!target || !environmentId) return null;

  try {
    const resolved = await resolveNodeCredential(target, environmentId);
    writeAudit(username, 'access_session.credential_revealed', 'access_session', accessSessionId, null);
    return resolved;
  } catch {
    return null;
  }
}

function deny(
  user: RequestingUser,
  topologyNodeId: number,
  cyberRangeId: number,
  reason: string,
  status: number,
  message: string,
): RequestOutcome {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO access_sessions (team_id, user_id, cyber_range_id, topology_node_id, protocol, requested_at, expires_at, outcome, denial_reason)
     VALUES (?, ?, ?, ?, 'rdp', ?, ?, 'denied', ?)`,
  ).run(user.teamId, user.id, cyberRangeId, topologyNodeId, now, now, reason);
  writeAudit(user.username, 'access_session.denied', 'topology_node', topologyNodeId, { reason, teamId: user.teamId });
  return { ok: false, status, reason, message };
}

export function endOwnSession(accessSessionId: number, teamId: number, username: string): boolean {
  const row = db.prepare(`SELECT team_id AS teamId, outcome FROM access_sessions WHERE id = ?`).get(accessSessionId) as
    | { teamId: number; outcome: string }
    | undefined;
  if (!row || row.teamId !== teamId || row.outcome !== 'active') return false;

  finishSession(accessSessionId, teamId, 'completed');
  writeAudit(username, 'access_session.ended', 'access_session', accessSessionId, { outcome: 'completed' });
  return true;
}

export function forceCloseSession(accessSessionId: number, actorUsername: string): boolean {
  const row = db.prepare(`SELECT team_id AS teamId, outcome FROM access_sessions WHERE id = ?`).get(accessSessionId) as
    | { teamId: number | null; outcome: string }
    | undefined;
  if (!row || row.outcome !== 'active') return false;

  finishSession(accessSessionId, row.teamId, 'force_closed');
  writeAudit(actorUsername, 'access_session.ended', 'access_session', accessSessionId, { outcome: 'force_closed' });
  return true;
}

// Called by accessSessionExpiry.service.ts's ticker for sessions that ran past expires_at without an
// explicit end — same "server-authoritative timing" precedent as clock.service.ts.
export function expireSession(accessSessionId: number, teamId: number | null): void {
  finishSession(accessSessionId, teamId, 'expired');
  writeAudit(null, 'access_session.ended', 'access_session', accessSessionId, { outcome: 'expired' });
}

function finishSession(accessSessionId: number, teamId: number | null, outcome: 'completed' | 'force_closed' | 'expired') {
  db.prepare(`UPDATE access_sessions SET outcome = ?, ended_at = ? WHERE id = ?`).run(outcome, new Date().toISOString(), accessSessionId);
  void cleanupShareableLink(accessSessionId);
  emitAccessSessionEnded(teamId, accessSessionId, outcome);
}

// Best-effort: a lingering shareable link isn't a security hole (it still requires the real VM
// credential to do anything), just tidiness — Bastion caps at 500 links per host, and Bastion's own
// docs already tell you a link keeps failing quietly once its target is gone, so a failure here is
// logged, never allowed to block session-end or surface to the caller.
async function cleanupShareableLink(accessSessionId: number): Promise<void> {
  const row = db
    .prepare(
      `SELECT tn.external_key AS externalKey, tn.environment_id AS environmentId, ce.bastion_host_id AS bastionHostId
       FROM access_sessions s
       JOIN topology_nodes tn ON tn.id = s.topology_node_id
       LEFT JOIN cloud_environments ce ON ce.id = tn.environment_id
       WHERE s.id = ?`,
    )
    .get(accessSessionId) as { externalKey: string; environmentId: number | null; bastionHostId: string | null } | undefined;
  if (!row?.environmentId || !row.bastionHostId) return;

  try {
    const credential = getResolvedCredential(row.environmentId);
    if (!credential) return;
    await deleteShareableLink(credential, row.bastionHostId, row.externalKey);
  } catch (err) {
    console.error(`[accessBroker] failed to clean up shareable link for session ${accessSessionId}:`, (err as Error).message);
  }
}

export interface ActiveSessionSummary {
  id: number;
  teamId: number | null;
  teamName: string | null; // null = an instructor's own Connect session, not tied to any team
  username: string;
  topologyNodeId: number;
  nodeLabel: string;
  protocol: string;
  startedAt: string | null;
  expiresAt: string;
}

export function listActiveSessions(): ActiveSessionSummary[] {
  return db
    .prepare(
      `SELECT s.id AS id, s.team_id AS teamId, t.name AS teamName, u.username AS username,
              s.topology_node_id AS topologyNodeId, tn.label AS nodeLabel, s.protocol AS protocol,
              s.started_at AS startedAt, s.expires_at AS expiresAt
       FROM access_sessions s
       LEFT JOIN teams t ON t.id = s.team_id
       JOIN users u ON u.id = s.user_id
       JOIN topology_nodes tn ON tn.id = s.topology_node_id
       WHERE s.outcome = 'active'
       ORDER BY s.started_at DESC`,
    )
    .all() as unknown as ActiveSessionSummary[];
}
