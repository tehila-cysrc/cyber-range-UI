import { Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { TelemetryBadge } from '../../components/TelemetryBadge';
import { useAuthStore } from '../../stores/authStore';
import {
  mttdLabel,
  mttdSummaryLabel,
  techniqueDisplayName,
  useMitreCatalog,
  type MttdSummary,
  type TeamTtpReport,
} from '../../lib/mitre';

type StudentSummary =
  | { scored: false; revealed: false }
  | { scored: true; revealed: true; report: TeamTtpReport }
  | { scored: true; revealed: false; earnedPoints: number; credited: { techniqueId: string; pointsAwarded: number }[] };

const monoLabel: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

// The final ATT&CK report — the only cross-team technique matrix in the app (instructor), or the
// team's own breakdown (student, only once the instructor has completed the scenario; before that it
// would give away which techniques are still worth hunting for).
export function TtpDebriefSection({ cyberRangeId }: { cyberRangeId: number }) {
  const isInstructor = useAuthStore((s) => s.user?.role) === 'instructor';

  const { data: rangeReport } = useQuery({
    queryKey: ['ttp-range-report', cyberRangeId],
    queryFn: () => apiFetch<{ teams: TeamTtpReport[]; mttd: MttdSummary }>(`/admin/cyber-ranges/${cyberRangeId}/ttp-report`),
    enabled: isInstructor,
  });
  const { data: studentSummary } = useQuery({
    queryKey: ['ttp-summary', cyberRangeId],
    queryFn: () => apiFetch<StudentSummary>(`/teams/me/cyber-ranges/${cyberRangeId}/ttp-summary`),
    enabled: !isInstructor,
  });

  if (isInstructor) {
    if (!rangeReport || rangeReport.teams.length === 0 || rangeReport.teams[0].totals.expectedCount === 0) return null;
    return (
      <Section>
        <TtpMatrix teams={rangeReport.teams} />
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Scenario {mttdSummaryLabel(rangeReport.mttd)}</div>
      </Section>
    );
  }

  if (!studentSummary || !studentSummary.scored) return null;
  if (!studentSummary.revealed) {
    return (
      <Section>
        <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
          ATT&amp;CK points so far: <span className="tabular" style={{ color: 'var(--signal-primary)' }}>{studentSummary.earnedPoints}</span>. The full
          technique breakdown (including anything missed) is revealed when your instructor completes this scenario.
        </div>
      </Section>
    );
  }
  return (
    <Section>
      <TtpMatrix teams={[studentSummary.report]} />
      {studentSummary.report.incorrect.length > 0 && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Incorrect associations: {studentSummary.report.incorrect.map((i) => `${i.techniqueId} → 0`).join(', ')}
        </div>
      )}
    </Section>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 'var(--space-xl)', display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
        <span style={{ ...monoLabel, color: 'var(--signal-secondary)' }}>MITRE ATT&amp;CK</span>
        <span style={{ flex: 1, height: 1, background: 'var(--surface-border)' }} />
      </div>
      {children}
    </div>
  );
}

// Tactic → technique rows, one ✓/✗ column per team, with per-team score, coverage and MTTD.
function TtpMatrix({ teams }: { teams: TeamTtpReport[] }) {
  const { data: catalog } = useMitreCatalog();
  const rows = teams[0].expected;
  const tacticOrder = new Map(catalog?.tactics.map((t) => [t.id, t.order]) ?? []);
  const byTactic = new Map<string, typeof rows>();
  for (const r of rows) byTactic.set(r.tacticId, [...(byTactic.get(r.tacticId) ?? []), r]);
  const tactics = [...byTactic.entries()].sort(([a], [b]) => (tacticOrder.get(a) ?? 99) - (tacticOrder.get(b) ?? 99));

  const cell: React.CSSProperties = { padding: '6px 10px', borderBottom: '1px solid rgba(51, 65, 85, 0.3)', textAlign: 'left', verticalAlign: 'top' };

  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-container)', background: 'var(--surface-1)' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 14 }}>
        <thead>
          <tr>
            <th style={{ ...cell, ...monoLabel, color: 'var(--text-telemetry)' }}>Technique</th>
            <th style={{ ...cell, ...monoLabel, color: 'var(--text-telemetry)', textAlign: 'right' }}>Pts</th>
            {teams.map((t) => (
              <th key={t.teamId} style={{ ...cell, ...monoLabel, color: 'var(--text-telemetry)' }}>
                {t.teamName}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tactics.map(([tacticId, tacticRows]) => (
            <Fragment key={tacticId}>
              <tr>
                <td colSpan={2 + teams.length} style={{ ...cell, ...monoLabel, fontSize: 11, color: 'var(--signal-secondary)', paddingTop: 10 }}>
                  {tacticRows[0].tacticName}
                </td>
              </tr>
              {tacticRows.map((r) => (
                <tr key={r.expectedTtpId}>
                  <td style={cell}>
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--signal-secondary)', marginRight: 8 }}>{r.techniqueId}</span>
                    <span style={{ color: 'var(--text-primary)' }}>{techniqueDisplayName(catalog, r.techniqueId)}</span>
                  </td>
                  <td className="tabular" style={{ ...cell, textAlign: 'right', color: 'var(--text-muted)' }}>
                    {r.points}
                  </td>
                  {teams.map((t) => {
                    const d = t.expected.find((e) => e.expectedTtpId === r.expectedTtpId)?.detection;
                    return (
                      <td key={t.teamId} style={cell}>
                        {d ? (
                          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span style={{ color: 'var(--signal-primary)' }}>
                              ✓ +{d.pointsAwarded}
                              {d.source === 'instructor' ? ' (instructor)' : ''}
                            </span>
                            <span className="tabular" style={{ fontSize: 12, color: 'var(--text-telemetry)' }}>
                              MTTD {mttdLabel(d.mttd)}
                            </span>
                          </span>
                        ) : (
                          <span style={{ color: 'var(--signal-alert)' }}>✗</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </Fragment>
          ))}
          <tr>
            <td colSpan={2} style={{ ...cell, ...monoLabel, color: 'var(--text-telemetry)', borderBottom: 'none' }}>
              Totals
            </td>
            {teams.map((t) => (
              <td key={t.teamId} style={{ ...cell, borderBottom: 'none' }}>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                  <TelemetryBadge tone="primary">
                    {t.totals.earnedPoints}/{t.totals.availablePoints} pts
                  </TelemetryBadge>
                  <span className="tabular" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {t.totals.detectedCount}/{t.totals.expectedCount} detected · {t.totals.incorrectCount} incorrect
                  </span>
                  <span className="tabular" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{mttdSummaryLabel(t.mttd)}</span>
                </span>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
