import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { Button } from '../../components/Button';
import { TelemetryBadge } from '../../components/TelemetryBadge';
import { Avatar } from '../../components/Avatar';
import { FlagIcon } from '../../components/icons';
import { useSocketEvent } from '../../hooks/useSocketEvent';
import { useDraftStore } from '../../stores/draftStore';
import { useAuthStore } from '../../stores/authStore';

interface ActiveCyberRange {
  cyberRangeId: number;
  name: string;
}

interface Team {
  id: number;
  name: string;
}

interface TeamStatus {
  teamId: number;
  active: { cyberRangeId: number; name: string } | null;
}

interface Category {
  id: number;
  key: string;
  label: string;
}

interface DocEntry {
  id: number;
  body: string;
  imageDataUrl: string | null;
  isImportantFinding: number;
  createdAt: string;
  authorName: string;
  categoryKey: string | null;
  categoryLabel: string | null;
}

const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB raw file, before base64 inflation

export function InvestigationPage() {
  const queryClient = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const isInstructor = role === 'instructor';

  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [newCategoryLabel, setNewCategoryLabel] = useState('');
  const [isImportant, setIsImportant] = useState(false);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  // Student: own team's active range, resolved server-side from the auth token — never a
  // cross-team leak. Instructor: no team of their own, so this query stays off and they instead
  // pick a team below to view (US-002's "no exposure to another team's documentation", the flip
  // side — an instructor explicitly opting into ONE team's view, one at a time, never a merged one).
  const { data: activeData } = useQuery({
    queryKey: ['active-cyber-range'],
    queryFn: () => apiFetch<{ active: ActiveCyberRange | null }>('/teams/me/active-cyber-range'),
    enabled: !isInstructor,
  });
  const studentActive = activeData?.active;

  const [selectedTeamId, setSelectedTeamId] = useState<number | ''>('');
  const { data: teamsData } = useQuery({
    queryKey: ['admin-teams-list'],
    queryFn: () => apiFetch<{ teams: Team[] }>('/admin/teams'),
    enabled: isInstructor,
  });
  const { data: dashboardData } = useQuery({
    queryKey: ['instructor-dashboard'],
    queryFn: () => apiFetch<{ teams: TeamStatus[] }>('/admin/dashboard'),
    enabled: isInstructor,
    refetchInterval: isInstructor ? 5000 : false,
  });
  const selectedTeamActive = isInstructor
    ? dashboardData?.teams.find((t) => t.teamId === selectedTeamId)?.active ?? null
    : null;

  const active = isInstructor ? selectedTeamActive : studentActive;
  const cyberRangeId = active?.cyberRangeId;
  const teamIdParam = isInstructor && selectedTeamId ? selectedTeamId : null;

  // Draft text lives in a store keyed by cyber range, not local state, so it survives navigating
  // away to Topology and back (US-004's "don't lose your work state") rather than unmounting with
  // the page. Instructors never author entries, so drafts are moot for them.
  const draft = useDraftStore((s) => (cyberRangeId ? s.draftsByCyberRange[cyberRangeId] ?? '' : ''));
  const setDraft = useDraftStore((s) => s.setDraft);
  const clearDraft = useDraftStore((s) => s.clearDraft);
  const body = draft;

  const { data: categoriesData } = useQuery({
    queryKey: ['documentation-categories'],
    queryFn: () => apiFetch<{ categories: Category[] }>('/documentation-categories'),
    enabled: !isInstructor,
  });

  const { data: entriesData } = useQuery({
    enabled: !!cyberRangeId && (!isInstructor || !!teamIdParam),
    queryKey: ['documentation', cyberRangeId, teamIdParam],
    queryFn: () =>
      apiFetch<{ entries: DocEntry[] }>(
        `/cyber-ranges/${cyberRangeId}/documentation${teamIdParam ? `?teamId=${teamIdParam}` : ''}`,
      ),
  });

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch(`/cyber-ranges/${cyberRangeId}/documentation`, {
        method: 'POST',
        body: JSON.stringify({
          body,
          categoryId: categoryId === '' ? null : categoryId,
          newCategoryLabel: newCategoryLabel.trim() || undefined,
          isImportantFinding: isImportant,
          imageDataUrl: imageDataUrl ?? undefined,
        }),
      }),
    onSuccess: () => {
      if (cyberRangeId) clearDraft(cyberRangeId);
      setIsImportant(false);
      setCategoryId('');
      setNewCategoryLabel('');
      setImageDataUrl(null);
      setImageError(null);
      queryClient.invalidateQueries({ queryKey: ['documentation', cyberRangeId, teamIdParam] });
      // A free-text category may have just been created — refresh the dropdown for next time.
      if (newCategoryLabel.trim()) {
        queryClient.invalidateQueries({ queryKey: ['documentation-categories'] });
      }
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    mutation.mutate();
  }

  function handleImageChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError('Image is too large (max 4MB).');
      return;
    }
    setImageError(null);
    const reader = new FileReader();
    reader.onload = () => setImageDataUrl(reader.result as string);
    reader.readAsDataURL(file);
  }

  // Realtime: merge entries other teammates post, without a refetch (US-003's "shared timeline").
  // Now also reaches every instructor (see emitDocumentationNew), not just the authoring team's own
  // room — an instructor viewing a different team (or none) must ignore it, and since two teams can
  // share the same active cyber range, matching on cyberRangeId alone isn't enough either.
  useSocketEvent<{ entry: DocEntry; teamId: number }>('documentation:new', ({ entry, teamId }) => {
    if (!cyberRangeId) return;
    if (isInstructor && teamId !== selectedTeamId) return;
    queryClient.setQueryData<{ entries: DocEntry[] }>(
      ['documentation', cyberRangeId, teamIdParam],
      (current) => {
        if (!current) return current;
        if (current.entries.some((e) => e.id === entry.id)) return current;
        return { entries: [...current.entries, entry] };
      },
    );
  });

  if (isInstructor) {
    return (
      <div style={{ padding: 'var(--space-xl)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h1 style={{ fontSize: 22, color: 'var(--text-primary)', margin: '0 0 var(--space-md)' }}>
            Timeline{active ? ` — ${active.name}` : ''}
          </h1>
          <select
            value={selectedTeamId}
            onChange={(e) => setSelectedTeamId(e.target.value ? Number(e.target.value) : '')}
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--surface-border)',
              borderRadius: 'var(--radius-control)',
              padding: 8,
              color: 'var(--text-primary)',
            }}
          >
            <option value="">Select a team…</option>
            {teamsData?.teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        {!selectedTeamId ? (
          <div style={{ color: 'var(--text-muted)' }}>Pick a team above to view its timeline.</div>
        ) : !active ? (
          <div style={{ color: 'var(--text-muted)' }}>No active Cyber Range for this team.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            {entriesData?.entries.length === 0 && (
              <div style={{ color: 'var(--text-muted)', fontSize: 15 }}>No entries yet.</div>
            )}
            {entriesData?.entries.map((entry) => (
              <TimelineEntry key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </div>
    );
  }

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
          <h1 style={{ fontSize: 22, color: 'var(--text-primary)', margin: '0 0 var(--space-md)' }}>
            Timeline — {active.name}
          </h1>
          <Link to="/topology" style={{ fontSize: 14, color: 'var(--signal-secondary)' }}>
            View topology →
          </Link>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          {entriesData?.entries.length === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: 15 }}>No entries yet.</div>
          )}
          {entriesData?.entries.map((entry) => (
            <TimelineEntry key={entry.id} entry={entry} />
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
        <h2 style={{ fontSize: 16, color: 'var(--text-muted)', margin: 0 }}>Add entry</h2>
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
          disabled={!!newCategoryLabel.trim()}
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
        <input
          value={newCategoryLabel}
          onChange={(e) => setNewCategoryLabel(e.target.value)}
          placeholder="…or type a new category (e.g. IOC, C2)"
          style={{
            background: 'transparent',
            border: '1px solid var(--surface-border)',
            borderRadius: 'var(--radius-control)',
            padding: 8,
            color: 'var(--text-primary)',
          }}
        />
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 15, color: 'var(--text-muted)' }}>
          Attach a screenshot (optional)
          <input type="file" accept="image/*" onChange={handleImageChange} />
        </label>
        {imageError && <div style={{ color: 'var(--signal-alert)', fontSize: 13 }}>{imageError}</div>}
        {imageDataUrl && (
          <div style={{ position: 'relative', width: 'fit-content' }}>
            <img
              src={imageDataUrl}
              alt="Selected attachment preview"
              style={{ maxWidth: '100%', maxHeight: 160, borderRadius: 'var(--radius-control)', display: 'block' }}
            />
            <button
              type="button"
              onClick={() => setImageDataUrl(null)}
              style={{
                position: 'absolute',
                top: 4,
                right: 4,
                background: 'var(--surface-floor)',
                color: 'var(--text-primary)',
                border: '1px solid var(--surface-border)',
                borderRadius: 'var(--radius-control)',
                cursor: 'pointer',
                fontSize: 13,
                padding: '2px 6px',
              }}
            >
              Remove
            </button>
          </div>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 15, color: 'var(--text-muted)' }}>
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

function TimelineEntry({ entry }: { entry: DocEntry }) {
  return (
    <div
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
          alignItems: 'center',
          marginBottom: 4,
          fontSize: 13,
          color: 'var(--text-telemetry)',
          fontFamily: 'var(--font-mono)',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Avatar name={entry.authorName} size={20} />
          {entry.authorName} · {new Date(entry.createdAt).toLocaleTimeString()}
        </span>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {entry.isImportantFinding ? (
            <TelemetryBadge tone="primary">
              <FlagIcon style={{ marginRight: 3, verticalAlign: '-2px' }} />
              Finding
            </TelemetryBadge>
          ) : null}
          {entry.categoryLabel ? <TelemetryBadge>{entry.categoryLabel}</TelemetryBadge> : null}
        </span>
      </div>
      <div style={{ color: 'var(--text-primary)', fontSize: 15 }}>{entry.body}</div>
      {entry.imageDataUrl && (
        <img
          src={entry.imageDataUrl}
          alt="Attached evidence"
          style={{
            marginTop: 'var(--space-sm)',
            maxWidth: '100%',
            maxHeight: 320,
            borderRadius: 'var(--radius-control)',
            border: '1px solid var(--surface-border)',
            display: 'block',
          }}
        />
      )}
    </div>
  );
}
