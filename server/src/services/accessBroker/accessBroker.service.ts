import { db } from '../../db/index.js';
import { readCredentialPlaintext } from '../credential.service.js';
import { readVmLoginSecret } from '../keyVaultCredential.service.js';
import { getResolvedCredential } from '../environments.service.js';
import { createShareableLink, deleteShareableLink, deleteShareableLinks, listShareableLinks } from './bastionConnect.service.js';
import { classifyAzureError } from '../azureErrors.js';
import { writeAudit } from '../audit.service.js';
import { emitAccessSessionEnded, emitAccessSessionStarted } from '../../sockets/emitters.js';

const SESSION_TTL_MINUTES = Number(process.env.ACCESS_SESSION_TTL_MINUTES ?? 15);

// Set for the whole duration of an event-reset job: between its revoke step and its wipe (minutes, when
// Bastion is busy) a newly created link would survive the reset, so no new session may start meanwhile.
let remoteAccessFrozen = false;
export function setRemoteAccessFrozen(frozen: boolean) {
  remoteAccessFrozen = frozen;
}
const FROZEN_MESSAGE = 'remote access is paused while the instructor resets the event';

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

  if (remoteAccessFrozen) {
    return { ok: false, status: 409, reason: 'reset_in_progress', message: FROZEN_MESSAGE };
  }

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
    console.error('[accessBroker] createShareableLink failed:', (err as Error).message.slice(0, 300));
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
  if (remoteAccessFrozen) {
    return { ok: false, status: 409, reason: 'reset_in_progress', message: FROZEN_MESSAGE };
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

function finishSession(
  accessSessionId: number,
  teamId: number | null,
  outcome: 'completed' | 'force_closed' | 'expired',
  { cleanupLink = true }: { cleanupLink?: boolean } = {},
) {
  db.prepare(`UPDATE access_sessions SET outcome = ?, ended_at = ? WHERE id = ?`).run(outcome, new Date().toISOString(), accessSessionId);
  if (cleanupLink) void cleanupShareableLink(accessSessionId);
  emitAccessSessionEnded(teamId, accessSessionId, outcome);
}

// Best-effort: a lingering shareable link isn't a security hole (it still requires the real VM
// credential to do anything), just tidiness — Bastion caps at 500 links per host, and Bastion's own
// docs already tell you a link keeps failing quietly once its target is gone, so a failure here is
// logged, never allowed to block session-end or surface to the caller.
async function cleanupShareableLink(accessSessionId: number): Promise<void> {
  // Bastion keeps one link per VM, shared by every session on it — if someone else (a teammate, or
  // the instructor) still has an active session on this node, deleting the link would cut them off.
  // The last session to end on a node is the one that revokes it. (Evaluated synchronously, before
  // the first await, so a caller that deletes rows right after calling this still sees them.)
  const othersActive = db
    .prepare(
      `SELECT 1 FROM access_sessions o JOIN access_sessions s ON s.topology_node_id = o.topology_node_id
       WHERE s.id = ? AND o.id != s.id AND o.outcome = 'active' LIMIT 1`,
    )
    .get(accessSessionId);
  if (othersActive) return;

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

// ---------------------------------------------------------------------------------------------------
// Session lifecycle hooks (2026-09-23): a remote session must not outlive the authorization it was
// granted under. Called on logout, scenario switch/completion, team/user removal and event reset.
// ---------------------------------------------------------------------------------------------------

interface EndFilter {
  teamId?: number;
  userId?: number;
  // Scenario switch: sessions on the (still-)active range stay valid, everything else ends.
  exceptCyberRangeId?: number;
  all?: boolean;
  // Event reset / revoke-all: revokeAllShareableLinks() does the (serialized) link cleanup itself —
  // a per-session delete racing it would just collide on the Bastion host (409).
  skipLinkCleanup?: boolean;
}

export function endActiveSessions(
  filter: EndFilter,
  outcome: 'completed' | 'force_closed',
  actorUsername: string | null,
  reason: string,
): number {
  const where: string[] = ["outcome = 'active'"];
  const params: (number | string)[] = [];
  if (filter.teamId != null) {
    where.push('team_id = ?');
    params.push(filter.teamId);
  }
  if (filter.userId != null) {
    where.push('user_id = ?');
    params.push(filter.userId);
  }
  if (filter.exceptCyberRangeId != null) {
    where.push('cyber_range_id != ?');
    params.push(filter.exceptCyberRangeId);
  }
  if (!filter.all && filter.teamId == null && filter.userId == null) return 0;

  const rows = db
    .prepare(`SELECT id, team_id AS teamId FROM access_sessions WHERE ${where.join(' AND ')}`)
    .all(...params) as { id: number; teamId: number | null }[];
  for (const r of rows) {
    finishSession(r.id, r.teamId, outcome, { cleanupLink: !filter.skipLinkCleanup });
    writeAudit(actorUsername, 'access_session.ended', 'access_session', r.id, { outcome, reason });
  }
  return rows.length;
}

export interface RestoredSession {
  accessSessionId: number;
  shareableLinkUrl: string;
  expiresAt: string;
  topologyNodeId: number;
  nodeLabel: string;
  protocol: string;
}

// After a page refresh the client has lost the link (it's only ever held in memory). This hands back
// the caller's OWN still-active session — but only after re-checking every condition the original
// request was granted under, since any of them may have changed since: the session hasn't expired,
// the node is still in the team's currently-active range and still visible to students, and it still
// has an access target. The link itself is re-read live from Bastion (never stored in our DB); if it's
// gone (revoked, or deleted by Azure), the session is ended rather than handed back half-alive.
export async function restoreOwnSession(user: RequestingUser): Promise<RestoredSession | null> {
  const s = db
    .prepare(
      `SELECT s.id AS id, s.cyber_range_id AS cyberRangeId, s.topology_node_id AS topologyNodeId, s.protocol AS protocol,
              s.expires_at AS expiresAt, tn.label AS nodeLabel, tn.cyber_range_id AS nodeRangeId,
              tn.is_visible_to_students AS visible, tn.external_key AS externalKey, tn.environment_id AS environmentId,
              ce.bastion_host_id AS bastionHostId, (at.id IS NOT NULL) AS hasTarget
       FROM access_sessions s
       JOIN topology_nodes tn ON tn.id = s.topology_node_id
       LEFT JOIN cloud_environments ce ON ce.id = tn.environment_id
       LEFT JOIN access_targets at ON at.topology_node_id = tn.id
       WHERE s.user_id = ? AND s.team_id = ? AND s.outcome = 'active'
       ORDER BY s.started_at DESC LIMIT 1`,
    )
    .get(user.id, user.teamId) as
    | {
        id: number; cyberRangeId: number; topologyNodeId: number; protocol: string; expiresAt: string; nodeLabel: string;
        nodeRangeId: number; visible: number; externalKey: string; environmentId: number | null; bastionHostId: string | null; hasTarget: number;
      }
    | undefined;
  if (!s) return null;

  if (new Date(s.expiresAt).getTime() <= Date.now()) {
    expireSession(s.id, user.teamId);
    return null;
  }

  const activeRange = db
    .prepare(`SELECT cyber_range_id AS cyberRangeId FROM team_cyber_range_progress WHERE team_id = ? AND status = 'active' LIMIT 1`)
    .get(user.teamId) as { cyberRangeId: number } | undefined;
  const stillAuthorized =
    !!activeRange &&
    activeRange.cyberRangeId === s.cyberRangeId &&
    s.nodeRangeId === s.cyberRangeId &&
    s.visible === 1 &&
    s.hasTarget === 1 &&
    !!s.environmentId &&
    !!s.bastionHostId;
  if (!stillAuthorized) {
    finishSession(s.id, user.teamId, 'force_closed');
    writeAudit(user.username, 'access_session.ended', 'access_session', s.id, { outcome: 'force_closed', reason: 'no_longer_authorized_on_restore' });
    return null;
  }

  const credential = getResolvedCredential(s.environmentId!);
  if (!credential) return null;
  let url: string | undefined;
  try {
    const links = await listShareableLinks(credential, s.bastionHostId!, [s.externalKey]);
    url = links.find((l) => l.vmId.toLowerCase() === s.externalKey.toLowerCase())?.url;
  } catch (err) {
    // Transient Azure failure: don't end a valid session over it — the client can simply retry.
    console.error('[accessBroker] restore: could not read shareable link:', (err as Error).message);
    return null;
  }
  if (!url) {
    finishSession(s.id, user.teamId, 'completed');
    writeAudit(user.username, 'access_session.ended', 'access_session', s.id, { outcome: 'completed', reason: 'link_gone_on_restore' });
    return null;
  }

  writeAudit(user.username, 'access_session.restored', 'access_session', s.id, null);
  return { accessSessionId: s.id, shareableLinkUrl: url, expiresAt: s.expiresAt, topologyNodeId: s.topologyNodeId, nodeLabel: s.nodeLabel, protocol: s.protocol };
}

export interface EnvironmentRevocation {
  environmentId: number;
  environmentName: string;
  vmCount: number;
  remaining: string[]; // VM labels that still had a live link after revocation
  error: string | null;
}

// Event reset: revoke EVERY shareable link on every registered environment's VMs — not only the ones
// with a currently-active session row. A link can outlive its session (a best-effort cleanup that
// failed, a link made outside this app, a session row already wiped), and a student from the previous
// event already saw the VM credential via "Show", so a surviving link would be a working way back in.
// Then re-reads Bastion per VM to VERIFY nothing is left; `ok` is true only if that check passes.
export async function revokeAllShareableLinks(
  { busyBudgetMs }: { busyBudgetMs?: number } = {},
): Promise<{ ok: boolean; environments: EnvironmentRevocation[] }> {
  const envs = db
    .prepare('SELECT id, name, bastion_host_id AS bastionHostId FROM cloud_environments WHERE bastion_host_id IS NOT NULL')
    .all() as { id: number; name: string; bastionHostId: string }[];

  const environments: EnvironmentRevocation[] = [];
  for (const env of envs) {
    const vms = db
      .prepare(`SELECT external_key AS id, label FROM topology_nodes WHERE environment_id = ? AND node_type = 'vm'`)
      .all(env.id) as { id: string; label: string }[];
    const result: EnvironmentRevocation = { environmentId: env.id, environmentName: env.name, vmCount: vms.length, remaining: [], error: null };
    const credential = getResolvedCredential(env.id);
    if (!credential) {
      result.error = 'no usable credential for this environment';
      result.remaining = vms.map((v) => v.label);
      environments.push(result);
      continue;
    }
    try {
      // Strictly sequential, one batched call at a time: a Bastion host rejects concurrent link
      // operations (409 AnotherOperationInProgress — parallel per-VM deletes failed live), and
      // environments are walked one after another since several can share the same Bastion host.
      const labelFor = (vmId: string) => vms.find((v) => v.id.toLowerCase() === vmId.toLowerCase())?.label ?? vmId;
      const vmIds = vms.map((v) => v.id);
      let live = await listShareableLinks(credential, env.bastionHostId, vmIds, busyBudgetMs);
      if (live.length > 0) {
        await deleteShareableLinks(credential, env.bastionHostId, live.map((l) => l.vmId), busyBudgetMs);
      }
      // Deletion is asynchronous on Azure's side (202) — poll until Bastion really reports no links
      // (or ~60s pass) before reporting anything as still live. Each read itself waits out a busy host.
      for (let attempt = 0; attempt < 12 && live.length > 0; attempt++) {
        await new Promise((r) => setTimeout(r, 5000));
        live = await listShareableLinks(credential, env.bastionHostId, vmIds, busyBudgetMs);
      }
      result.remaining = live.map((l) => labelFor(l.vmId));
    } catch (err) {
      console.error(`[accessBroker] revoke-all failed for environment ${env.id}:`, (err as Error).message.slice(0, 300));
      result.error = classifyAzureError(err).message;
    }
    environments.push(result);
  }

  const ok = environments.every((e) => e.error === null && e.remaining.length === 0);
  return { ok, environments };
}
