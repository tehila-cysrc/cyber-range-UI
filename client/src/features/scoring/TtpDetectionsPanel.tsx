import { useState } from 'react';
import { promptAction } from '../../components/ConfirmDialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { Button } from '../../components/Button';
import { TelemetryBadge } from '../../components/TelemetryBadge';
import { useSocketEvent } from '../../hooks/useSocketEvent';
import { mttdLabel, mttdSummaryLabel, techniqueDisplayName, useMitreCatalog, type TeamTtpReport, type TtpExpectedResult } from '../../lib/mitre';
import { formatEntryTime } from '../documentation/InvestigationPage';

interface EntryOption {
  id: number;
  body: string;
  authorName: string;
}

const monoLabel: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--text-telemetry)',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--space-sm)',
  alignItems: 'baseline',
  padding: 'var(--space-sm) 0',
  borderBottom: '1px solid rgba(51, 65, 85, 0.3)',
};

// Instructor view of one team's ATT&CK results in its active scenario: expected techniques
// (✓ detected / ✗ missed) with detection time, MTTD and who earned it, plus incorrect associations,
// and the two overrides — void a credit, or credit a missed technique against an entry by hand.
export function TtpDetectionsPanel({
  teamId,
  cyberRangeId,
  entries,
  onChanged,
}: {
  teamId: number;
  cyberRangeId: number;
  entries: EntryOption[];
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: catalog } = useMitreCatalog();
  const reportKey = ['ttp-report', cyberRangeId, teamId];
  const { data } = useQuery({
    queryKey: reportKey,
    queryFn: () => apiFetch<{ report: TeamTtpReport }>(`/admin/cyber-ranges/${cyberRangeId}/ttp-report?teamId=${teamId}`),
  });
  useSocketEvent<{ teamId: number; cyberRangeId: number }>('ttp:changed', (p) => {
    if (p.teamId === teamId && p.cyberRangeId === cyberRangeId) queryClient.invalidateQueries({ queryKey: reportKey });
  });

  const report = data?.report;
  if (!report) return null;
  if (report.totals.expectedCount === 0) {
    return (
      <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
        This scenario has no expected ATT&amp;CK techniques — define them on the Scenarios page to score TTP detection.
      </div>
    );
  }

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: reportKey });
    onChanged();
  };

  return (
    <div
      style={{
        padding: 'var(--space-lg)',
        border: '1px solid var(--surface-border)',
        borderRadius: 'var(--radius-container)',
        background: 'var(--surface-1)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-sm)',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h2 style={{ fontSize: 15, color: 'var(--text-muted)', margin: 0 }}>MITRE ATT&amp;CK detections</h2>
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <TelemetryBadge tone="primary">
            TTP score {report.totals.earnedPoints} / {report.totals.availablePoints}
          </TelemetryBadge>
          <TelemetryBadge tone="secondary">
            {report.totals.detectedCount}/{report.totals.expectedCount} detected
          </TelemetryBadge>
          <TelemetryBadge tone={report.mttd.meanSeconds == null ? 'muted' : 'tertiary'}>{mttdSummaryLabel(report.mttd)}</TelemetryBadge>
        </span>
      </div>

      <div>
        {report.expected.map((e) => (
          <ExpectedResultRow key={e.expectedTtpId} result={e} teamId={teamId} entries={entries} onChanged={refresh} />
        ))}
      </div>

      <div style={{ ...monoLabel, marginTop: 'var(--space-sm)' }}>
        Incorrect associations ({report.totals.incorrectCount})
        {report.totals.precision != null && ` · precision ${Math.round(report.totals.precision * 100)}%`}
      </div>
      {report.incorrect.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-telemetry)' }}>None.</div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {report.incorrect.map((i) => (
            <span
              key={i.techniqueId}
              title={`First tagged ${formatEntryTime(i.firstTaggedAt)}${i.stillTagged ? '' : ' · since removed'}`}
              style={{
                fontSize: 13,
                border: '1px solid var(--surface-border)',
                borderRadius: 'var(--radius-control)',
                padding: '2px 6px',
                color: 'var(--text-muted)',
                textDecoration: i.stillTagged ? undefined : 'line-through',
              }}
            >
              <span style={{ fontFamily: 'var(--font-mono)' }}>{i.techniqueId}</span> {techniqueDisplayName(catalog, i.techniqueId)} → 0
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ExpectedResultRow({
  result,
  teamId,
  entries,
  onChanged,
}: {
  result: TtpExpectedResult;
  teamId: number;
  entries: EntryOption[];
  onChanged: () => void;
}) {
  const { data: catalog } = useMitreCatalog();
  const [crediting, setCrediting] = useState(false);
  const [entryId, setEntryId] = useState<number | ''>('');

  const voidCredit = useMutation({
    mutationFn: (reason: string) =>
      apiFetch(`/admin/ttp-detections/${result.detection!.id}/void`, { method: 'POST', body: JSON.stringify({ reason }) }),
    onSuccess: onChanged,
  });
  const credit = useMutation({
    mutationFn: () =>
      apiFetch('/admin/ttp-detections', {
        method: 'POST',
        body: JSON.stringify({ teamId, expectedTtpId: result.expectedTtpId, documentationEntryId: entryId }),
      }),
    onError: () => undefined, // shown inline
    onSuccess: () => {
      setCrediting(false);
      setEntryId('');
      onChanged();
    },
  });

  const d = result.detection;
  return (
    <div style={rowStyle}>
      <span
        aria-label={d ? 'detected' : 'missed'}
        style={{ fontFamily: 'var(--font-mono)', color: d ? 'var(--signal-primary)' : 'var(--signal-alert)', width: 16 }}
      >
        {d ? '✓' : '✗'}
      </span>
      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--signal-secondary)' }}>{result.techniqueId}</span>
      <span style={{ color: 'var(--text-primary)', flex: '1 1 12rem', minWidth: 0 }}>
        {techniqueDisplayName(catalog, result.techniqueId)}
        <span style={{ ...monoLabel, fontSize: 11, marginLeft: 8 }}>{result.tacticName}</span>
      </span>
      <span className="tabular" style={{ color: d ? 'var(--signal-primary)' : 'var(--text-telemetry)', fontSize: 14 }}>
        {d ? `+${d.pointsAwarded}` : `+0 / ${result.points}`}
      </span>
      {d ? (
        <>
          <div style={{ flexBasis: '100%', paddingLeft: 24, fontSize: 13, color: 'var(--text-muted)', display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)', alignItems: 'center' }}>
            <span>
              {d.source === 'instructor' ? 'Credited by instructor' : `Tagged ${d.taggedTechniqueId ?? ''} by ${d.creditedUserName ?? 'a student'}`} ·{' '}
              {formatEntryTime(d.detectedAt)}
            </span>
            <TelemetryBadge tone={d.mttd.measurable ? 'tertiary' : 'muted'}>MTTD {mttdLabel(d.mttd)}</TelemetryBadge>
            <Button
              type="button"
              variant="ghost"
              style={{ fontSize: 12, padding: '2px 8px', marginLeft: 'auto' }}
              disabled={voidCredit.isPending}
              onClick={async () => {
                const reason = await promptAction({
                  title: `Void the ${result.techniqueId} credit (+${d.pointsAwarded})?`,
                  message: 'The points are removed from the team. The technique stays blocked for this team even if it is tagged again.',
                  input: { label: 'Reason (optional)', placeholder: 'e.g. tagged without supporting evidence' },
                  confirmLabel: 'Void credit',
                  danger: true,
                });
                if (reason !== null) voidCredit.mutate(reason);
              }}
            >
              Void
            </Button>
          </div>
          {d.entryExcerpt && (
            <div className="prose-pre" style={{ flexBasis: '100%', paddingLeft: 24, fontSize: 13, color: 'var(--text-telemetry)' }}>
              “{d.entryExcerpt}”
            </div>
          )}
        </>
      ) : (
        <div style={{ flexBasis: '100%', paddingLeft: 24, fontSize: 13, display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)', alignItems: 'center' }}>
          {result.voided && <span style={{ color: 'var(--signal-tertiary)' }}>Credit voided — auto-credit is off for this technique.</span>}
          {crediting ? (
            <>
              <select
                aria-label="Entry that identified this technique"
                value={entryId}
                onChange={(e) => setEntryId(e.target.value ? Number(e.target.value) : '')}
                style={{
                  flex: '1 1 16rem',
                  minWidth: 0,
                  background: 'var(--surface-1)',
                  border: '1px solid var(--surface-border)',
                  borderRadius: 'var(--radius-control)',
                  padding: 6,
                  color: 'var(--text-primary)',
                  fontSize: 13,
                }}
              >
                <option value="">Which entry identified it?</option>
                {entries.map((en) => (
                  <option key={en.id} value={en.id}>
                    {en.authorName}: {en.body.slice(0, 80)}
                  </option>
                ))}
              </select>
              <Button type="button" style={{ fontSize: 12, padding: '4px 10px' }} disabled={!entryId || credit.isPending} onClick={() => credit.mutate()}>
                Credit +{result.points}
              </Button>
              <Button type="button" variant="ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => setCrediting(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setCrediting(true)}
              disabled={entries.length === 0}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--signal-secondary)', fontSize: 13 }}
            >
              Credit manually…
            </button>
          )}
          {credit.isError && (
            <span role="alert" style={{ color: 'var(--signal-alert)' }}>
              {credit.error instanceof ApiError ? credit.error.message : 'Could not credit.'}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
