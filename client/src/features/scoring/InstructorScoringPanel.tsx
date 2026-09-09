import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { Button } from '../../components/Button';
import { TelemetryBadge } from '../../components/TelemetryBadge';

interface TeamStatus {
  teamId: number;
  teamName: string;
  active: { cyberRangeId: number; name: string } | null;
}

interface DocEntry {
  id: number;
  body: string;
  authorUserId: number;
  authorName: string;
  isImportantFinding: number;
  createdAt: string;
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
  const [points, setPoints] = useState(1);
  const [isGamified, setIsGamified] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch('/admin/scores', {
        method: 'POST',
        body: JSON.stringify({ teamId, studentUserId, documentationEntryId, cyberRangeId, points, isGamified }),
      }),
    onSuccess: onDone,
  });

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input
        type="number"
        value={points}
        onChange={(e) => setPoints(Number(e.target.value))}
        style={{
          width: 56,
          background: 'transparent',
          border: '1px solid var(--surface-border)',
          borderRadius: 'var(--radius-control)',
          padding: '4px 6px',
          color: 'var(--text-primary)',
        }}
      />
      <label style={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', gap: 4, alignItems: 'center' }}>
        <input type="checkbox" checked={isGamified} onChange={(e) => setIsGamified(e.target.checked)} />
        gamified
      </label>
      <Button variant="ghost" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
        Award
      </Button>
    </div>
  );
}

export function InstructorScoringPanel() {
  const queryClient = useQueryClient();
  const [selectedTeamId, setSelectedTeamId] = useState<number | ''>('');

  const { data: dashboardData } = useQuery({
    queryKey: ['instructor-dashboard'],
    queryFn: () => apiFetch<{ teams: TeamStatus[] }>('/admin/dashboard'),
  });

  const selectedTeam = dashboardData?.teams.find((t) => t.teamId === selectedTeamId);

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
    <div style={{ padding: 'var(--space-xl)' }}>
      <h1 style={{ fontSize: 22, color: 'var(--text-primary)', margin: '0 0 var(--space-md)' }}>
        Progress — Scoring
      </h1>

      <select
        value={selectedTeamId}
        onChange={(e) => setSelectedTeamId(e.target.value ? Number(e.target.value) : '')}
        style={{
          background: 'var(--surface-1)',
          border: '1px solid var(--surface-border)',
          borderRadius: 'var(--radius-control)',
          padding: 8,
          color: 'var(--text-primary)',
          marginBottom: 'var(--space-lg)',
        }}
      >
        <option value="">Select a team…</option>
        {dashboardData?.teams.map((t) => (
          <option key={t.teamId} value={t.teamId}>
            {t.teamName}
          </option>
        ))}
      </select>

      {selectedTeam && !selectedTeam.active && (
        <div style={{ color: 'var(--text-muted)', fontSize: 15 }}>No active Cyber Range for this team.</div>
      )}

      {selectedTeam?.active && (
        <>
          <div style={{ marginBottom: 'var(--space-lg)' }}>
            <h2 style={{ fontSize: 15, color: 'var(--text-muted)', margin: '0 0 6px' }}>
              Standalone team award
            </h2>
            <ScoreForm teamId={selectedTeam.teamId} cyberRangeId={selectedTeam.active.cyberRangeId} onDone={refresh} />
          </div>

          <h2 style={{ fontSize: 15, color: 'var(--text-muted)', margin: '0 0 var(--space-sm)' }}>
            Documentation — {selectedTeam.active.name}
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            {entriesData?.entries.map((entry) => (
              <div
                key={entry.id}
                style={{
                  padding: 'var(--space-sm) var(--space-md)',
                  border: '1px solid var(--surface-border)',
                  borderRadius: 'var(--radius-control)',
                  background: 'var(--surface-1)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ fontSize: 13, color: 'var(--text-telemetry)', fontFamily: 'var(--font-mono)' }}>
                  {entry.authorName} · {new Date(entry.createdAt).toLocaleTimeString()}
                  {entry.isImportantFinding ? (
                    <span style={{ marginLeft: 8 }}>
                      <TelemetryBadge tone="primary">Finding</TelemetryBadge>
                    </span>
                  ) : null}
                </div>
                <div style={{ fontSize: 15, color: 'var(--text-primary)' }}>{entry.body}</div>
                <ScoreForm
                  teamId={selectedTeam.teamId}
                  studentUserId={entry.authorUserId}
                  documentationEntryId={entry.id}
                  cyberRangeId={selectedTeam.active!.cyberRangeId}
                  onDone={refresh}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
