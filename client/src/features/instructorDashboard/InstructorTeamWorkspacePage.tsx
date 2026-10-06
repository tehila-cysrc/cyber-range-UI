import { useEffect, useState, type CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../../lib/apiClient';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { TelemetryBadge } from '../../components/TelemetryBadge';
import { LifeBuoyIcon } from '../../components/icons';
import { confirmAction } from '../../components/ConfirmDialog';
import { mttdSummaryLabel, type MttdSummary } from '../../lib/mitre';
import { LockedTeamContext } from '../team/LockedTeamContext';
import { InvestigationPage } from '../documentation/InvestigationPage';
import { InstructorScoringPanel } from '../scoring/InstructorScoringPanel';
import { HistoryPage } from '../history/HistoryPage';
import { CyberRangeSummaryPage } from '../history/CyberRangeSummaryPage';
import { EventSummaryPage } from '../history/EventSummaryPage';

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
    ttp: { earnedPoints: number; availablePoints: number; expectedCount: number; detectedCount: number; mttd: MttdSummary } | null;
  } | null;
  openHelpCount: number;
  completedCount: number;
  totalPoints: number;
  memberCount: number;
}

interface HelpRequest {
  id: number;
  createdAt: string;
  teamId: number;
  cyberRangeName: string;
  requestedByName: string;
  message: string | null;
}

interface TeamRoster {
  id: number;
  members: { id: number; displayName: string; avatar?: string | null }[];
}

interface CatalogCyberRange {
  id: number;
  name: string;
  difficulty: string;
  dayLabel: string;
}

type WorkspaceTab = 'investigation' | 'scoring' | 'debrief';
const TABS: { key: WorkspaceTab; label: string }[] = [
  { key: 'investigation', label: 'Timeline & Canvas' },
  { key: 'scoring', label: 'Scoring' },
  { key: 'debrief', label: 'Debrief' },
];

const selectStyle: CSSProperties = {
  background: 'var(--surface-1)',
  border: '1px solid var(--surface-border)',
  borderRadius: 'var(--radius-control)',
  padding: '6px 8px',
  color: 'var(--text-primary)',
  fontSize: 14,
};

function formatRemaining(seconds: number | null) {
  if (seconds == null) return 'No time limit';
  if (seconds <= 0) return "Time's up";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h > 0 ? `${h}:` : ''}${String(m).padStart(h > 0 ? 2 : 1, '0')}:${String(s).padStart(2, '0')} left`;
}

function formatAgo(iso: string) {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m ago`;
}

