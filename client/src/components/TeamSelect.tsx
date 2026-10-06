export interface TeamOption {
  id: number;
  name: string;
  organizationName?: string | null;
}

interface TeamSelectProps {
  teams: TeamOption[] | undefined;
  value: number | '' | null;
  onChange: (teamId: number | '') => void;
  style?: React.CSSProperties;
}

const defaultStyle: React.CSSProperties = {
  background: 'var(--surface-1)',
  border: '1px solid var(--surface-border)',
  borderRadius: 'var(--radius-control)',
  padding: 8,
  color: 'var(--text-primary)',
};

// Instructor team picker. Once teams are assigned to organizations, options are grouped per
// organization (alphabetical, unassigned teams last) so a long roster stays scannable; with no
// organizations it stays a flat list. Team order within a group follows the roster's sort order.
export function TeamSelect({ teams, value, onChange, style }: TeamSelectProps) {
  const list = teams ?? [];
  const grouped = list.some((t) => t.organizationName);

  let options: React.ReactNode;
  if (!grouped) {
    options = list.map((t) => (
      <option key={t.id} value={t.id}>
        {t.name}
      </option>
    ));
  } else {
    const groups = new Map<string, TeamOption[]>();
    for (const t of list) {
      const key = t.organizationName ?? '';
      groups.set(key, [...(groups.get(key) ?? []), t]);
    }
    const names = [...groups.keys()].sort((a, b) => (!a ? 1 : !b ? -1 : a.localeCompare(b)));
    options = names.map((name) => (
      <optgroup key={name || '__none'} label={name || 'No organization'}>
        {groups.get(name)!.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </optgroup>
    ));
  }

  return (
    <select
      aria-label="Team"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')}
      style={style ?? defaultStyle}
    >
      <option value="">Select a team…</option>
      {options}
    </select>
  );
}
