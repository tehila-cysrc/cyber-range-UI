import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { Button } from '../../components/Button';
import { TelemetryBadge } from '../../components/TelemetryBadge';
import { Avatar } from '../../components/Avatar';
import { FlagIcon } from '../../components/icons';

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

interface DocEntry {
  id: number;
  body: string;
  authorUserId: number;
  authorName: string;
  isImportantFinding: number;
  createdAt: string;
}

const selectStyle: React.CSSProperties = {
  background: 'var(--surface-1)',
  border: '1px solid var(--surface-border)',
  borderRadius: 'var(--radius-control)',
  padding: '8px 10px',
  color: 'var(--text-primary)',
  fontSize: 15,
};

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
  const [points, setPoints] = useState(1);
  const [isGamified, setIsGamified] = useState(false);
  const [justAwarded, setJustAwarded] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch('/admin/scores', {
        method: 'POST',
        body: JSON.stringify({ teamId, studentUserId, documentationEntryId, cyberRangeId, points, isGamified }),
      }),
    onSuccess: () => {
      onDone();
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
            value={points}
            onChange={(e) => setPoints(Number(e.target.value))}
            style={{
              width: 64,
              background: 'transparent',
              border: '1px solid var(--surface-border)',
              borderRadius: 'var(--radius-control)',
              padding: '6px 8px',
              color: 'var(--text-primary)',
              fontSize: 15,
            }}
          />
        </label>
        <label style={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={isGamified} onChange={(e) => setIsGamified(e.target.checked)} />
          Gamified
        </label>
        <Button variant="ghost" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending ? 'Sending…' : 'Award'}
        </Button>
      </div>
      {justAwarded && (
        <span style={{ fontSize: 13, color: 'var(--signal-primary)' }}>Awarded — updated for everyone ✓</span>
      )}
      {mutation.isError && <span style={{ fontSize: 13, color: 'var(--signal-alert)' }}>Failed to send</span>}
    </div>
  );
}

export function InstructorScoringPanel() {
  const queryClient = useQueryClient();
  const [selectedTeamId, setSelectedTeamId] = useState<number | ''>('');
  const [quickAwardStudentId, setQuickAwardStudentId] = useState<number | ''>('');

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

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['documentation'] });
  }

  return (
    <div style={{ padding: 'var(--space-xl)', maxWidth: 760 }}>
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
          <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}>
            <TelemetryBadge tone="secondary">{selectedTeam.active.dayLabel}</TelemetryBadge>
            <TelemetryBadge tone={selectedTeam.active.difficulty === 'advanced' ? 'alert' : 'tertiary'}>
              {selectedTeam.active.difficulty}
            </TelemetryBadge>
            <span style={{ fontSize: 15, color: 'var(--text-primary)' }}>{selectedTeam.active.name}</span>
          </div>

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

          <div>
            <h2 style={{ fontSize: 15, color: 'var(--text-muted)', margin: '0 0 var(--space-sm)' }}>
              Documentation — {selectedTeam.active.name}
            </h2>
            {entriesData?.entries.length === 0 && (
              <div style={{ color: 'var(--text-muted)', fontSize: 15 }}>No documentation was recorded yet.</div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
              {entriesData?.entries.map((entry) => (
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
                    {entry.authorName} · {new Date(entry.createdAt).toLocaleTimeString()}
                    {entry.isImportantFinding ? (
                      <TelemetryBadge tone="primary">
                        <FlagIcon style={{ marginRight: 3, verticalAlign: '-2px' }} />
                        Finding
                      </TelemetryBadge>
                    ) : null}
                  </div>
                  <div style={{ fontSize: 15, color: 'var(--text-primary)' }}>{entry.body}</div>
                  <div style={{ borderTop: '1px solid rgba(51, 65, 85, 0.3)', paddingTop: 'var(--space-sm)' }}>
                    <ScoreForm
                      teamId={selectedTeam.teamId}
                      studentUserId={entry.authorUserId}
                      documentationEntryId={entry.id}
                      cyberRangeId={selectedTeam.active!.cyberRangeId}
                      onDone={refresh}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
