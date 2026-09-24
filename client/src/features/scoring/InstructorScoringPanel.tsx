import { useState } from 'react';
import { useInstructorTeam } from '../../hooks/useInstructorTeam';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { Button } from '../../components/Button';
import { TelemetryBadge } from '../../components/TelemetryBadge';
import { Avatar } from '../../components/Avatar';
import { FlagIcon } from '../../components/icons';
import { useSocketEvent } from '../../hooks/useSocketEvent';
import { TtpChip } from '../../components/TechniquePicker';
import { useMitreCatalog, type EntryTtp } from '../../lib/mitre';
import { TtpDetectionsPanel } from './TtpDetectionsPanel';

interface TeamStatus {
  teamId: number;
  teamName: string;
  active: { cyberRangeId: number; name: string; difficulty: string; dayLabel: string } | null;
}

interface TeamRosterMember {
  id: number;
  displayName: string;
}

interface TeamRoster {
  id: number;
  members: TeamRosterMember[];
}

interface AwardedScore {
  id: number;
  points: number;
  documentationEntryId: number | null;
  studentName: string | null;
  note: string | null;
  createdAt: string;
}

interface DocEntry {
  id: number;
  body: string;
  authorUserId: number;
  authorName: string;
  isImportantFinding: number;
  afterTimeLimit?: number;
  createdAt: string;
  ttps?: EntryTtp[];
}

const selectStyle: React.CSSProperties = {
  background: 'var(--surface-1)',
  border: '1px solid var(--surface-border)',
  borderRadius: 'var(--radius-control)',
  padding: '8px 10px',
  color: 'var(--text-primary)',
  fontSize: 15,
};

// The award form stays collapsed per entry — a full form under every entry made a long, noisy page.
function EntryAward(props: { teamId: number; studentUserId?: number; documentationEntryId: number; cyberRangeId: number; onDone: () => void; alreadyAwarded: boolean }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button variant="ghost" onClick={() => setOpen(true)} style={{ alignSelf: 'flex-start', padding: '4px 12px', fontSize: 14 }}>
        {props.alreadyAwarded ? 'Award more points' : 'Award points'}
      </Button>
    );
  }
  return (
    <ScoreForm
      teamId={props.teamId}
      studentUserId={props.studentUserId}
      documentationEntryId={props.documentationEntryId}
      cyberRangeId={props.cyberRangeId}
      onDone={() => {
        setOpen(false);
        props.onDone();
      }}
    />
  );
}

function ScoreForm({
  teamId,
  studentUserId,
  documentationEntryId,
  cyberRangeId,
  onDone,
}: {
  teamId: number;
  studentUserId?: number;
  documentationEntryId?: number;
  cyberRangeId?: number;
  onDone: () => void;
}) {
  const [points, setPoints] = useState('1');
  const [note, setNote] = useState('');
  const [isGamified, setIsGamified] = useState(false);
  const [justAwarded, setJustAwarded] = useState(false);
  const parsedPoints = Number(points);
  const pointsValid = points.trim() !== '' && Number.isInteger(parsedPoints) && parsedPoints !== 0 && Math.abs(parsedPoints) <= 1000;

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch('/admin/scores', {
        method: 'POST',
        body: JSON.stringify({
          teamId,
          studentUserId,
          documentationEntryId,
          cyberRangeId,
          points: parsedPoints,
          isGamified,
          // Shown to the students on their Progress page — scoring is only useful feedback if they
          // can see what earned (or cost) the points.
          note: note.trim() || undefined,
        }),
      }),
    onError: () => undefined, // shown inline below
    onSuccess: () => {
      onDone();
      setNote('');
      // The score:awarded socket event already updates the leaderboard/student's own Progress page
      // live — this is just confirmation for the instructor that the click actually sent.
      setJustAwarded(true);
      setTimeout(() => setJustAwarded(false), 2500);
    },
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)', alignItems: 'center' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)' }}>
          Points
          <input
            type="number"
            step={1}
            min={-1000}
            max={1000}
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            aria-invalid={!pointsValid}
            style={{
              width: 72,
              background: 'transparent',
              border: '1px solid var(--surface-border)',
              borderRadius: 'var(--radius-control)',
              padding: '6px 8px',
              color: 'var(--text-primary)',
              fontSize: 15,
            }}
          />
        </label>
        <label
          title="Plays confetti and a chime on the students' screens when the points arrive"
          style={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', gap: 6, alignItems: 'center' }}
        >
          <input type="checkbox" checked={isGamified} onChange={(e) => setIsGamified(e.target.checked)} />
          Celebrate
        </label>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder="Reason (visible to students)"
          aria-label="Reason for the award"
          style={{
            flex: '1 1 180px',
            minWidth: 0,
            background: 'var(--surface-1)',
            border: '1px solid var(--surface-border)',
            borderRadius: 'var(--radius-control)',
            padding: '6px 8px',
            color: 'var(--text-primary)',
            fontSize: 14,
          }}
        />
        <Button variant="ghost" onClick={() => mutation.mutate()} disabled={mutation.isPending || !pointsValid}>
          {mutation.isPending ? 'Sending…' : 'Award'}
        </Button>
      </div>
      {justAwarded && (
        <span style={{ fontSize: 13, color: 'var(--signal-primary)' }}>Awarded — updated for everyone ✓</span>
      )}
      {!pointsValid && (
        <span style={{ fontSize: 13, color: 'var(--signal-alert)' }}>Points must be a whole number between -1000 and 1000 (not 0).</span>
      )}
      {mutation.isError && (
        <span role="alert" style={{ fontSize: 13, color: 'var(--signal-alert)' }}>
          {mutation.error instanceof ApiError ? mutation.error.message : 'Failed to send'}
        </span>
      )}
    </div>
  );
}

