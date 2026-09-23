import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { TelemetryBadge } from '../../components/TelemetryBadge';
import { Button } from '../../components/Button';
import { Avatar } from '../../components/Avatar';
import { LifeBuoyIcon } from '../../components/icons';
import { useSocketEvent } from '../../hooks/useSocketEvent';
import { mttdSummaryLabel, type MttdSummary } from '../../lib/mitre';

interface TeamStatus {
  teamId: number;
  teamName: string;
  active: {
    cyberRangeId: number;
    name: string;
    difficulty: string;
    dayLabel: string;
    remainingSeconds: number | null;
    entryCount: number;
    findingCount: number;
    lastEntryAt: string | null;
    // null = the scenario defines no expected ATT&CK techniques.
    ttp: {
      earnedPoints: number;
      availablePoints: number;
      expectedCount: number;
      detectedCount: number;
      mttd: MttdSummary;
    } | null;
  } | null;
  openHelpCount: number;
  completedCount: number;
  totalPoints: number;
  memberCount: number;
}

interface HelpRequest {
  id: number;
  status: string;
  createdAt: string;
  teamName: string;
  cyberRangeName: string;
  requestedByName: string;
}

interface CatalogCyberRange {
  id: number;
  name: string;
  difficulty: string;
  dayLabel: string;
}

interface ActiveAccessSession {
  id: number;
  teamName: string | null; // null = an instructor's own Connect session, not tied to any team
  username: string;
  nodeLabel: string;
  protocol: string;
  expiresAt: string;
}

