import { Link } from 'react-router-dom';
import { ExportResultsButtons } from '../admin/ExportResultsButtons';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { EmptyState } from '../../components/EmptyState';
import { useDebriefTeam } from './useDebriefTeam';
import { useCan } from '../../lib/permissions';
import { useState } from 'react';
import { Button } from '../../components/Button';
import { AiBatchDialog } from '../aiAssessment/AiBatchDialog';
import { useAiStatus } from '../aiAssessment/useAiAssessments';

interface DaySummary {
  dayKey: string;
  dayLabel: string;
  completedCount: number;
  pausedCount: number;
  activeCount: number;
  totalPoints: number;
}

export function EventSummaryPage() {
  const { query, ready, picker, links, teamId } = useDebriefTeam();
  // Admin: global export; instructor: scoped export (only their assigned organizations and scenarios).
  const canGlobalExport = useCan('event.export');
  const canScopedExport = useCan('results.export');
  const canExport = canGlobalExport || canScopedExport;
  // AI final assessments for every team in scope (not only the picked one); hidden when AI is off.
  const { available: aiAvailable } = useAiStatus();
  const [aiOpen, setAiOpen] = useState(false);
  const { data, isError } = useQuery({
    queryKey: ['event-summary', query],
    queryFn: () => apiFetch<{ days: DaySummary[] }>(`/history/event-summary${query}`),
    enabled: ready,
  });

  return (
    <div className="page" style={{ padding: 'var(--space-xl)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-md)', justifyContent: 'space-between', alignItems: 'center' }}>
        <Link to={links.home} style={{ fontSize: 14, color: 'var(--signal-secondary)' }}>
          ← Back to debrief
        </Link>
        {picker}
      </div>

      <h1 style={{ fontSize: 22, color: 'var(--text-primary)', margin: 'var(--space-md) 0' }}>
        Event Summary
      </h1>
      {((canExport && teamId != null) || aiAvailable) && (
        <div style={{ marginBottom: 'var(--space-md)', display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
          {canExport && teamId != null && <ExportResultsButtons teamId={teamId} />}
          {aiAvailable && (
            <Button variant="ghost" onClick={() => setAiOpen(true)} title="Generate and review AI final assessments for all your teams">
              AI Assessment
            </Button>
          )}
        </div>
      )}
      {aiOpen && <AiBatchDialog onClose={() => setAiOpen(false)} />}

      {!ready && <EmptyState message="Pick a team above to see its event summary." />}
      {isError && <EmptyState message="Couldn't load the event summary — try refreshing." />}
      {data && data.days.length === 0 && (
        <EmptyState message="No activity recorded yet across the AI/Azure/AWS days." />
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
        {data?.days.map((day) => (
          <div
            key={day.dayKey}
            style={{
              padding: 'var(--space-lg)',
              border: '1px solid var(--surface-border)',
              borderRadius: 'var(--radius-container)',
              background: 'var(--surface-1)',
              minWidth: 160,
            }}
          >
            <div style={{ fontSize: 13, color: 'var(--text-telemetry)', textTransform: 'uppercase' }}>
              {day.dayLabel}
            </div>
            <div className="tabular" style={{ fontSize: 24, color: 'var(--text-primary)', margin: '4px 0' }}>
              {day.completedCount}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Cyber Ranges completed</div>
            {(day.pausedCount > 0 || day.activeCount > 0) && (
              <div style={{ fontSize: 13, color: 'var(--signal-tertiary)', marginTop: 2 }}>
                {[
                  day.pausedCount > 0 ? `${day.pausedCount} paused` : null,
                  day.activeCount > 0 ? `${day.activeCount} in progress` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            )}
            <div className="tabular" style={{ fontSize: 16, color: 'var(--signal-primary)', marginTop: 6 }}>
              {day.totalPoints} pts
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