// One page per team for the instructor (UX-11/29): status, open help, scenario actions and the
// team's Timeline/Canvas, Scoring and Debrief in tabs — no re-picking the team on every page. The
// tabs are the existing pages, rendered with the team locked through LockedTeamContext; the
// standalone pages and their ?teamId= links are unchanged.
export function InstructorTeamWorkspacePage() {
  const teamId = Number(useParams().teamId) || null;
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const tab: WorkspaceTab = (TABS.find((t) => t.key === params.get('tab'))?.key ?? 'investigation') as WorkspaceTab;
  const debriefRange = params.get('range');

  const { data: dashboardData, dataUpdatedAt } = useQuery({
    queryKey: ['instructor-dashboard'],
    queryFn: () => apiFetch<{ teams: TeamStatus[] }>('/admin/dashboard'),
    refetchInterval: 5000,
  });
  const { data: helpData } = useQuery({
    queryKey: ['help-requests', 'open'],
    queryFn: () => apiFetch<{ helpRequests: HelpRequest[] }>('/admin/help-requests?status=open'),
  });
  const { data: rosterData } = useQuery({
    queryKey: ['admin-teams-list'],
    queryFn: () => apiFetch<{ teams: TeamRoster[] }>('/admin/teams'),
  });
  const { data: catalogData } = useQuery({
    queryKey: ['cyber-ranges-catalog'],
    queryFn: () => apiFetch<{ cyberRanges: CatalogCyberRange[] }>('/cyber-ranges'),
  });

  // The dashboard payload refreshes every 5s; tick the countdown locally in between.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const invalidateTeam = () => {
    queryClient.invalidateQueries({ queryKey: ['instructor-dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['help-requests', 'open'] });
  };
  const startScenario = useMutation({
    mutationFn: (cyberRangeId: number) => apiFetch(`/admin/teams/${teamId}/cyber-ranges/${cyberRangeId}/start`, { method: 'POST' }),
    onSuccess: invalidateTeam,
  });
  const completeScenario = useMutation({
    mutationFn: (cyberRangeId: number) => apiFetch(`/admin/teams/${teamId}/cyber-ranges/${cyberRangeId}/complete`, { method: 'POST' }),
    onSuccess: invalidateTeam,
  });
  const resolveHelp = useMutation({
    mutationFn: (id: number) => apiFetch(`/admin/help-requests/${id}/resolve`, { method: 'POST' }),
    onSuccess: invalidateTeam,
  });

  const teams = dashboardData?.teams ?? [];
  const team = teams.find((t) => t.teamId === teamId);
  const members = rosterData?.teams.find((t) => t.id === teamId)?.members ?? [];
  const openHelp = (helpData?.helpRequests ?? []).filter((hr) => hr.teamId === teamId);

  if (dashboardData && !team) {
    return (
      <div className="page" style={{ padding: 'var(--space-xl)' }}>
        <EmptyState message="This team doesn't exist any more." />
        <Link to="/instructor" style={{ color: 'var(--signal-secondary)', fontSize: 14 }}>
          ← Back to dashboard
        </Link>
      </div>
    );
  }

  const active = team?.active ?? null;
  const remaining =
    active?.remainingSeconds == null ? null : Math.max(0, active.remainingSeconds - Math.floor((now - dataUpdatedAt) / 1000));

  function setTab(next: WorkspaceTab) {
    // Switching tabs drops the other tabs' sub-state (canvas view, open debrief scenario).
    setParams(next === 'investigation' ? {} : { tab: next }, { replace: true });
  }

  function switchTeam(nextTeamId: number) {
    navigate(`/instructor/teams/${nextTeamId}${tab === 'investigation' ? '' : `?tab=${tab}`}`);
  }

  async function handleAssign(cyberRangeId: number) {
    const range = catalogData?.cyberRanges.find((r) => r.id === cyberRangeId);
    const label = range ? `${range.dayLabel} — ${range.name}` : 'this scenario';
    const ok = await confirmAction(
      active
        ? {
            title: `Switch ${team!.teamName} to "${label}"?`,
            message: `"${active.name}" is paused (its history is kept) and the new scenario's clock starts now.`,
            confirmLabel: 'Switch scenario',
          }
        : { title: `Assign "${label}" to ${team!.teamName}?`, message: 'Its clock starts now.', confirmLabel: 'Assign' },
    );
    if (ok) startScenario.mutate(cyberRangeId);
  }

  async function handleRestart() {
    if (!active) return;
    const ok = await confirmAction({
      title: `Restart the clock for ${team!.teamName}?`,
      message: `"${active.name}" keeps its timeline, but the countdown resets to the full time.`,
      confirmLabel: 'Restart clock',
      danger: true,
    });
    if (ok) startScenario.mutate(active.cyberRangeId);
  }

  async function handleComplete() {
    if (!active) return;
    const ok = await confirmAction({
      title: `Mark "${active.name}" completed for ${team!.teamName}?`,
      message: 'The team can no longer add entries to it; it moves to their Debrief.',
      confirmLabel: 'Mark completed',
    });
    if (ok) completeScenario.mutate(active.cyberRangeId);
  }

  return (
    <div className="page" style={{ padding: 'var(--space-xl)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-sm)' }}>
        <Link to="/instructor" style={{ fontSize: 14, color: 'var(--signal-secondary)' }}>
          ← Dashboard
        </Link>
        <select aria-label="Switch team" value={teamId ?? ''} onChange={(e) => switchTeam(Number(e.target.value))} style={selectStyle}>
          {teams.map((t) => (
            <option key={t.teamId} value={t.teamId}>
              {t.teamName}
              {t.openHelpCount > 0 ? ' · help' : ''}
            </option>
          ))}
        </select>
      </div>

      <div
        style={{
          padding: 'var(--space-md)',
          border: `1px solid ${openHelp.length > 0 ? 'var(--signal-alert)' : 'var(--surface-border)'}`,
          borderRadius: 'var(--radius-container)',
          background: 'var(--surface-1)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-sm)',
          marginBottom: 'var(--space-lg)',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-md)' }}>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: 22, color: 'var(--text-primary)', margin: 0 }}>{team?.teamName ?? '…'}</h1>
            <div style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 2 }}>
              {active ? `${active.dayLabel} — ${active.name} (${active.difficulty})` : 'No active scenario'}
            </div>
          </div>
          {active && (
            <div className="tabular" style={{ fontSize: 20, color: remaining != null && remaining <= 0 ? 'var(--signal-alert)' : 'var(--signal-primary)' }}>
              {formatRemaining(remaining)}
            </div>
          )}
        </div>

        {team && (
          <div className="tabular" style={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', flexWrap: 'wrap', gap: '2px 14px' }}>
            {active && (
              <>
                <span>
                  {active.entryCount} {active.entryCount === 1 ? 'entry' : 'entries'}
                </span>
                <span>
                  {active.findingCount} {active.findingCount === 1 ? 'finding' : 'findings'}
                </span>
                {active.ttp && (
                  <>
                    <span style={{ color: 'var(--signal-secondary)' }}>
                      ATT&amp;CK {active.ttp.detectedCount}/{active.ttp.expectedCount}
                    </span>
                    <span>{mttdSummaryLabel(active.ttp.mttd)}</span>
                  </>
                )}
              </>
            )}
            <span style={{ color: 'var(--signal-primary)' }}>{team.totalPoints} pts total</span>
            <span>
              {team.completedCount} {team.completedCount === 1 ? 'scenario' : 'scenarios'} done
            </span>
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          {members.length === 0 ? (
            <span style={{ fontSize: 13, color: 'var(--text-telemetry)' }}>No members yet — add students on the Teams &amp; Students page.</span>
          ) : (
            members.map((m) => (
              <span key={m.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-primary)' }}>
                <Avatar name={m.displayName} avatar={m.avatar} size={20} />
                {m.displayName}
              </span>
            ))
          )}
        </div>

        {openHelp.map((hr) => (
          <div
            key={hr.id}
            role="alert"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 'var(--space-sm)',
              padding: 'var(--space-sm) var(--space-md)',
              border: '1px solid var(--signal-alert)',
              borderRadius: 'var(--radius-control)',
            }}
          >
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 15, color: 'var(--text-primary)' }}>
                <LifeBuoyIcon style={{ color: 'var(--signal-alert)' }} />
                {hr.requestedByName} asked for help
                <span className="tabular" style={{ fontSize: 13, color: 'var(--text-telemetry)' }}>
                  · {formatAgo(hr.createdAt)}
                </span>
              </span>
              {hr.message && <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>“{hr.message}”</span>}
            </span>
            <Button variant="ghost" onClick={() => resolveHelp.mutate(hr.id)} disabled={resolveHelp.isPending}>
              Resolve
            </Button>
          </div>
        ))}

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <select
            key={active?.cyberRangeId ?? 'none'}
            defaultValue=""
            disabled={startScenario.isPending || !team}
            aria-label="Assign scenario"
            onChange={(e) => {
              const cyberRangeId = Number(e.target.value);
              e.target.value = '';
              if (cyberRangeId) handleAssign(cyberRangeId);
            }}
            style={selectStyle}
          >
            <option value="" disabled>
              {active ? 'Switch scenario…' : 'Assign scenario…'}
            </option>
            {catalogData?.cyberRanges
              .filter((range) => range.id !== active?.cyberRangeId)
              .map((range) => (
                <option key={range.id} value={range.id}>
                  {range.dayLabel} — {range.name} ({range.difficulty})
                </option>
              ))}
          </select>
          {active && (
            <>
              <Button variant="ghost" onClick={handleComplete} disabled={completeScenario.isPending}>
                Mark scenario completed
              </Button>
              <Button variant="ghost" onClick={handleRestart} disabled={startScenario.isPending} style={{ color: 'var(--text-muted)' }}>
                Restart clock
              </Button>
            </>
          )}
          {team && team.openHelpCount > 0 && openHelp.length === 0 && <TelemetryBadge tone="alert">help requested</TelemetryBadge>}
        </div>
      </div>

      <div role="tablist" aria-label="Team views" style={{ display: 'flex', gap: 'var(--space-lg)', borderBottom: '1px solid var(--surface-border)', marginBottom: 'var(--space-lg)' }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: tab === t.key ? '2px solid var(--signal-primary)' : '2px solid transparent',
              color: tab === t.key ? 'var(--text-primary)' : 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              padding: '6px 0',
              marginBottom: -1,
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {teamId && (
        <LockedTeamContext.Provider value={teamId}>
          {/* key: remount per team so no page keeps the previous team's local state (filters, drafts). */}
          <div key={teamId} role="tabpanel" className="team-workspace-embed">
            {tab === 'investigation' && <InvestigationPage />}
            {tab === 'scoring' && <InstructorScoringPanel />}
            {tab === 'debrief' &&
              (debriefRange === 'event' ? (
                <EventSummaryPage />
              ) : debriefRange && Number(debriefRange) ? (
                <CyberRangeSummaryPage cyberRangeIdOverride={Number(debriefRange)} />
              ) : (
                <HistoryPage />
              ))}
          </div>
        </LockedTeamContext.Provider>
      )}
    </div>
  );
}
