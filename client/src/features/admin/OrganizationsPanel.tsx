import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { Button } from '../../components/Button';
import { confirmAction } from '../../components/ConfirmDialog';
import { useToastStore } from '../../stores/toastStore';

export interface Organization {
  id: number;
  name: string;
  teamCount: number;
}

const inputStyle = {
  background: 'var(--surface-1)',
  border: '1px solid var(--surface-border)',
  borderRadius: 'var(--radius-control)',
  padding: 8,
  color: 'var(--text-primary)',
};

// Organizations survive an event reset (CONFIG); deleting one only un-assigns its teams.
export function OrganizationsPanel({ organizations }: { organizations: Organization[] }) {
  const queryClient = useQueryClient();
  const pushToast = useToastStore((s) => s.push);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['admin-organizations'] });
    queryClient.invalidateQueries({ queryKey: ['admin-teams'] });
  }

  const create = useMutation({
    mutationFn: () => apiFetch('/admin/organizations', { method: 'POST', body: JSON.stringify({ name }) }),
    onSuccess: () => {
      setName('');
      setError(null);
      refresh();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not create the organization'),
  });

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      apiFetch(`/admin/organizations/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
    onSuccess: () => {
      setEditingId(null);
      refresh();
    },
    onError: (err) => pushToast(err instanceof Error ? err.message : 'Could not rename the organization'),
  });

  const remove = useMutation({
    mutationFn: (id: number) => apiFetch(`/admin/organizations/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError: (err) => pushToast(err instanceof Error ? err.message : 'Could not delete the organization'),
  });

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate();
  }

  function handleRename(e: FormEvent, org: Organization) {
    e.preventDefault();
    const next = editName.trim();
    if (!next || next === org.name) {
      setEditingId(null);
      return;
    }
    rename.mutate({ id: org.id, name: next });
  }

  async function handleDelete(org: Organization) {
    const ok = await confirmAction({
      title: `Delete the organization "${org.name}"?`,
      message:
        org.teamCount > 0
          ? `Its ${org.teamCount} team(s) are kept, with their accounts and history — they just no longer belong to any organization.`
          : 'No team belongs to it.',
      confirmLabel: 'Delete organization',
      danger: true,
    });
    if (ok) remove.mutate(org.id);
  }

  return (
    <section aria-label="Organizations" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
      <h2 style={{ fontSize: 15, color: 'var(--text-muted)', margin: 0 }}>Organizations</h2>
      {organizations.length === 0 && (
        <div style={{ fontSize: 14, color: 'var(--text-telemetry)' }}>No organizations yet.</div>
      )}
      {organizations.map((org) =>
        editingId === org.id ? (
          <form key={org.id} onSubmit={(e) => handleRename(e, org)} style={{ display: 'flex', gap: 6 }}>
            <input
              autoFocus
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setEditingId(null)}
              aria-label={`New name for ${org.name}`}
              style={{ ...inputStyle, flex: 1, minWidth: 0 }}
            />
            <Button type="submit" variant="ghost" disabled={rename.isPending}>Save</Button>
            <Button type="button" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
          </form>
        ) : (
          <div
            key={org.id}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 14, padding: '4px 0' }}
          >
            <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {org.name}{' '}
              <span className="tabular" style={{ color: 'var(--text-telemetry)' }}>
                · {org.teamCount} team{org.teamCount === 1 ? '' : 's'}
              </span>
            </span>
            <span style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
              <button
                onClick={() => {
                  setEditingId(org.id);
                  setEditName(org.name);
                }}
                aria-label={`Rename ${org.name}`}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13 }}
              >
                rename
              </button>
              <button
                onClick={() => handleDelete(org)}
                aria-label={`Delete organization ${org.name}`}
                disabled={remove.isPending}
                style={{ background: 'none', border: 'none', color: 'var(--signal-alert)', cursor: 'pointer', fontSize: 13 }}
              >
                delete
              </button>
            </span>
          </div>
        ),
      )}
      <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Organization name" aria-label="Organization name" style={inputStyle} />
        {error && <div style={{ color: 'var(--signal-alert)', fontSize: 14 }}>{error}</div>}
        <Button type="submit" variant="ghost" disabled={create.isPending}>Create organization</Button>
      </form>
    </section>
  );
}
