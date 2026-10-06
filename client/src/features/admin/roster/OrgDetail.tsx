import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { apiFetch } from '../../../lib/apiClient';
import { Button } from '../../../components/Button';
import { confirmAction } from '../../../components/ConfirmDialog';
import { useToastStore } from '../../../stores/toastStore';
import { MoreMenu } from './MoreMenu';
import { TeamRow } from './TeamRow';
import {
  formatJoinCode,
  inputStyle,
  linkButtonStyle,
  postJson,
  useRosterMutation,
  type Organization,
  type Team,
} from './rosterData';

interface Props {
  // null = the "No organization" view (unassigned teams).
  org: Organization | null;
  teams: Team[];
  organizations: Organization[];
  focusTeamId: number | null;
  onDeleted: () => void;
}

export function OrgDetail({ org, teams, organizations, focusTeamId, onDeleted }: Props) {
  const ownTeams = teams.filter((t) => t.organizationId === (org?.id ?? null));
  const studentCount = ownTeams.reduce((n, t) => n + t.members.length, 0);

  // Teams start collapsed; a search hit opens (and scrolls to) the matching team.
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (focusTeamId === null) return;
    setExpanded((prev) => new Set(prev).add(focusTeamId));
    requestAnimationFrame(() => document.getElementById(`team-${focusTeamId}`)?.scrollIntoView({ block: 'center' }));
  }, [focusTeamId]);
  // Switching organization starts collapsed again (except a search hit's team).
  useEffect(() => setExpanded(focusTeamId === null ? new Set() : new Set([focusTeamId])), [org?.id]);

  const allExpanded = ownTeams.length > 0 && ownTeams.every((t) => expanded.has(t.id));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', minWidth: 0 }}>
      {org ? (
        <OrgHeader org={org} teamCount={ownTeams.length} studentCount={studentCount} onDeleted={onDeleted} />
      ) : (
        <div>
          <h1 style={{ fontSize: 22, color: 'var(--text-primary)', margin: 0 }}>
            {organizations.length > 0 ? 'No organization' : 'Teams'}
          </h1>
          <div className="tabular" style={{ fontSize: 13, color: 'var(--text-telemetry)', marginTop: 4 }}>
            {ownTeams.length} team{ownTeams.length === 1 ? '' : 's'} · {studentCount} student{studentCount === 1 ? '' : 's'}
          </div>
        </div>
      )}

      {org ? <OrgJoinCode org={org} /> : <GeneralJoinCode hasOrganizations={organizations.length > 0} />}

      {ownTeams.length > 1 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            style={linkButtonStyle}
            onClick={() => setExpanded(allExpanded ? new Set() : new Set(ownTeams.map((t) => t.id)))}
          >
            {allExpanded ? 'Collapse all' : 'Expand all'}
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
        {ownTeams.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>
            {org ? 'No teams in this organization yet.' : 'No teams without an organization.'}
          </div>
        )}
        {ownTeams.map((team) => (
          <div key={team.id} id={`team-${team.id}`}>
            <TeamRow
              team={team}
              allTeams={teams}
              organizations={organizations}
              expanded={expanded.has(team.id)}
              onToggle={() =>
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(team.id)) next.delete(team.id);
                  else next.add(team.id);
                  return next;
                })
              }
            />
          </div>
        ))}
      </div>

      <AddTeam organizationId={org?.id ?? null} />
    </div>
  );
}

function OrgHeader({ org, teamCount, studentCount, onDeleted }: { org: Organization; teamCount: number; studentCount: number; onDeleted: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(org.name);
  useEffect(() => {
    setEditing(false);
    setName(org.name);
  }, [org.id, org.name]);

  const rename = useRosterMutation((next: string) => postJson(`/admin/organizations/${org.id}`, { name: next }, 'PATCH'), 'Could not rename the organization', () => setEditing(false));
  const remove = useRosterMutation(() => postJson(`/admin/organizations/${org.id}`, {}, 'DELETE'), 'Could not delete the organization', onDeleted);

  function handleRename(e: FormEvent) {
    e.preventDefault();
    const next = name.trim();
    if (!next || next === org.name) return setEditing(false);
    rename.mutate(next);
  }

  async function handleDelete() {
    const ok = await confirmAction({
      title: `Delete the organization "${org.name}"?`,
      message:
        teamCount > 0
          ? `Its ${teamCount} team(s) are kept, with their accounts and history — they move to "No organization". Its join code stops working.`
          : 'No team belongs to it. Its join code stops working.',
      confirmLabel: 'Delete organization',
      danger: true,
    });
    if (ok) remove.mutate(undefined);
  }

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        {editing ? (
          <form onSubmit={handleRename} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
              aria-label="Organization name"
              style={{ ...inputStyle, fontSize: 18, flex: '1 1 200px' }}
            />
            <Button type="submit" variant="ghost" disabled={rename.isPending}>Save</Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </form>
        ) : (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 22, color: 'var(--text-primary)', margin: 0, overflowWrap: 'anywhere' }}>
              <bdi>{org.name}</bdi>
            </h1>
            <button type="button" onClick={() => setEditing(true)} style={linkButtonStyle} aria-label={`Rename ${org.name}`}>
              ✎ rename
            </button>
          </div>
        )}
        <div className="tabular" style={{ fontSize: 13, color: 'var(--text-telemetry)', marginTop: 4 }}>
          {teamCount} team{teamCount === 1 ? '' : 's'} · {studentCount} student{studentCount === 1 ? '' : 's'}
        </div>
      </div>
      <MoreMenu label={`Actions for ${org.name}`} items={[{ label: 'Delete organization', onSelect: handleDelete, danger: true }]} />
    </div>
  );
}

