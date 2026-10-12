import { db } from '../db/index.js';
import { emitBroadcastSignal, emitScoped, emitToUserAndAdmins } from './scopedEmit.js';

// Every event about a team's work names the scenario it belongs to, so staff delivery can be scoped
// per (organization, scenario) pair — see scopedEmit.ts. `null` = a team-level event (organization
// scope). Nothing here emits to a room of all staff.

export function emitDocumentationNew(teamId: number, cyberRangeId: number, entry: unknown) {
  // teamId travels alongside the entry: a staff client sees several teams, and two teams can share
  // the same active cyber range.
  emitScoped(teamId, cyberRangeId, 'documentation:new', { entry, teamId });
}

// An existing entry's ATT&CK tags or feedback changed (entries are otherwise append-only). Same
// recipients and shape as documentation:new so timelines update in place.
export function emitDocumentationUpdated(teamId: number, cyberRangeId: number, entry: unknown) {
  emitScoped(teamId, cyberRangeId, 'documentation:updated', { entry, teamId });
}

// Team only: lets the team's clients raise a toast on any page ("the instructor commented on an entry").
// The updated entry itself travels via documentation:updated.
export function emitDocumentationFeedback(teamId: number, payload: { entryId: number; cyberRangeId: number }) {
  emitScoped(teamId, payload.cyberRangeId, 'documentation:feedback', payload, { team: true });
}

// Also to the team's room, so every teammate's page shows the request as pending (not just the
// student who clicked) — the payload is the team's own request, nothing staff-only.
export function emitHelpRequestNew(teamId: number, cyberRangeId: number, helpRequest: unknown) {
  emitScoped(teamId, cyberRangeId, 'help_request:new', { helpRequest });
}

// reason lets the team's page say what happened: the instructor handled it, or the scenario ended.
export function emitHelpRequestResolved(
  teamId: number,
  cyberRangeId: number,
  helpRequestId: number,
  reason: 'instructor' | 'scenario_ended' = 'instructor',
) {
  emitScoped(teamId, cyberRangeId, 'help_request:resolved', { helpRequestId, reason });
}

export function emitClockTick(teamId: number, cyberRangeId: number, progressId: number, remainingSeconds: number) {
  emitScoped(teamId, cyberRangeId, 'clock:tick', { progressId, remainingSeconds });
}

export function emitPressureStage(teamId: number, cyberRangeId: number, progressId: number, stageLabel: string, visualStyle: string) {
  emitScoped(teamId, cyberRangeId, 'clock:pressure_stage', { progressId, stageLabel, visualStyle });
}

export function emitTimeUp(teamId: number, cyberRangeId: number, progressId: number) {
  emitScoped(teamId, cyberRangeId, 'clock:time_up', { progressId });
}

export function emitScoreAwarded(
  teamId: number,
  cyberRangeId: number | null,
  payload: { score: unknown; isGamified: boolean; teamTotal: number; studentTotal: number | null },
) {
  emitScoped(teamId, cyberRangeId, 'score:awarded', payload);
}

// A cyber range's student topology was (re)published — open student topology pages refetch. Only the
// range id travels; students re-read through the normal team-scoped GET.
export function emitTopologyPublished(cyberRangeId: number) {
  emitBroadcastSignal('topology:published', { cyberRangeId });
}

// A bare "changed" signal: totals or team->organization links moved. No teams travel, because each
// viewer's board is scoped differently (admin: all; instructor: assigned organizations; student: own
// organization) — clients refetch GET /leaderboard, which applies that scope.
export function emitLeaderboardUpdate() {
  emitBroadcastSignal('leaderboard:update', {});
}

// Staff assigned, switched or completed a team's scenario — the team's open pages (Home,
// Investigation, Topology) must refetch instead of silently writing to / timing the old one.
export function emitProgressChanged(teamId: number, payload: { cyberRangeId: number; status: string }) {
  emitScoped(teamId, payload.cyberRangeId, 'progress:changed', { teamId, ...payload });
}

// ATT&CK detections changed for a team (credit, void, manual credit, expected-TTP edit). Staff ONLY —
// the payload is just ids, and the team learns about its own credits through the regular
// score:awarded event; nothing here may hint at expected-but-undetected techniques.
export function emitTtpChanged(teamId: number, cyberRangeId: number) {
  emitScoped(teamId, cyberRangeId, 'ttp:changed', { teamId, cyberRangeId }, { staff: true });
}

interface SessionRow {
  teamId: number | null;
  userId: number;
  cyberRangeId: number;
}

function sessionRow(accessSessionId: number): SessionRow | undefined {
  return db
    .prepare('SELECT team_id AS teamId, user_id AS userId, cyber_range_id AS cyberRangeId FROM access_sessions WHERE id = ?')
    .get(accessSessionId) as SessionRow | undefined;
}

// A student session: the team + in-scope staff. A staff member's own Connect session (no team): only
// its owner and the admins — never every instructor.
function emitSession(accessSessionId: number, event: string, payload: unknown) {
  const row = sessionRow(accessSessionId);
  if (!row) return;
  if (row.teamId === null) emitToUserAndAdmins(row.userId, event, payload);
  else emitScoped(row.teamId, row.cyberRangeId, event, payload);
}

export function emitAccessSessionStarted(session: { id: number; topologyNodeId: number; protocol: string; expiresAt: string }) {
  emitSession(session.id, 'access_session:started', { session });
}

export function emitAccessSessionEnded(accessSessionId: number, outcome: string) {
  emitSession(accessSessionId, 'access_session:ended', { accessSessionId, outcome });
}

// Investigation Canvas — same "teamId travels alongside the payload" reasoning as
// emitDocumentationNew.
export function emitInvestigationCanvasNodeCreated(teamId: number, cyberRangeId: number, node: unknown) {
  emitScoped(teamId, cyberRangeId, 'investigation_canvas:node_created', { node, teamId });
}

export function emitInvestigationCanvasNodeUpdated(teamId: number, cyberRangeId: number, node: unknown) {
  emitScoped(teamId, cyberRangeId, 'investigation_canvas:node_updated', { node, teamId });
}

export function emitInvestigationCanvasNodeDeleted(teamId: number, cyberRangeId: number, nodeId: number) {
  emitScoped(teamId, cyberRangeId, 'investigation_canvas:node_deleted', { nodeId, teamId });
}

export function emitInvestigationCanvasEdgeCreated(teamId: number, cyberRangeId: number, edge: unknown) {
  emitScoped(teamId, cyberRangeId, 'investigation_canvas:edge_created', { edge, teamId });
}

export function emitInvestigationCanvasEdgeDeleted(teamId: number, cyberRangeId: number, edgeId: number) {
  emitScoped(teamId, cyberRangeId, 'investigation_canvas:edge_deleted', { edgeId, teamId });
}

// Staff granted/revoked a student's certificate. A bare signal to the team's room — each student
// refetches their own GET /teams/me/certificate (the grant is per student, not per team).
export function emitCertificateChanged(teamId: number) {
  emitScoped(teamId, null, 'certificate:changed', {}, { team: true });
}
