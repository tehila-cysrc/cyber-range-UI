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

export function emitLeaderboardUpdate(teams: unknown) {
  getIo().emit('leaderboard:update', { teams });
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