function JoinCodeCard({
  title,
  note,
  code,
  pending,
  onSet,
  closeOnly = false,
}: {
  title: string;
  note: string;
  code: string | null;
  pending: boolean;
  onSet: (open: boolean) => void;
  closeOnly?: boolean;
}) {
  const pushToast = useToastStore((s) => s.push);

  async function handleNewCode() {
    const ok = await confirmAction({
      title: 'Issue a new join code?',
      message: 'The current code stops working immediately. Students who already registered are not affected.',
      confirmLabel: 'Issue new code',
    });
    if (ok) onSet(true);
  }

  async function handleCopy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      pushToast('Join code copied', 'success');
    } catch {
      pushToast('Could not copy — select the code and copy it manually');
    }
  }

  return (
    <section
      aria-label={title}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-sm) var(--space-md)',
        padding: 'var(--space-md)',
        border: `1px solid ${code ? 'var(--signal-primary)' : 'var(--surface-border)'}`,
        borderRadius: 'var(--radius-container)',
        background: 'var(--surface-1)',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{title}</div>
        {code ? (
          <div className="tabular" style={{ fontFamily: 'var(--font-mono)', fontSize: 24, letterSpacing: '0.14em', color: 'var(--signal-primary)', userSelect: 'all' }}>
            {formatJoinCode(code)}
          </div>
        ) : (
          <div style={{ fontSize: 14, color: 'var(--text-telemetry)', marginTop: 2 }}>Registration closed</div>
        )}
        <div style={{ fontSize: 12, color: 'var(--text-telemetry)', marginTop: 4 }}>{note}</div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
        {code ? (
          <>
            {!closeOnly && (
              <>
                <Button variant="ghost" onClick={() => handleCopy(code)}>Copy</Button>
                <Button variant="ghost" disabled={pending} onClick={handleNewCode}>New code</Button>
              </>
            )}
            <Button variant="destructive" disabled={pending} onClick={() => onSet(false)}>Close</Button>
          </>
        ) : (
          <Button variant="ghost" disabled={pending} onClick={() => onSet(true)}>Open registration</Button>
        )}
      </div>
    </section>
  );
}

// A student who registers with an organization's code can only pick that organization's teams.
function OrgJoinCode({ org }: { org: Organization }) {
  const setRegistration = useRosterMutation(
    (open: boolean) => postJson(`/admin/organizations/${org.id}/registration`, { open }, 'PUT'),
    'Could not change the join code',
  );
  return (
    <JoinCodeCard
      title="Join code"
      note="Students who register with this code can only pick this organization's teams (Register tab on the login page)."
      code={org.joinCode}
      pending={setRegistration.isPending}
      onSet={(open) => setRegistration.mutate(open)}
    />
  );
}

// The event-wide code only lists teams with no organization. Once organizations exist registration
// goes through their own codes, so this card only shows while no organization exists — or, close-only,
// while a code from before is still open, so it can't stay open out of sight.
function GeneralJoinCode({ hasOrganizations }: { hasOrganizations: boolean }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['admin-registration'],
    queryFn: () => apiFetch<{ open: boolean; joinCode: string | null }>('/admin/registration'),
  });
  const setRegistration = useMutation({
    mutationFn: (open: boolean) =>
      apiFetch<{ open: boolean; joinCode: string | null }>('/admin/registration', { method: 'PUT', body: JSON.stringify({ open }) }),
    onSuccess: (res) => queryClient.setQueryData(['admin-registration'], res),
  });
  if (!data || (hasOrganizations && !data.open)) return null;
  return (
    <JoinCodeCard
      title={hasOrganizations ? 'General join code (teams with no organization)' : 'Join code'}
      note={
        hasOrganizations
          ? "Registration now goes through each organization's own code — close this one."
          : 'Students create their own account with this code (Register tab on the login page). Closed = only accounts you create can sign in.'
      }
      code={data.joinCode}
      pending={setRegistration.isPending}
      onSet={(open) => setRegistration.mutate(open)}
      closeOnly={hasOrganizations}
    />
  );
}

function AddTeam({ organizationId }: { organizationId: number | null }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const create = useRosterMutation(() => postJson('/admin/teams', { name, organizationId }), 'Could not create the team', () => setName(''));

  if (!open) {
    return (
      <div>
        <Button variant="ghost" onClick={() => setOpen(true)}>+ Add team</Button>
      </div>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) create.mutate(undefined);
      }}
      style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
    >
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} placeholder="Team name" aria-label="Team name" style={{ ...inputStyle, flex: '1 1 200px' }} />
      <Button type="submit" variant="ghost" disabled={create.isPending}>Create team</Button>
      <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Done</Button>
    </form>
  );
}
