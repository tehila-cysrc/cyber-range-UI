import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { TelemetryBadge } from '../../components/TelemetryBadge';
import { Button } from '../../components/Button';
import { useSocketEvent } from '../../hooks/useSocketEvent';

interface TeamStatus {
  teamId: number;
  teamName: string;
  active: {
    cyberRangeId: number;
    name: string;
    difficulty: string;
    dayLabel: string;
    remainingSeconds: number | null;
  } | null;
  openHelpCount: number;
  completedCount: number;
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
  teamName: string;
  username: string;
  nodeLabel: string;
  protocol: string;
  expiresAt: string;
}

function formatRemaining(seconds: number | null) {
  if (seconds == null) return '—';
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
  });

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
    <div style={{ padding: 'var(--space-xl)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
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
          <h2 style={{ fontSize: 15, color: 'var(--text-muted)', margin: '0 0 var(--space-sm)' }}>
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
                <span style={{ fontSize: 15, color: 'var(--text-primary)' }}>
                  <TelemetryBadge tone="alert">{hr.teamName}</TelemetryBadge>{' '}
                  {hr.requestedByName} needs help on {hr.cyberRangeName}
                </span>
                <Button variant="ghost" onClick={() => resolveMutation.mutate(hr.id)}>
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
                  <TelemetryBadge tone="primary">{s.teamName}</TelemetryBadge>{' '}
                  {s.username} · {s.protocol.toUpperCase()} to {s.nodeLabel} · expires {new Date(s.expiresAt).toLocaleTimeString()}
                </span>
                <Button variant="destructive" onClick={() => forceCloseSession.mutate(s.id)}>
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
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong style={{ color: 'var(--text-primary)', fontSize: 16 }}>{team.teamName}</strong>
              {team.openHelpCount > 0 && <TelemetryBadge tone="alert">{team.openHelpCount} help</TelemetryBadge>}
            </div>
            {team.active ? (
              <>
                <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
                  {team.active.dayLabel} — {team.active.name} ({team.active.difficulty})
                </div>
                <div className="tabular" style={{ fontSize: 18, color: 'var(--signal-primary)' }}>
                  {formatRemaining(team.active.remainingSeconds)}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 14, color: 'var(--text-telemetry)' }}>No active Cyber Range</div>
            )}
            <div style={{ fontSize: 13, color: 'var(--text-telemetry)' }}>
              Completed: {team.completedCount}
            </div>
            <select
              key={team.active?.cyberRangeId ?? 'none'}
              defaultValue=""
              disabled={assignScenario.isPending}
              onChange={(e) => {
                const cyberRangeId = Number(e.target.value);
                if (!cyberRangeId) return;
                assignScenario.mutate({ teamId: team.teamId, cyberRangeId });
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
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}
