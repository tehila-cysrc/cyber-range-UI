import { useSearchParams } from 'react-router-dom';
import { SideNav, type SideNavGroup } from '../../components/SideNav';

export interface ScenarioListItem {
  id: number;
  name: string;
  dayLabel: string;
  difficulty?: string;
}

// The selected scenario lives in the URL (?scenario=<id>) on Scenarios and Topology Admin, so a
// refresh or a shared link keeps it. Without a (valid) one, the first scenario is selected.
export function useSelectedScenario(ranges: ScenarioListItem[] | undefined): [number | '', (id: number | '') => void] {
  const [params, setParams] = useSearchParams();
  const raw = Number(params.get('scenario'));
  const valid = ranges?.some((r) => r.id === raw) ? raw : '';
  const selected = valid !== '' ? valid : ranges?.[0]?.id ?? '';
  const select = (id: number | '') => {
    const next = new URLSearchParams(params);
    if (id === '') next.delete('scenario');
    else next.set('scenario', String(id));
    setParams(next, { replace: true });
  };
  return [selected, select];
}

// Scenario list grouped by day (the API already orders by day, then scenario).
export function ScenarioSideNav({
  ranges,
  activeId,
  onSelect,
  onAdd,
}: {
  ranges: ScenarioListItem[];
  activeId: number | '' | null;
  onSelect: (id: number) => void;
  onAdd?: () => void;
}) {
  const groups: SideNavGroup[] = [];
  for (const r of ranges) {
    let group = groups.find((g) => g.label === r.dayLabel);
    if (!group) {
      group = { label: r.dayLabel, items: [] };
      groups.push(group);
    }
    group.items.push({ key: String(r.id), label: r.name });
  }
  return (
    <SideNav
      title="Scenarios"
      groups={groups}
      activeKey={activeId === '' || activeId === null ? null : String(activeId)}
      onSelect={(key) => onSelect(Number(key))}
      addLabel={onAdd ? 'New scenario' : undefined}
      onAdd={onAdd}
      filterThreshold={10}
      emptyText="No scenarios yet."
    />
  );
}
