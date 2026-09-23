import { getIo } from './io.js';
import { teamRoom, INSTRUCTOR_ROOM } from './rooms.js';

export function emitDocumentationNew(teamId: number, entry: unknown) {
  // teamId travels alongside the entry now that this also reaches every instructor (not just the
  // authoring team's own room) — an instructor's client must be able to tell which team an
  // incoming entry belongs to, since two teams can share the same active cyber range.
  getIo().to([teamRoom(teamId), INSTRUCTOR_ROOM]).emit('documentation:new', { entry, teamId });
}

export function emitHelpRequestNew(helpRequest: unknown) {
  getIo().to(INSTRUCTOR_ROOM).emit('help_request:new', { helpRequest });
}

export function emitHelpRequestResolved(teamId: number, helpRequestId: number) {
  getIo()
    .to([teamRoom(teamId), INSTRUCTOR_ROOM])
    .emit('help_request:resolved', { helpRequestId });
}

export function emitClockTick(teamId: number, progressId: number, remainingSeconds: number) {
  getIo()
    .to([teamRoom(teamId), INSTRUCTOR_ROOM])
    .emit('clock:tick', { progressId, remainingSeconds });
}

export function emitPressureStage(
  teamId: number,
  progressId: number,
  stageLabel: string,
  visualStyle: string,
) {
  getIo()
    .to([teamRoom(teamId), INSTRUCTOR_ROOM])
    .emit('clock:pressure_stage', { progressId, stageLabel, visualStyle });
}

export function emitTimeUp(teamId: number, progressId: number) {
  getIo().to([teamRoom(teamId), INSTRUCTOR_ROOM]).emit('clock:time_up', { progressId });
}

export function emitScoreAwarded(
  teamId: number,
  payload: { score: unknown; isGamified: boolean; teamTotal: number; studentTotal: number | null },
) {
  getIo().to([teamRoom(teamId), INSTRUCTOR_ROOM]).emit('score:awarded', payload);
}

// `enabled` travels with every update so turning the leaderboard OFF reaches already-open pages too
// (previously only enabling it broadcast anything, so students kept seeing a stale board).
export function emitLeaderboardUpdate(teams: unknown, enabled = true) {
  getIo().emit('leaderboard:update', { teams: enabled ? teams : [], enabled });
}

// The instructor assigned, switched or completed a team's scenario — the team's open pages (Home,
// Investigation, Topology) must refetch instead of silently writing to / timing the old one.
export function emitProgressChanged(teamId: number, payload: { cyberRangeId: number; status: string }) {
  getIo().to([teamRoom(teamId), INSTRUCTOR_ROOM]).emit('progress:changed', { teamId, ...payload });
}

// teamId is null for an instructor's own Connect session (not tied to any team) — it only ever
// reaches INSTRUCTOR_ROOM in that case, since there's no team room to also notify.
export function emitAccessSessionStarted(
  teamId: number | null,
  session: { id: number; topologyNodeId: number; protocol: string; expiresAt: string },
) {
  getIo()
    .to(teamId != null ? [teamRoom(teamId), INSTRUCTOR_ROOM] : [INSTRUCTOR_ROOM])
    .emit('access_session:started', { session });
}

export function emitAccessSessionEnded(teamId: number | null, accessSessionId: number, outcome: string) {
  getIo()
    .to(teamId != null ? [teamRoom(teamId), INSTRUCTOR_ROOM] : [INSTRUCTOR_ROOM])
    .emit('access_session:ended', { accessSessionId, outcome });
}

// Investigation Canvas — same "teamId travels alongside the payload" reasoning as
// emitDocumentationNew: an instructor's client receives this for every team, and two teams can
// share the same active cyber range, so cyberRangeId alone can't disambiguate.
export function emitInvestigationCanvasNodeCreated(teamId: number, node: unknown) {
  getIo().to([teamRoom(teamId), INSTRUCTOR_ROOM]).emit('investigation_canvas:node_created', { node, teamId });
}

export function emitInvestigationCanvasNodeUpdated(teamId: number, node: unknown) {
  getIo().to([teamRoom(teamId), INSTRUCTOR_ROOM]).emit('investigation_canvas:node_updated', { node, teamId });
}

export function emitInvestigationCanvasNodeDeleted(teamId: number, nodeId: number) {
  getIo().to([teamRoom(teamId), INSTRUCTOR_ROOM]).emit('investigation_canvas:node_deleted', { nodeId, teamId });
}

export function emitInvestigationCanvasEdgeCreated(teamId: number, edge: unknown) {
  getIo().to([teamRoom(teamId), INSTRUCTOR_ROOM]).emit('investigation_canvas:edge_created', { edge, teamId });
}

export function emitInvestigationCanvasEdgeDeleted(teamId: number, edgeId: number) {
  getIo().to([teamRoom(teamId), INSTRUCTOR_ROOM]).emit('investigation_canvas:edge_deleted', { edgeId, teamId });
}
