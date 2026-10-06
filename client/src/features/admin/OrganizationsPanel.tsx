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
  joinCode: string | null;
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

  // Per-organization join code: a student who uses it can only pick this organization's teams.
  const setRegistration = useMutation({
    mutationFn: ({ id, open }: { id: number; open: boolean }) =>
      apiFetch(`/admin/organizations/${id}/registration`, { method: 'PUT', body: JSON.stringify({ open }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-organizations'] }),
    onError: (err) => pushToast(err instanceof Error ? err.message : 'Could not change the join code'),
  });

  async function handleNewCode(org: Organization) {
    const ok = await confirmAction({
      title: `Issue a new join code for ${org.name}?`,
      message: 'The current code stops working immediately. Students who already registered are not affected.',
      confirmLabel: 'Issue new code',
    });
    if (ok) setRegistration.mutate({ id: org.id, open: true });
  }

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
      {organizations.length > 0 && (
        <div style={{ fontSize: 13, color: 'var(--text-telemetry)' }}>
          A student who registers with an organization's join code can only pick that organization's teams.
        </div>
      )}
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
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              padding: '6px 0',
              borderBottom: '1px solid var(--surface-border)',
            }}
          >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 14 }}>
            <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              <bdi>{org.name}</bdi>{' '}
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
          {org.joinCode ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span
                className="tabular"
                aria-label={`Join code for ${org.name}`}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 18, letterSpacing: '0.14em', color: 'var(--signal-primary)' }}
              >
                {org.joinCode}
              </span>
              <span style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={() => handleNewCode(org)}
                  disabled={setRegistration.isPending}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13 }}
                >
                  new code
                </button>
                <button
                  onClick={() => setRegistration.mutate({ id: org.id, open: false })}
                  disabled={setRegistration.isPending}
                  style={{ background: 'none', border: 'none', color: 'var(--signal-alert)', cursor: 'pointer', fontSize: 13 }}
                >
                  close registration
                </button>
              </span>
            </div>
          ) : (
            <Button
              variant="ghost"
              disabled={setRegistration.isPending}
              onClick={() => setRegistration.mutate({ id: org.id, open: true })}
              aria-label={`Open registration for ${org.name}`}
            >
              Open registration (join code)
            </Button>
          )}
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