// "5m ago" — how long a team has been waiting for help / since it last documented anything.
function formatAgo(iso: string | null) {
  if (!iso) return 'never';
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m ago`;
}

// A team with an active scenario but no timeline entry for this long is flagged as possibly stuck.
const STALL_THRESHOLD_SECONDS = 20 * 60;

function formatRemaining(seconds: number | null) {
  if (seconds == null) return '—';
  if (seconds <= 0) return "Time's up";
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function InstructorDashboardPage() {
  const queryClient = useQueryClient();

  const { data: dashboardData } = useQuery({
    queryKey: ['instructor-dashboard'],
    queryFn: () => apiFetch<{ teams: TeamStatus[] }>('/admin/dashboard'),
    refetchInterval: 5000,
  });

  const { data: scoringConfig } = useQuery({
    queryKey: ['scoring-config'],
    queryFn: () => apiFetch<{ config: { leaderboardEnabled: number } }>('/admin/scoring-config'),
  });

  const toggleLeaderboard = useMutation({
    mutationFn: (enabled: boolean) =>
      apiFetch('/admin/scoring-config', {
        method: 'PUT',
        body: JSON.stringify({ leaderboardEnabled: enabled }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scoring-config'] }),
  });

  const { data: helpData } = useQuery({
    queryKey: ['help-requests', 'open'],
    queryFn: () => apiFetch<{ helpRequests: HelpRequest[] }>('/admin/help-requests?status=open'),
  });

  const { data: catalogData } = useQuery({
    queryKey: ['cyber-ranges-catalog'],
    queryFn: () => apiFetch<{ cyberRanges: CatalogCyberRange[] }>('/cyber-ranges'),
  });

  // Override of a team's self-service choice (see client/src/features/activeCyberRange) — for
  // getting a stuck team unstuck without needing curl.
  const assignScenario = useMutation({
    mutationFn: ({ teamId, cyberRangeId }: { teamId: number; cyberRangeId: number }) =>
      apiFetch(`/admin/teams/${teamId}/cyber-ranges/${cyberRangeId}/start`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['instructor-dashboard'] }),
  });

  // The /complete endpoint had no UI before, so no scenario could ever reach "completed" and the
  // Debrief pages stayed empty for every team.
  const completeScenario = useMutation({
    mutationFn: ({ teamId, cyberRangeId }: { teamId: number; cyberRangeId: number }) =>
      apiFetch(`/admin/teams/${teamId}/cyber-ranges/${cyberRangeId}/complete`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['instructor-dashboard'] }),
  });

  function handleAssign(team: TeamStatus, cyberRangeId: number) {
    const range = catalogData?.cyberRanges.find((r) => r.id === cyberRangeId);
    const label = range ? `${range.dayLabel} — ${range.name}` : 'this scenario';
    // Assigning restarts the scenario's clock, and switching pauses the current one mid-exercise —
    // a mis-click on a live team shouldn't do that silently.
    const message =
      team.active?.cyberRangeId === cyberRangeId
        ? `Restart "${label}" for ${team.teamName}? Its countdown resets to the full time.`
        : team.active
          ? `Switch ${team.teamName} from "${team.active.name}" to "${label}"? The current scenario is paused and the new one's clock starts now.`
          : `Assign "${label}" to ${team.teamName}? Its clock starts now.`;
    if (!window.confirm(message)) return;
    assignScenario.mutate({ teamId: team.teamId, cyberRangeId });
  }

  function handleComplete(team: TeamStatus) {
    if (!team.active) return;
    if (!window.confirm(`Mark "${team.active.name}" as completed for ${team.teamName}? The team can no longer add entries to it; it moves to their Debrief.`)) return;
    completeScenario.mutate({ teamId: team.teamId, cyberRangeId: team.active.cyberRangeId });
  }

  const resolveMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/admin/help-requests/${id}/resolve`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['help-requests', 'open'] });
      queryClient.invalidateQueries({ queryKey: ['instructor-dashboard'] });
    },
  });

  useSocketEvent('help_request:new', () => {
    queryClient.invalidateQueries({ queryKey: ['help-requests', 'open'] });
    queryClient.invalidateQueries({ queryKey: ['instructor-dashboard'] });
  });
  useSocketEvent('help_request:resolved', () => {
    queryClient.invalidateQueries({ queryKey: ['help-requests', 'open'] });
    queryClient.invalidateQueries({ queryKey: ['instructor-dashboard'] });
  });
  useSocketEvent('documentation:new', () => queryClient.invalidateQueries({ queryKey: ['instructor-dashboard'] }));
  useSocketEvent('score:awarded', () => queryClient.invalidateQueries({ queryKey: ['instructor-dashboard'] }));

  const { data: accessSessionsData } = useQuery({
    queryKey: ['access-sessions'],
    queryFn: () => apiFetch<{ sessions: ActiveAccessSession[] }>('/admin/access-sessions'),
  });

  const forceCloseSession = useMutation({
    mutationFn: (id: number) => apiFetch(`/admin/access-sessions/${id}/force-close`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['access-sessions'] }),
  });

  useSocketEvent('access_session:started', () => queryClient.invalidateQueries({ queryKey: ['access-sessions'] }));
  useSocketEvent('access_session:ended', () => queryClient.invalidateQueries({ queryKey: ['access-sessions'] }));

  return (
    <div className="page" style={{ padding: 'var(--space-xl)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-md)', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1 style={{ fontSize: 22, color: 'var(--text-primary)', margin: '0 0 var(--space-md)' }}>
          Instructor Dashboard
        </h1>
        <label style={{ fontSize: 14, color: 'var(--text-muted)', display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={scoringConfig?.config.leaderboardEnabled === 1}
            onChange={(e) => toggleLeaderboard.mutate(e.target.checked)}
          />
          Leaderboard enabled
        </label>
      </div>

      {helpData && helpData.helpRequests.length > 0 && (
        <div style={{ marginBottom: 'var(--space-xl)' }}>
          <h2
            style={{
              fontSize: 15,
              color: 'var(--text-muted)',
              margin: '0 0 var(--space-sm)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <LifeBuoyIcon style={{ color: 'var(--signal-alert)' }} />
            Open help requests
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            {helpData.helpRequests.map((hr) => (
              <div
                key={hr.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: 'var(--space-sm) var(--space-md)',
                  border: '1px solid var(--signal-alert)',
                  borderRadius: 'var(--radius-control)',
                  background: 'var(--surface-1)',
                }}
              >
                <span style={{ fontSize: 15, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <TelemetryBadge tone="alert">{hr.teamName}</TelemetryBadge>
                  <Avatar name={hr.requestedByName} size={22} />
                  {hr.requestedByName} needs help on {hr.cyberRangeName}
                  <span className="tabular" style={{ fontSize: 13, color: 'var(--text-telemetry)' }}>
                    · waiting {formatAgo(hr.createdAt).replace(' ago', '')}
                  </span>
                </span>
                <Button variant="ghost" onClick={() => resolveMutation.mutate(hr.id)} disabled={resolveMutation.isPending}>
                  Resolve
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {accessSessionsData && accessSessionsData.sessions.length > 0 && (
        <div style={{ marginBottom: 'var(--space-xl)' }}>
          <h2 style={{ fontSize: 15, color: 'var(--text-muted)', margin: '0 0 var(--space-sm)' }}>
            Active access sessions
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            {accessSessionsData.sessions.map((s) => (
              <div
                key={s.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: 'var(--space-sm) var(--space-md)',
                  border: '1px solid var(--signal-primary)',
                  borderRadius: 'var(--radius-control)',
                  background: 'var(--surface-1)',
                }}
              >
                <span style={{ fontSize: 15, color: 'var(--text-primary)' }}>
                  <TelemetryBadge tone="primary">{s.teamName ?? 'Instructor'}</TelemetryBadge>{' '}
                  {s.username} · {s.protocol.toUpperCase()} to {s.nodeLabel} · expires {new Date(s.expiresAt).toLocaleTimeString()}
                </span>
                <Button
                  variant="destructive"
                  onClick={() => {
                    if (window.confirm(`Force-close ${s.username}'s ${s.protocol.toUpperCase()} session to ${s.nodeLabel}?`)) forceCloseSession.mutate(s.id);
                  }}
                >
                  Force close
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 'var(--space-md)',
        }}
      >
        {dashboardData?.teams.map((team) => (
          <div
            key={team.teamId}
            style={{
              padding: 'var(--space-md)',
              border: '1px solid var(--surface-border)',
              borderRadius: 'var(--radius-container)',
              background: 'var(--surface-1)',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              <strong style={{ color: 'var(--text-primary)', fontSize: 16 }}>{team.teamName}</strong>
              <span style={{ display: 'flex', gap: 6 }}>
                {team.openHelpCount > 0 && <TelemetryBadge tone="alert">{team.openHelpCount} help</TelemetryBadge>}
                {team.active &&
                  (team.active.lastEntryAt == null ||
                    Date.now() - new Date(team.active.lastEntryAt).getTime() > STALL_THRESHOLD_SECONDS * 1000) && (
                    <TelemetryBadge tone="tertiary">quiet</TelemetryBadge>
                  )}
              </span>
            </div>
            {team.active ? (
              <>
                <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
                  {team.active.dayLabel} — {team.active.name} ({team.active.difficulty})
                </div>
                <div
                  className="tabular"
                  style={{
                    fontSize: 18,
                    // Same expired treatment as the student's own mission-window clock.
                    color: team.active.remainingSeconds != null && team.active.remainingSeconds <= 0 ? 'var(--signal-alert)' : 'var(--signal-primary)',
                  }}
                >
                  {formatRemaining(team.active.remainingSeconds)}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 14, color: 'var(--text-telemetry)' }}>No active Cyber Range</div>
            )}
            {team.active && (
              <div className="tabular" style={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', flexWrap: 'wrap', gap: '2px 12px' }}>
                <span>{team.active.entryCount} entries</span>
                <span>{team.active.findingCount} findings</span>
                <span>last entry {formatAgo(team.active.lastEntryAt)}</span>
              </div>
            )}
            {team.active?.ttp && (
              <div className="tabular" style={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', flexWrap: 'wrap', gap: '2px 12px' }}>
                <span style={{ color: 'var(--signal-secondary)' }}>
                  ATT&amp;CK {team.active.ttp.detectedCount}/{team.active.ttp.expectedCount}
                </span>
                <span>
                  {team.active.ttp.earnedPoints}/{team.active.ttp.availablePoints} pts
                </span>
                <span>{mttdSummaryLabel(team.active.ttp.mttd)}</span>
              </div>
            )}
            <div className="tabular" style={{ fontSize: 13, color: 'var(--text-telemetry)', display: 'flex', flexWrap: 'wrap', gap: '2px 12px' }}>
              <span style={{ color: 'var(--signal-primary)' }}>{team.totalPoints} pts</span>
              <span>{team.memberCount} {team.memberCount === 1 ? 'member' : 'members'}</span>
              <span>Completed: {team.completedCount}</span>
            </div>
            <select
              key={team.active?.cyberRangeId ?? 'none'}
              defaultValue=""
              disabled={assignScenario.isPending}
              aria-label={`Assign scenario to ${team.teamName}`}
              onChange={(e) => {
                const cyberRangeId = Number(e.target.value);
                e.target.value = '';
                if (!cyberRangeId) return;
                handleAssign(team, cyberRangeId);
              }}
              style={{
                marginTop: 4,
                background: 'var(--surface-1)',
                border: '1px solid var(--surface-border)',
                borderRadius: 'var(--radius-control)',
                padding: '4px 6px',
                color: 'var(--text-primary)',
                fontSize: 14,
              }}
            >
              <option value="" disabled>
                {team.active ? 'Switch scenario…' : 'Assign scenario…'}
              </option>
              {catalogData?.cyberRanges.map((range) => (
                <option key={range.id} value={range.id}>
                  {range.dayLabel} — {range.name} ({range.difficulty})
                  {range.id === team.active?.cyberRangeId ? ' · current (restart)' : ''}
                </option>
              ))}
            </select>
            {team.active && (
              <Button variant="ghost" onClick={() => handleComplete(team)} disabled={completeScenario.isPending}>
                Mark scenario completed
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
