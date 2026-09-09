import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { Button } from '../../components/Button';
import { TelemetryBadge } from '../../components/TelemetryBadge';
import { useSocketEvent } from '../../hooks/useSocketEvent';
import { useDraftStore } from '../../stores/draftStore';

interface ActiveCyberRange {
  cyberRangeId: number;
  name: string;
}

interface Category {
  id: number;
  key: string;
  label: string;
}

interface DocEntry {
  id: number;
  body: string;
  isImportantFinding: number;
  createdAt: string;
  authorName: string;
  categoryKey: string | null;
  categoryLabel: string | null;
}

export function InvestigationPage() {
  const queryClient = useQueryClient();
  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [isImportant, setIsImportant] = useState(false);

  const { data: activeData } = useQuery({
    queryKey: ['active-cyber-range'],
    queryFn: () => apiFetch<{ active: ActiveCyberRange | null }>('/teams/me/active-cyber-range'),
  });
  const active = activeData?.active;

  // Draft text lives in a store keyed by cyber range, not local state, so it survives navigating
  // away to Topology and back (US-004's "don't lose your work state") rather than unmounting with
  // the page.
  const draft = useDraftStore((s) => (active ? s.draftsByCyberRange[active.cyberRangeId] ?? '' : ''));
  const setDraft = useDraftStore((s) => s.setDraft);
  const clearDraft = useDraftStore((s) => s.clearDraft);
  const body = draft;

  const { data: categoriesData } = useQuery({
    queryKey: ['documentation-categories'],
    queryFn: () => apiFetch<{ categories: Category[] }>('/documentation-categories'),
  });

  const { data: entriesData } = useQuery({
    enabled: !!active,
    queryKey: ['documentation', active?.cyberRangeId],
    queryFn: () =>
      apiFetch<{ entries: DocEntry[] }>(`/cyber-ranges/${active!.cyberRangeId}/documentation`),
  });

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch(`/cyber-ranges/${active!.cyberRangeId}/documentation`, {
        method: 'POST',
        body: JSON.stringify({
          body,
          categoryId: categoryId === '' ? null : categoryId,
          isImportantFinding: isImportant,
        }),
      }),
    onSuccess: () => {
      if (active) clearDraft(active.cyberRangeId);
      setIsImportant(false);
      queryClient.invalidateQueries({ queryKey: ['documentation', active?.cyberRangeId] });
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    mutation.mutate();
  }

  // Realtime: merge entries other teammates post, without a refetch (US-003's "shared timeline").
  useSocketEvent<{ entry: DocEntry }>('documentation:new', ({ entry }) => {
    if (!active) return;
    queryClient.setQueryData<{ entries: DocEntry[] }>(
      ['documentation', active.cyberRangeId],
      (current) => {
        if (!current) return current;
        if (current.entries.some((e) => e.id === entry.id)) return current;
        return { entries: [...current.entries, entry] };
      },
    );
  });

  if (!active) {
    return (
      <div style={{ padding: 'var(--space-xl)', color: 'var(--text-muted)' }}>
        No active Cyber Range — documentation opens once your team's investigation starts.
      </div>
    );
  }

  return (
    <div
      style={{
        padding: 'var(--space-xl)',
        display: 'grid',
        gridTemplateColumns: '60% 40%',
        gap: 'var(--space-xl)',
      }}
    >
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h1 style={{ fontSize: 20, color: 'var(--text-primary)', margin: '0 0 var(--space-md)' }}>
            Timeline — {active.name}
          </h1>
          <Link to="/topology" style={{ fontSize: 12, color: 'var(--signal-secondary)' }}>
            View topology →
          </Link>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          {entriesData?.entries.length === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No entries yet.</div>
          )}
          {entriesData?.entries.map((entry) => (
            <div
              key={entry.id}
              style={{
                padding: 'var(--space-sm) var(--space-md)',
                border: '1px solid var(--surface-border)',
                borderLeft: entry.isImportantFinding
                  ? '3px solid var(--signal-primary)'
                  : '1px solid var(--surface-border)',
                borderRadius: 'var(--radius-control)',
                background: 'var(--surface-1)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: 4,
                  fontSize: 11,
                  color: 'var(--text-telemetry)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                <span>
                  {entry.authorName} · {new Date(entry.createdAt).toLocaleTimeString()}
                </span>
                <span style={{ display: 'flex', gap: 6 }}>
                  {entry.isImportantFinding ? <TelemetryBadge tone="primary">Finding</TelemetryBadge> : null}
                  {entry.categoryLabel ? <TelemetryBadge>{entry.categoryLabel}</TelemetryBadge> : null}
                </span>
              </div>
              <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>{entry.body}</div>
            </div>
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
        <h2 style={{ fontSize: 14, color: 'var(--text-muted)', margin: 0 }}>Add entry</h2>
        <textarea
          value={body}
          onChange={(e) => active && setDraft(active.cyberRangeId, e.target.value)}
          rows={4}
          placeholder="What did you find or do?"
          style={{
            background: 'transparent',
            border: '1px solid var(--surface-border)',
            borderRadius: 'var(--radius-control)',
            padding: 8,
            color: 'var(--text-primary)',
            resize: 'vertical',
          }}
        />
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : '')}
          style={{
            background: 'var(--surface-1)',
            border: '1px solid var(--surface-border)',
            borderRadius: 'var(--radius-control)',
            padding: 8,
            color: 'var(--text-primary)',
          }}
        >
          <option value="">No category</option>
          {categoriesData?.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)' }}>
          <input type="checkbox" checked={isImportant} onChange={(e) => setIsImportant(e.target.checked)} />
          Mark as important finding
        </label>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Adding…' : 'Add entry'}
        </Button>
      </form>
    </div>
  );
}
