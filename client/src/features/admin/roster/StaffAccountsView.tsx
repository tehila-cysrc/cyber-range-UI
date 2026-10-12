import { useEffect, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../../lib/apiClient';
import { Avatar } from '../../../components/Avatar';
import { AvatarPicker } from '../../../components/AvatarPicker';
import { Button } from '../../../components/Button';
import { confirmAction, promptAction } from '../../../components/ConfirmDialog';
import { useAuthStore } from '../../../stores/authStore';
import { MoreMenu, type MoreMenuItem } from './MoreMenu';
import { AddCard, SectionHeader, SectionView } from './RosterSection';
import { inputStyle, linkButtonStyle, postJson, useRosterMutation } from './rosterData';

type StaffRole = 'admin' | 'instructor';

interface Assignment {
  organizationId: number;
  organizationName: string;
  cyberRangeId: number;
  cyberRangeName: string;
}

interface StaffAccount {
  id: number;
  username: string;
  role: StaffRole;
  displayName: string;
  avatar: string | null;
  disabledAt: string | null;
  assignments: Assignment[];
}

const ROLE_LABEL: Record<StaffRole, string> = { admin: 'Admin', instructor: 'Instructor' };

// Roster → Staff accounts (admin only). An admin runs the whole system; an instructor works only on the
// (organization, scenario) pairs assigned here — the server enforces it on every request.
export function StaffAccountsView({ adding, onCloseAdd }: { adding: boolean; onCloseAdd: () => void }) {
  const me = useAuthStore((s) => s.user);
  const { data } = useQuery({
    queryKey: ['admin-instructors'],
    queryFn: () => apiFetch<{ accounts: StaffAccount[]; scopedInstructorsEnabled: boolean }>('/admin/accounts'),
  });
  const accounts = data?.accounts ?? [];
  const active = accounts.filter((a) => !a.disabledAt);
  const [openAssignments, setOpenAssignments] = useState<number | null>(null);

  return (
    <SectionView>
      <SectionHeader
        title="Staff accounts"
        subtitle={`${active.filter((a) => a.role === 'admin').length} admin · ${active.filter((a) => a.role === 'instructor').length} instructor${
          accounts.length > active.length ? ` · ${accounts.length - active.length} disabled` : ''
        }`}
      />
      {data && !data.scopedInstructorsEnabled && (
        <div role="status" style={{ fontSize: 14, color: 'var(--signal-alert)' }}>
          Instructor accounts are switched off on this deployment (ENABLE_SCOPED_INSTRUCTORS=false) — they can't sign in.
        </div>
      )}

      {adding && <NewAccountCard onClose={onCloseAdd} />}

      <div style={{ border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-container)', background: 'var(--surface-1)', padding: '6px 12px' }}>
        {accounts.map((a) => (
          <AccountRow
            key={a.id}
            account={a}
            isMe={a.id === me?.accountId}
            assignmentsOpen={openAssignments === a.id}
            onToggleAssignments={() => setOpenAssignments(openAssignments === a.id ? null : a.id)}
          />
        ))}
      </div>
    </SectionView>
  );
}

function AccountRow({
  account: a,
  isMe,
  assignmentsOpen,
  onToggleAssignments,
}: {
  account: StaffAccount;
  isMe: boolean;
  assignmentsOpen: boolean;
  onToggleAssignments: () => void;
}) {
  const patch = useRosterMutation((body: Record<string, unknown>) => postJson(`/admin/accounts/${a.id}`, body, 'PATCH'), 'Could not update the account');
  const other: StaffRole = a.role === 'admin' ? 'instructor' : 'admin';

  async function changeRole() {
    const ok = await confirmAction({
      title: `Make ${a.displayName} ${other === 'admin' ? 'an admin' : 'an instructor'}?`,
      message:
        other === 'admin'
          ? 'Admins see and manage everything: every organization and scenario, accounts, environments, exports and resets.'
          : 'They will only see the organizations and scenarios you assign to them (none yet). They are signed out now.',
      confirmLabel: `Make ${ROLE_LABEL[other].toLowerCase()}`,
    });
    if (ok) patch.mutate({ role: other });
  }

  async function resetPassword() {
    const password = await promptAction({
      title: `New password for @${a.username}`,
      message: 'At least 8 characters. They are signed out everywhere and sign in with the new password.',
      confirmLabel: 'Set password',
      input: { label: 'New password', placeholder: 'min. 8 characters' },
    });
    if (password !== null) patch.mutate({ password });
  }

  async function toggleDisabled() {
    if (a.disabledAt) return patch.mutate({ disabled: false });
    const ok = await confirmAction({
      title: `Disable ${a.displayName} (@${a.username})?`,
      message: 'They can no longer sign in and are signed out now. Scores they awarded and help requests they answered stay on record under their name.',
      confirmLabel: 'Disable account',
      danger: true,
    });
    if (ok) patch.mutate({ disabled: true });
  }

  const items: MoreMenuItem[] = isMe
    ? []
    : [
        ...(a.disabledAt ? [] : [{ label: `Make ${ROLE_LABEL[other].toLowerCase()}…`, onSelect: changeRole }]),
        { label: 'Reset password…', onSelect: resetPassword },
        { label: a.disabledAt ? 'Enable account' : 'Disable account…', onSelect: toggleDisabled, danger: !a.disabledAt },
      ];

  return (
    <div style={{ padding: '6px 0', borderBottom: '1px solid var(--surface-border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--text-muted)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'wrap', opacity: a.disabledAt ? 0.6 : 1 }}>
          <Avatar name={a.displayName} avatar={a.avatar} size={22} />
          <bdi style={{ color: 'var(--text-primary)' }}>{a.displayName}</bdi>
          <span className="tabular" style={{ color: 'var(--text-telemetry)' }}>@{a.username}</span>
          <span
            style={{
              fontSize: 12,
              padding: '1px 8px',
              borderRadius: 10,
              border: `1px solid ${a.role === 'admin' ? 'var(--signal-alert)' : 'var(--signal-primary)'}`,
              color: a.role === 'admin' ? 'var(--signal-alert)' : 'var(--signal-primary)',
            }}
          >
            {ROLE_LABEL[a.role]}
          </span>
          {a.disabledAt && <span style={{ fontSize: 12, color: 'var(--text-telemetry)' }}>disabled</span>}
          {isMe && <span style={{ fontSize: 12, color: 'var(--signal-primary)' }}>you</span>}
          {a.role === 'instructor' && !a.disabledAt && (
            <button type="button" onClick={onToggleAssignments} aria-expanded={assignmentsOpen} style={linkButtonStyle}>
              {a.assignments.length === 0 ? 'no assignments — assign…' : `${a.assignments.length} assignment${a.assignments.length === 1 ? '' : 's'}`}
            </button>
          )}
        </span>
        {items.length > 0 && <MoreMenu label={`Actions for ${a.displayName}`} items={items} />}
      </div>
      {a.role === 'instructor' && !assignmentsOpen && a.assignments.length > 0 && (
        <div style={{ fontSize: 13, color: 'var(--text-telemetry)', margin: '4px 0 0 30px' }}>
          {a.assignments.map((x) => `${x.organizationName} · ${x.cyberRangeName}`).join('  ·  ')}
        </div>
      )}
      {assignmentsOpen && <AssignmentsEditor account={a} onDone={onToggleAssignments} />}
    </div>
  );
}

interface OrgOption {
  id: number;
  name: string;
}
interface RangeOption {
  id: number;
  name: string;
  dayLabel: string;
}

// Organizations × scenarios. Each ticked cell is one (organization, scenario) pair: the instructor sees
// that organization's teams working on that scenario — never the other combinations.
function AssignmentsEditor({ account, onDone }: { account: StaffAccount; onDone: () => void }) {
  const { data: orgData } = useQuery({
    queryKey: ['admin-organizations'],
    queryFn: () => apiFetch<{ organizations: OrgOption[] }>('/admin/organizations'),
  });
  const { data: rangeData } = useQuery({
    queryKey: ['cyber-ranges'],
    queryFn: () => apiFetch<{ cyberRanges: RangeOption[] }>('/cyber-ranges'),
  });
  const key = (orgId: number, rangeId: number) => `${orgId}:${rangeId}`;
  const [selected, setSelected] = useState<Set<string>>(() => new Set(account.assignments.map((x) => key(x.organizationId, x.cyberRangeId))));
  useEffect(() => setSelected(new Set(account.assignments.map((x) => key(x.organizationId, x.cyberRangeId)))), [account.assignments]);

  const save = useRosterMutation(
    () =>
      postJson(
        `/admin/accounts/${account.id}/assignments`,
        { pairs: [...selected].map((k) => ({ organizationId: Number(k.split(':')[0]), cyberRangeId: Number(k.split(':')[1]) })) },
        'PUT',
      ),
    'Could not save the assignments',
    onDone,
  );

  const orgs = orgData?.organizations ?? [];
  const ranges = rangeData?.cyberRanges ?? [];
  const toggle = (k: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate(undefined);
  }

  if (orgs.length === 0 || ranges.length === 0) {
    return (
      <div style={{ fontSize: 13, color: 'var(--text-muted)', margin: '6px 0 6px 30px' }}>
        {orgs.length === 0 ? 'Create an organization first — instructors are assigned per organization and scenario.' : 'Create a scenario first.'}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ margin: '8px 0 8px 30px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'start', padding: '4px 8px', color: 'var(--text-telemetry)', fontWeight: 500 }}>Organization / scenario</th>
              {ranges.map((r) => (
                <th key={r.id} title={r.dayLabel} style={{ padding: '4px 8px', color: 'var(--text-muted)', fontWeight: 500, whiteSpace: 'nowrap' }}>
                  <bdi>{r.name}</bdi>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orgs.map((o) => (
              <tr key={o.id} style={{ borderTop: '1px solid var(--surface-border)' }}>
                <th scope="row" style={{ textAlign: 'start', padding: '4px 8px', color: 'var(--text-primary)', fontWeight: 500 }}>
                  <bdi>{o.name}</bdi>
                </th>
                {ranges.map((r) => {
                  const k = key(o.id, r.id);
                  return (
                    <td key={r.id} style={{ textAlign: 'center', padding: '4px 8px' }}>
                      <input
                        type="checkbox"
                        checked={selected.has(k)}
                        onChange={() => toggle(k)}
                        aria-label={`${account.displayName}: ${o.name} on ${r.name}`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-telemetry)' }}>
        Editing a scenario's content (topology, ATT&amp;CK techniques, briefing) changes it for every organization that runs it.
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button type="submit" variant="ghost" disabled={save.isPending}>Save assignments</Button>
        <button type="button" onClick={onDone} style={linkButtonStyle}>cancel</button>
      </div>
    </form>
  );
}

function NewAccountCard({ onClose }: { onClose: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<StaffRole>('instructor');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const create = useRosterMutation(
    () => postJson('/admin/accounts', { username, password, displayName, avatar, role }),
    'Could not create the account',
    onClose,
  );

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!username.trim()) return setFormError('Username is required');
    if (password.length < 8) return setFormError('Password must be at least 8 characters');
    create.mutate(undefined);
  }

  return (
    <AddCard title="New staff account" submitLabel="Create account" pending={create.isPending} error={formError} onSubmit={handleCreate} onClose={onClose}>
      <select value={role} onChange={(e) => setRole(e.target.value as StaffRole)} aria-label="Role" style={{ ...inputStyle, background: 'var(--surface-1)' }}>
        <option value="instructor">Instructor — only the organizations and scenarios you assign</option>
        <option value="admin">Admin — everything, including accounts and system settings</option>
      </select>
      <input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" aria-label="Username" autoComplete="off" style={inputStyle} />
      <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (min. 8 characters)" aria-label="Password" autoComplete="new-password" style={inputStyle} />
      <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display name (optional)" aria-label="Display name" style={inputStyle} />
      <AvatarPicker name={displayName || username} value={avatar} onChange={setAvatar} collapsible />
    </AddCard>
  );
}
