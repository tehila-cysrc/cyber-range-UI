import { getIo } from './io.js';
import { teamRoom, INSTRUCTOR_ROOM } from './rooms.js';

export function emitDocumentationNew(teamId: number, entry: unknown) {
  getIo().to(teamRoom(teamId)).emit('documentation:new', { entry });
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

export function emitAccessSessionStarted(
  teamId: number,
  session: { id: number; topologyNodeId: number; protocol: string; expiresAt: string },
) {
  getIo()
    .to([teamRoom(teamId), INSTRUCTOR_ROOM])
    .emit('access_session:started', { session });
}

export function emitAccessSessionEnded(teamId: number, accessSessionId: number, outcome: string) {
  getIo()
    .to([teamRoom(teamId), INSTRUCTOR_ROOM])
    .emit('access_session:ended', { accessSessionId, outcome });
}
