import { createContext, useContext } from 'react';

// Set by the instructor Team Workspace (/instructor/teams/:teamId): the team-scoped pages embedded in
// its tabs (Investigation, Scoring, Debrief) read the team from here instead of their own picker, and
// hide that picker. null everywhere else, so the standalone pages behave exactly as before.
export const LockedTeamContext = createContext<number | null>(null);

export function useLockedTeam(): number | null {
  return useContext(LockedTeamContext);
}