export function InstructorScoringPanel() {
  const queryClient = useQueryClient();
  const [selectedTeamId, setSelectedTeamId] = useInstructorTeam();
  const [quickAwardStudentId, setQuickAwardStudentId] = useState<number | ''>('');
  const [docFilter, setDocFilter] = useState<'all' | 'unscored' | 'findings'>('all');
  const { data: catalog } = useMitreCatalog();

  const { data: dashboardData } = useQuery({
    queryKey: ['instructor-dashboard'],
    queryFn: () => apiFetch<{ teams: TeamStatus[] }>('/admin/dashboard'),
  });

  const { data: rosterData } = useQuery({
    queryKey: ['admin-teams-list'],
    queryFn: () => apiFetch<{ teams: TeamRoster[] }>('/admin/teams'),
  });

  const selectedTeam = dashboardData?.teams.find((t) => t.teamId === selectedTeamId);
  const selectedTeamMembers = rosterData?.teams.find((t) => t.id === selectedTeamId)?.members ?? [];

  const { data: entriesData } = useQuery({
    enabled: !!selectedTeam?.active,
    queryKey: ['documentation', selectedTeam?.active?.cyberRangeId, selectedTeamId],
    queryFn: () =>
      apiFetch<{ entries: DocEntry[] }>(
        `/cyber-ranges/${selectedTeam!.active!.cyberRangeId}/documentation?teamId=${selectedTeamId}`,
      ),
  });

  // What this team has already been awarded, per entry — without it an instructor hopping between
  // teams mid-event had no way to tell an entry was already scored, and double-awarded.
  const { data: awardedData } = useQuery({
    enabled: !!selectedTeamId,
    queryKey: ['admin-scores', selectedTeamId],
    queryFn: () => apiFetch<{ entries: AwardedScore[]; teamTotal: number }>(`/admin/scores?teamId=${selectedTeamId}`),
  });
  const awardedByEntry = new Map<number, AwardedScore[]>();
  for (const s of awardedData?.entries ?? []) {
    if (s.documentationEntryId == null) continue;
    awardedByEntry.set(s.documentationEntryId, [...(awardedByEntry.get(s.documentationEntryId) ?? []), s]);
  }

  useSocketEvent<{ entry: DocEntry; teamId: number }>('documentation:new', ({ teamId }) => {
    if (teamId === selectedTeamId) queryClient.invalidateQueries({ queryKey: ['documentation'] });
  });
  useSocketEvent<{ entry: DocEntry; teamId: number }>('documentation:updated', ({ teamId }) => {
    if (teamId === selectedTeamId) queryClient.invalidateQueries({ queryKey: ['documentation'] });
  });
  // An automatic ATT&CK credit is a new scores row this panel didn't create.
  useSocketEvent<{ teamId: number }>('ttp:changed', ({ teamId }) => {
    if (teamId === selectedTeamId) {
      queryClient.invalidateQueries({ queryKey: ['admin-scores'] });
      queryClient.invalidateQueries({ queryKey: ['documentation'] });
    }
  });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['documentation'] });
    queryClient.invalidateQueries({ queryKey: ['admin-scores'] });
    queryClient.invalidateQueries({ queryKey: ['instructor-dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['ttp-report'] });
  }

  return (
    <div className="page" style={{ padding: 'var(--space-xl)' }}>
      <h1 style={{ fontSize: 22, color: 'var(--text-primary)', margin: '0 0 4px' }}>Progress — Scoring</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 15, margin: '0 0 var(--space-lg)' }}>
        Award points to a team or an individual student — it updates live on their Progress page and
        the leaderboard.
      </p>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 'var(--space-xl)', maxWidth: 280 }}>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Team</span>
        <select
          value={selectedTeamId}
          onChange={(e) => {
            setSelectedTeamId(e.target.value ? Number(e.target.value) : '');
            setQuickAwardStudentId('');
          }}
          style={selectStyle}
        >
          <option value="">Select a team…</option>
          {dashboardData?.teams.map((t) => (
            <option key={t.teamId} value={t.teamId}>
              {t.teamName}
            </option>
          ))}
        </select>
      </label>

      {!selectedTeamId && (
        <div style={{ color: 'var(--text-muted)', fontSize: 15 }}>Pick a team above to start scoring.</div>
      )}

      {selectedTeam && !selectedTeam.active && (
        <div
          style={{
            padding: 'var(--space-lg)',
            border: '1px solid var(--surface-border)',
            borderRadius: 'var(--radius-container)',
            background: 'var(--surface-1)',
            color: 'var(--text-muted)',
            fontSize: 15,
          }}
        >
          No active Cyber Range for this team.
        </div>
      )}

      {selectedTeam?.active && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)', alignItems: 'center' }}>
            {awardedData && (
              <TelemetryBadge tone="primary">Team total {awardedData.teamTotal} pts</TelemetryBadge>
            )}
            <TelemetryBadge tone="secondary">{selectedTeam.active.dayLabel}</TelemetryBadge>
            <TelemetryBadge tone={selectedTeam.active.difficulty === 'advanced' ? 'alert' : 'tertiary'}>
              {selectedTeam.active.difficulty}
            </TelemetryBadge>
            <span style={{ fontSize: 15, color: 'var(--text-primary)' }}>{selectedTeam.active.name}</span>
          </div>


          <div className="split-main-side">
          <div>
            <h2 style={{ fontSize: 15, color: 'var(--text-muted)', margin: '0 0 var(--space-sm)' }}>
              Documentation — {selectedTeam.active.name}
            </h2>
            {entriesData?.entries.length === 0 && (
              <div style={{ color: 'var(--text-muted)', fontSize: 15 }}>No documentation was recorded yet.</div>
            )}
            {!!entriesData?.entries.length && (
              <div role="group" aria-label="Filter entries" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 'var(--space-md)' }}>
                {(
                  [
                    ['all', 'All', entriesData.entries.length],
                    ['unscored', 'Not scored yet', entriesData.entries.filter((e) => !awardedByEntry.has(e.id)).length],
                    ['findings', 'Findings', entriesData.entries.filter((e) => e.isImportantFinding).length],
                  ] as const
                ).map(([key, label, count]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={docFilter === key}
                    onClick={() => setDocFilter(key)}
                    style={{
                      fontFamily: 'inherit',
                      fontSize: 13,
                      padding: '3px 10px',
                      borderRadius: 999,
                      cursor: 'pointer',
                      border: `1px solid ${docFilter === key ? 'var(--signal-secondary)' : 'var(--surface-border)'}`,
                      background: docFilter === key ? 'rgba(15, 23, 42, 0.8)' : 'transparent',
                      color: docFilter === key ? 'var(--text-primary)' : 'var(--text-muted)',
                    }}
                  >
                    {label} ({count})
                  </button>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
              {(entriesData?.entries ?? [])
                .filter((e) => (docFilter === 'unscored' ? !awardedByEntry.has(e.id) : docFilter === 'findings' ? !!e.isImportantFinding : true))
                .map((entry) => (
                <div
                  key={entry.id}
                  style={{
                    padding: 'var(--space-md)',
                    border: '1px solid var(--surface-border)',
                    borderRadius: 'var(--radius-container)',
                    background: 'var(--surface-1)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-sm)',
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      color: 'var(--text-telemetry)',
                      fontFamily: 'var(--font-mono)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <Avatar name={entry.authorName} size={20} />
                    {entry.authorName} ·{' '}
                    {new Date(entry.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    {entry.afterTimeLimit ? (
            <span title="Added after the scenario's time limit ran out">
              <TelemetryBadge tone="tertiary">After time</TelemetryBadge>
            </span>
          ) : null}
          {entry.isImportantFinding ? (
                      <TelemetryBadge tone="primary">
                        <FlagIcon style={{ marginRight: 3, verticalAlign: '-2px' }} />
                        Finding
                      </TelemetryBadge>
                    ) : null}
                  </div>
                  <div className="prose-pre" style={{ fontSize: 15, color: 'var(--text-primary)' }}>{entry.body}</div>
                  {!!entry.ttps?.length && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {entry.ttps.map((t) => (
                        <TtpChip key={t.techniqueId} techniqueId={t.techniqueId} catalog={catalog} credited={t.credited} />
                      ))}
                    </div>
                  )}
                  {awardedByEntry.has(entry.id) && (
                    <div style={{ fontSize: 13, color: 'var(--signal-primary)' }}>
                      Already awarded:{' '}
                      {awardedByEntry
                        .get(entry.id)!
                        .map((s) => `${s.points > 0 ? '+' : ''}${s.points}${s.note ? ` (${s.note})` : ''}`)
                        .join(', ')}
                    </div>
                  )}
                  <div style={{ borderTop: '1px solid rgba(51, 65, 85, 0.3)', paddingTop: 'var(--space-sm)', display: 'flex', flexDirection: 'column' }}>
                    <EntryAward
                      teamId={selectedTeam.teamId}
                      studentUserId={entry.authorUserId}
                      documentationEntryId={entry.id}
                      cyberRangeId={selectedTeam.active!.cyberRangeId}
                      onDone={refresh}
                      alreadyAwarded={awardedByEntry.has(entry.id)}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
            <div style={{ position: 'sticky', top: 76, display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)', maxHeight: 'calc(100vh - 92px)', overflowY: 'auto' }}>
          <div
            style={{
              padding: 'var(--space-lg)',
              border: '1px solid var(--surface-border)',
              borderRadius: 'var(--radius-container)',
              background: 'var(--surface-1)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-md)',
            }}
          >
            <div>
              <h2 style={{ fontSize: 15, color: 'var(--text-muted)', margin: '0 0 4px' }}>Quick award</h2>
              <p style={{ fontSize: 13, color: 'var(--text-telemetry)', margin: 0 }}>
                No documentation entry needed — pick a student, or leave it as a whole-team award.
              </p>
            </div>
            <select
              value={quickAwardStudentId}
              onChange={(e) => setQuickAwardStudentId(e.target.value ? Number(e.target.value) : '')}
              style={{ ...selectStyle, maxWidth: 220 }}
            >
              <option value="">Whole team</option>
              {selectedTeamMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))}
            </select>
            <ScoreForm
              key={quickAwardStudentId}
              teamId={selectedTeam.teamId}
              studentUserId={quickAwardStudentId || undefined}
              cyberRangeId={selectedTeam.active.cyberRangeId}
              onDone={refresh}
            />
          </div>

          <TtpDetectionsPanel
            teamId={selectedTeam.teamId}
            cyberRangeId={selectedTeam.active.cyberRangeId}
            entries={entriesData?.entries ?? []}
            onChanged={refresh}
          />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
