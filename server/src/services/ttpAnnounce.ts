import { db } from '../db/index.js';
import { emitLeaderboardUpdate, emitScoreAwarded, emitTtpChanged } from '../sockets/emitters.js';
import { computeLeaderboard, isLeaderboardEnabled, studentTotal, teamTotal } from './scoring.service.js';
import { reconcileTeamTtps, recordScriptOccurrences, teamIdsOnRange, type Credit } from './ttpScoring.service.js';

// Socket side of ATT&CK scoring, split from ttpScoring.service.ts so the scoring core stays testable
// without a Socket.io server. A credit goes out through the SAME score:awarded event a manual award
// uses (live feedback: chime, toast, totals) — there is no separate TTP scoring channel.

function scoreDTO(scoreId: number) {
  return db
    .prepare(
      `SELECT s.id AS id, s.points AS points, s.is_gamified AS isGamified, s.note AS note,
              s.created_at AS createdAt, s.team_id AS teamId, s.student_user_id AS studentUserId,
              s.source AS source, u.display_name AS studentName
       FROM scores s LEFT JOIN users u ON u.id = s.student_user_id
       WHERE s.id = ?`,
    )
    .get(scoreId);
}

export function announceCredits(credits: Pick<Credit, 'scoreId' | 'teamId' | 'creditedUserId'>[]) {
  for (const credit of credits) {
    emitScoreAwarded(credit.teamId, {
      score: scoreDTO(credit.scoreId),
      isGamified: false,
      teamTotal: teamTotal(credit.teamId),
      studentTotal: credit.creditedUserId ? studentTotal(credit.creditedUserId) : null,
    });
  }
}

// Totals changed without a new award (void) — refresh the board if it's on.
export function announceLeaderboard() {
  if (isLeaderboardEnabled()) emitLeaderboardUpdate(computeLeaderboard());
}

export function reconcileAndAnnounce(teamId: number, cyberRangeId: number): Credit[] {
  const credits = reconcileTeamTtps(teamId, cyberRangeId);
  if (credits.length > 0) {
    announceCredits(credits);
    announceLeaderboard();
  }
  emitTtpChanged(teamId, cyberRangeId);
  return credits;
}

// A Run Script execution succeeded. Occurrences only make MTTD measurable — no reconcile, no score —
// so instructors' reports just refresh.
export function recordScriptOccurrencesAndAnnounce(executionId: number) {
  const recorded = recordScriptOccurrences(executionId);
  if (!recorded || recorded.expectedTtpIds.length === 0) return;
  for (const teamId of teamIdsOnRange(recorded.cyberRangeId)) emitTtpChanged(teamId, recorded.cyberRangeId);
}

// After the scenario's expectations change: every team on it is re-evaluated.
export function reconcileRangeAndAnnounce(cyberRangeId: number) {
  for (const teamId of teamIdsOnRange(cyberRangeId)) reconcileAndAnnounce(teamId, cyberRangeId);
}
