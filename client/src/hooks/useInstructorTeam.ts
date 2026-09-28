import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLockedTeam } from '../features/team/LockedTeamContext';

const STORAGE_KEY = 'cyber-range-instructor-team';

function readStored(): number | '' {
  try {
    return Number(sessionStorage.getItem(STORAGE_KEY)) || '';
  } catch {
    return '';
  }
}

function writeStored(teamId: number | '') {
  try {
    if (teamId) sessionStorage.setItem(STORAGE_KEY, String(teamId));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked (private window etc.) — the URL still carries the team.
  }
}

// The instructor's selected team on team-scoped pages (Investigation, Scoring). Lives in `?teamId=`
// so Dashboard links, refreshes and back/forward keep it; with no param, falls back to the team last
// picked in this tab — re-picking the same team on every page was the most repeated action in a
// live session (UX audit UX-11).
export function useInstructorTeam(): [number | '', (teamId: number | '') => void] {
  const locked = useLockedTeam();
  const [params, setParams] = useSearchParams();
  const fromUrl = Number(params.get('teamId')) || '';
  // Inside the Team Workspace the team is fixed by the page; it is also remembered so the standalone
  // pages open on the same team afterwards.
  const teamId = locked ?? (fromUrl || readStored());

  useEffect(() => {
    if (locked) writeStored(locked);
    else if (fromUrl) writeStored(fromUrl);
  }, [fromUrl, locked]);

  const setTeamId = useCallback(
    (next: number | '') => {
      if (locked) return;
      writeStored(next);
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next) p.set('teamId', String(next));
          else p.delete('teamId');
          return p;
        },
        { replace: true },
      );
    },
    [setParams, locked],
  );

  return [teamId, setTeamId];
}
