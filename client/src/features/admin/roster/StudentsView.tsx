import { Avatar } from '../../../components/Avatar';
import type { Selection, Team } from './rosterData';

// Every student of the run in one list, sorted by name. Each row says which team and organization
// they're in; clicking it opens that organization with the team expanded (where moving/deleting lives).
export function StudentsView({ teams, onSelect }: { teams: Team[]; onSelect: (s: Selection, teamId?: number) => void }) {
  const students = teams
    .flatMap((t) => t.members.map((m) => ({ m, t })))
    .sort((a, b) => a.m.displayName.localeCompare(b.m.displayName));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', minWidth: 0 }}>
      <div>
        <h1 style={{ fontSize: 22, color: 'var(--text-primary)', margin: 0 }}>Students</h1>
        <div className="tabular" style={{ fontSize: 13, color: 'var(--text-telemetry)', marginTop: 4 }}>
          {students.length} account{students.length === 1 ? '' : 's'} across {teams.length} team{teams.length === 1 ? '' : 's'}
        </div>
      </div>

      {students.length === 0 ? (
        <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>No students yet — add them from an organization's teams.</div>
      ) : (
        <div style={{ border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-container)', background: 'var(--surface-1)', padding: '6px 12px' }}>
          {students.map(({ m, t }) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onSelect(t.organizationId === null ? { kind: 'none' } : { kind: 'org', id: t.organizationId }, t.id)}
              title={`Open ${t.name}`}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, width: '100%', textAlign: 'start', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--text-muted)', padding: '6px 0' }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <Avatar name={m.displayName} avatar={m.avatar} size={22} />
                <bdi style={{ color: 'var(--text-primary)' }}>{m.displayName}</bdi>
                <span className="tabular" style={{ color: 'var(--text-telemetry)' }}>@{m.username}</span>
              </span>
              <bdi style={{ fontSize: 13, color: 'var(--text-telemetry)', flexShrink: 0 }}>
                {t.name} · {t.organizationName ?? 'No organization'}
              </bdi>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
