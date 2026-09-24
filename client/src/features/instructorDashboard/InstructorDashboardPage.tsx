import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../lib/apiClient';
import { TelemetryBadge } from '../../components/TelemetryBadge';
import { Button } from '../../components/Button';
import { confirmAction } from '../../components/ConfirmDialog';
import { useToastStore } from '../../stores/toastStore';
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
  message: string | null;
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

const selectStyle: React.CSSProperties = {
  marginTop: 4,
  background: 'var(--surface-1)',
  border: '1px solid var(--surface-border)',
  borderRadius: 'var(--radius-control)',
  padding: '4px 6px',
  color: 'var(--text-primary)',
  fontSize: 14,
};

function formatRemaining(seconds: number | null) {
  if (seconds == null) return '—';
  if (seconds <= 0) return "Time's up";
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function isQuiet(team: TeamStatus) {
  return (
    !!team.active &&
    team.memberCount > 0 &&
    (team.active.lastEntryAt == null || Date.now() - new Date(team.active.lastEntryAt).getTime() > STALL_THRESHOLD_SECONDS * 1000)
  );
}

function isOutOfTime(team: TeamStatus) {
  return !!team.active && team.active.remainingSeconds != null && team.active.remainingSeconds <= 0;
}

// Higher = needs the instructor sooner: waiting for help, then out of time, then quiet, then running.
function attentionRank(team: TeamStatus) {
  if (team.openHelpCount > 0) return 4;
  if (isOutOfTime(team)) return 3;
  if (isQuiet(team)) return 2;
  if (team.active) return 1;
  return 0;
}

export function InstructorDashboardPage() {
  const queryClient = useQueryClient();
  const pushToast = useToastStore((s) => s.push);
  const [sortBy, setSortBy] = useState<'attention' | 'name'>('attention');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkRangeId, setBulkRangeId] = useState<number | ''>('');
  const [bulkBusy, setBulkBusy] = useState(false);

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

  function rangeLabel(cyberRangeId: number) {
    const range = catalogData?.cyberRanges.find((r) => r.id === cyberRangeId);
    return range ? `${range.dayLabel} — ${range.name}` : 'this scenario';
  }

  async function handleAssign(team: TeamStatus, cyberRangeId: number) {
    const label = rangeLabel(cyberRangeId);
    // Switching pauses the current scenario mid-exercise — a mis-click on a live team shouldn't do
    // that silently.
    const ok = await confirmAction(
      team.active
        ? {
            title: `Switch ${team.teamName} to "${label}"?`,
            message: `"${team.active.name}" is paused (its history is kept) and the new scenario's clock starts now.`,
            confirmLabel: 'Switch scenario',
          }
        : { title: `Assign "${label}" to ${team.teamName}?`, message: 'Its clock starts now.', confirmLabel: 'Assign' },
    );
    if (ok) assignScenario.mutate({ teamId: team.teamId, cyberRangeId });
  }

  // Restart used to be a "· current (restart)" option hidden inside the switch dropdown.
  async function handleRestart(team: TeamStatus) {
    if (!team.active) return;
    const ok = await confirmAction({
      title: `Restart the clock for ${team.teamName}?`,
      message: `"${team.active.name}" keeps its timeline, but the countdown resets to the full time.`,
      confirmLabel: 'Restart clock',
      danger: true,
    });
    if (ok) assignScenario.mutate({ teamId: team.teamId, cyberRangeId: team.active.cyberRangeId });
  }

  async function handleComplete(team: TeamStatus) {
    if (!team.active) return;
    const ok = await confirmAction({
      title: `Mark "${team.active.name}" completed for ${team.teamName}?`,
      message: 'The team can no longer add entries to it; it moves to their Debrief.',
      confirmLabel: 'Mark completed',
    });
    if (ok) completeScenario.mutate({ teamId: team.teamId, cyberRangeId: team.active.cyberRangeId });
  }

  // Bulk actions: one confirm for N teams instead of N dropdowns and N confirms (UX-12/13).
  async function runBulk(teams: TeamStatus[], action: (team: TeamStatus) => Promise<unknown>, doneLabel: string) {
    setBulkBusy(true);
    let failed = 0;
    for (const team of teams) {
      try {
        await action(team);
      } catch {
        failed += 1;
      }
    }
    setBulkBusy(false);
    setSelected(new Set());
    queryClient.invalidateQueries({ queryKey: ['instructor-dashboard'] });
    pushToast(
      failed
        ? `${doneLabel} for ${teams.length - failed} of ${teams.length} teams (${failed} failed).`
        : `${doneLabel} for ${teams.length} team${teams.length === 1 ? '' : 's'}.`,
      failed ? 'error' : 'success',
    );
  }

  async function handleBulkAssign(teams: TeamStatus[]) {
    if (!bulkRangeId || teams.length === 0) return;
    const rangeId = bulkRangeId;
    const label = rangeLabel(rangeId);
    const switching = teams.filter((t) => t.active && t.active.cyberRangeId !== rangeId).length;
    const restarting = teams.filter((t) => t.active?.cyberRangeId === rangeId).length;
    const ok = await confirmAction({
      title: `Assign "${label}" to ${teams.length} team${teams.length === 1 ? '' : 's'}?`,
      message: [
        'Clocks start now.',
        switching ? `${switching} team(s) are switched from their current scenario (paused, history kept).` : '',
        restarting ? `${restarting} team(s) already on it get their clock restarted.` : '',
      ]
        .filter(Boolean)
        .join(' '),
      confirmLabel: 'Assign to selected',
    });
    if (!ok) return;
    await runBulk(teams, (t) => apiFetch(`/admin/teams/${t.teamId}/cyber-ranges/${rangeId}/start`, { method: 'POST' }), `Assigned "${label}"`);
  }

  async function handleBulkComplete(teams: TeamStatus[], why: string) {
    const withActive = teams.filter((t) => t.active);
    if (withActive.length === 0) return;
    const ok = await confirmAction({
      title: `Mark the current scenario completed for ${withActive.length} team${withActive.length === 1 ? '' : 's'}?`,
      message: `${why}They can no longer add entries; the scenarios move to their Debrief.`,
      confirmLabel: 'Mark completed',
    });
    if (!ok) return;
    await runBulk(
      withActive,
      (t) => apiFetch(`/admin/teams/${t.teamId}/cyber-ranges/${t.active!.cyberRangeId}/complete`, { method: 'POST' }),
      'Marked completed',
    );
  }

  const resolveMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/admin/help-requests/${id}/resolve`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['help-requests', 'open'] });
      queryClient.invalidateQueries({ queryKey: ['instructor-dashboard'] });
    },
  });

  // help_request:new / :resolved are handled once, globally, by useOpenHelpRequestCount (AppShell).
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

  const sortedTeams = [...(dashboardData?.teams ?? [])].sort((a, b) =>
    sortBy === 'name' ? a.teamName.localeCompare(b.teamName) : attentionRank(b) - attentionRank(a) || a.teamName.localeCompare(b.teamName),
  );

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
                <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                  <span style={{ fontSize: 15, color: 'var(--text-primary)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                    <TelemetryBadge tone="alert">{hr.teamName}</TelemetryBadge>
                    <Avatar name={hr.requestedByName} size={22} />
                    {hr.requestedByName} needs help on {hr.cyberRangeName}
                    <span className="tabular" style={{ fontSize: 13, color: 'var(--text-telemetry)' }}>
                      · waiting {formatAgo(hr.createdAt).replace(' ago', '')}
                    </span>
                  </span>
                  {hr.message && <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>“{hr.message}”</span>}
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
                  onClick={async () => {
                    const ok = await confirmAction({
                      title: `Force-close ${s.username}'s ${s.protocol.toUpperCase()} session to ${s.nodeLabel}?`,
                      message: 'The remote session ends immediately and its access link is revoked.',
                      confirmLabel: 'Force close',
                      danger: true,
                    });
                    if (ok) forceCloseSession.mutate(s.id);
                  }}
                >
                  Force close
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {(() => {
        const teams = dashboardData?.teams ?? [];
        const outOfTime = teams.filter(isOutOfTime);
        const selectedTeams = teams.filter((t) => selected.has(t.teamId));
        return (
          <>
            {outOfTime.length > 0 && (
              <div
                role="status"
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 'var(--space-sm)',
                  marginBottom: 'var(--space-md)',
                  padding: 'var(--space-sm) var(--space-md)',
                  border: '1px solid var(--signal-tertiary)',
                  borderRadius: 'var(--radius-control)',
                  background: 'var(--surface-1)',
                  fontSize: 14,
                  color: 'var(--text-primary)',
                }}
              >
                <span>
                  {outOfTime.length} {outOfTime.length === 1 ? 'team is' : 'teams are'} out of time:{' '}
                  {outOfTime.map((t) => t.teamName).join(', ')}
                </span>
                <Button
                  variant="ghost"
                  disabled={bulkBusy}
                  onClick={() => handleBulkComplete(outOfTime, 'Their time is up. ')}
                  style={{ padding: '4px 12px', fontSize: 14 }}
                >
                  Mark all completed
                </Button>
              </div>
            )}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 'var(--space-sm) var(--space-md)',
                marginBottom: 'var(--space-md)',
                fontSize: 14,
                color: 'var(--text-muted)',
              }}
            >
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={teams.length > 0 && selectedTeams.length === teams.length}
                  ref={(el) => {
                    if (el) el.indeterminate = selectedTeams.length > 0 && selectedTeams.length < teams.length;
                  }}
                  onChange={(e) => setSelected(e.target.checked ? new Set(teams.map((t) => t.teamId)) : new Set())}
                />
                {selectedTeams.length > 0 ? `${selectedTeams.length} selected` : 'Select all'}
              </label>
              {selectedTeams.length > 0 && (
                <>
                  <select
                    aria-label="Scenario for selected teams"
                    value={bulkRangeId}
                    onChange={(e) => setBulkRangeId(e.target.value ? Number(e.target.value) : '')}
                    style={{ ...selectStyle, marginTop: 0 }}
                  >
                    <option value="">Scenario…</option>
                    {catalogData?.cyberRanges.map((range) => (
                      <option key={range.id} value={range.id}>
                        {range.dayLabel} — {range.name} ({range.difficulty})
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="ghost"
                    disabled={!bulkRangeId || bulkBusy}
                    onClick={() => handleBulkAssign(selectedTeams)}
                    style={{ padding: '4px 12px', fontSize: 14 }}
                  >
                    Assign to selected
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={bulkBusy || !selectedTeams.some((t) => t.active)}
                    onClick={() => handleBulkComplete(selectedTeams, '')}
                    style={{ padding: '4px 12px', fontSize: 14 }}
                  >
                    Mark selected completed
                  </Button>
                </>
              )}
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                Sort
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value as 'attention' | 'name')} style={{ ...selectStyle, marginTop: 0 }}>
                  <option value="attention">Needs attention first</option>
                  <option value="name">Team name</option>
                </select>
              </label>
            </div>
          </>
        );
      })()}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 'var(--space-md)',
        }}
      >
        {sortedTeams.map((team) => (
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
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  aria-label={`Select ${team.teamName}`}
                  checked={selected.has(team.teamId)}
                  onChange={(e) =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(team.teamId);
                      else next.delete(team.teamId);
                      return next;
                    })
                  }
                />
                <strong style={{ color: 'var(--text-primary)', fontSize: 16 }}>{team.teamName}</strong>
              </label>
              <span style={{ display: 'flex', gap: 6 }}>
                {team.openHelpCount > 0 && <TelemetryBadge tone="alert">{team.openHelpCount} help</TelemetryBadge>}
                {isQuiet(team) && (
                    <span title={`No timeline entry in the last ${STALL_THRESHOLD_SECONDS / 60} minutes — the team may be stuck`}>
                      <TelemetryBadge tone="tertiary">quiet</TelemetryBadge>
                    </span>
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
                <span>{team.active.entryCount} {team.active.entryCount === 1 ? 'entry' : 'entries'}</span>
                <span>{team.active.findingCount} {team.active.findingCount === 1 ? 'finding' : 'findings'}</span>
                <span>last entry {formatAgo(team.active.lastEntryAt)}</span>
              </div>
            )}
            {team.active?.ttp && (
              <div className="tabular" style={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', flexWrap: 'wrap', gap: '2px 12px' }}>
                <span style={{ color: 'var(--signal-secondary)' }} title="Expected ATT&CK techniques this team has identified">
                  ATT&amp;CK {team.active.ttp.detectedCount}/{team.active.ttp.expectedCount}
                </span>
                <span title="ATT&CK points earned / available in this scenario">
                  {team.active.ttp.earnedPoints}/{team.active.ttp.availablePoints} ATT&amp;CK pts
                </span>
                <span>{mttdSummaryLabel(team.active.ttp.mttd)}</span>
              </div>
            )}
            <div className="tabular" style={{ fontSize: 13, color: 'var(--text-telemetry)', display: 'flex', flexWrap: 'wrap', gap: '2px 12px' }}>
              <span style={{ color: 'var(--signal-primary)' }} title="All points this event, every scenario">
                {team.totalPoints} pts total
              </span>
              <span>{team.memberCount} {team.memberCount === 1 ? 'member' : 'members'}</span>
              <span title="Scenarios this team has completed">
                {team.completedCount} {team.completedCount === 1 ? 'scenario' : 'scenarios'} done
              </span>
            </div>
            {/* Jump straight into this team — the other pages open with it already selected. */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 14 }}>
              <Link to={`/investigation?teamId=${team.teamId}`} style={{ color: 'var(--signal-secondary)' }}>
                Timeline
              </Link>
              <Link to={`/progress?teamId=${team.teamId}`} style={{ color: 'var(--signal-secondary)' }}>
                Scoring
              </Link>
              {team.completedCount > 0 && (
                <Link to={`/debrief?teamId=${team.teamId}`} style={{ color: 'var(--signal-secondary)' }}>
                  Debrief
                </Link>
              )}
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
              style={selectStyle}
            >
              <option value="" disabled>
                {team.active ? 'Switch scenario…' : 'Assign scenario…'}
              </option>
              {catalogData?.cyberRanges
                .filter((range) => range.id !== team.active?.cyberRangeId)
                .map((range) => (
                  <option key={range.id} value={range.id}>
                    {range.dayLabel} — {range.name} ({range.difficulty})
                  </option>
                ))}
            </select>
            {team.active && (
              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant="ghost" onClick={() => handleComplete(team)} disabled={completeScenario.isPending} style={{ flex: 1 }}>
                  Mark scenario completed
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => handleRestart(team)}
                  disabled={assignScenario.isPending}
                  title="Reset this scenario's countdown to the full time"
                  style={{ padding: '8px 10px', color: 'var(--text-muted)' }}
                >
                  Restart clock
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
