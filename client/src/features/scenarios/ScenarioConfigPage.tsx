import { useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { ScenarioDetailsForm } from './ScenarioDetailsForm';
import { confirmAction } from '../../components/ConfirmDialog';
import { ScriptPicker } from './ScriptPicker';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { TelemetryBadge } from '../../components/TelemetryBadge';
import { TechniquePicker } from '../../components/TechniquePicker';
import { useSocketEvent } from '../../hooks/useSocketEvent';
import { techniqueDisplayName, useMitreCatalog } from '../../lib/mitre';
import { formatEntryTime } from '../documentation/InvestigationPage';

interface CyberRange {
  id: number;
  name: string;
  dayLabel: string;
}

interface ExpectedTtp {
  id: number;
  techniqueId: string;
  tacticId: string;
  tacticName: string;
  points: number;
  description: string | null;
  topologyNodeId: number | null;
  triggerScriptId: number | null;
  triggerScriptName: string | null;
  topologyNodeLabel: string | null;
  sortOrder: number;
}

interface Occurrence {
  id: number;
  expectedTtpId: number;
  occurredAt: string;
  source: 'script_execution' | 'manual';
  scriptName: string | null;
  nodeLabel: string | null;
  recordedByName: string | null;
}

interface ExpectedResponse {
  attackVersion: string;
  expected: ExpectedTtp[];
  totalPoints: number;
  occurrences: Occurrence[];
}

interface Script {
  id: number;
  name: string;
  category?: string | null;
}

interface TopologyNode {
  id: number;
  label: string;
}

const fieldStyle: CSSProperties = {
  background: 'var(--surface-1)',
  border: '1px solid var(--surface-border)',
  borderRadius: 'var(--radius-control)',
  padding: 8,
  color: 'var(--text-primary)',
  minWidth: 0,
};

const monoLabel: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--text-telemetry)',
};

// datetime-local wants local wall-clock "YYYY-MM-DDTHH:mm:ss"; the server only ever stores UTC ISO.
function toLocalInputValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// Instructor-only scenario configuration: the ATT&CK techniques a scenario expects students to
// identify, before the run. Everything on this page is answer-key data (served only under /admin).
export function ScenarioConfigPage() {
  const queryClient = useQueryClient();
  const { data: catalog } = useMitreCatalog();
  const [cyberRangeId, setCyberRangeId] = useState<number | ''>('');
  const [creating, setCreating] = useState(false);
  const [editingDetails, setEditingDetails] = useState(false);

  const { data: rangesData } = useQuery({
    queryKey: ['cyber-ranges'],
    queryFn: () => apiFetch<{ cyberRanges: CyberRange[] }>('/cyber-ranges'),
  });
  const expectedKey = ['expected-ttps', cyberRangeId];
  const { data, error } = useQuery({
    queryKey: expectedKey,
    queryFn: () => apiFetch<ExpectedResponse>(`/admin/cyber-ranges/${cyberRangeId}/expected-ttps`),
    enabled: cyberRangeId !== '',
  });
  const { data: scriptsData } = useQuery({
    queryKey: ['admin-scripts-all'],
    queryFn: () => apiFetch<{ scripts: Script[] }>('/admin/scripts'),
  });
  const { data: topologyData } = useQuery({
    queryKey: ['topology', cyberRangeId],
    queryFn: () => apiFetch<{ nodes: TopologyNode[] }>(`/cyber-ranges/${cyberRangeId}/topology`),
    enabled: cyberRangeId !== '',
  });

  // Auto-recorded occurrences (a trigger script just succeeded) arrive as ttp:changed.
  useSocketEvent<{ cyberRangeId: number }>('ttp:changed', (p) => {
    if (p.cyberRangeId === cyberRangeId) queryClient.invalidateQueries({ queryKey: expectedKey });
  });

  const tacticOrder = useMemo(() => new Map(catalog?.tactics.map((t) => [t.id, t.order]) ?? []), [catalog]);
  const grouped = useMemo(() => {
    const groups = new Map<string, { tacticName: string; rows: ExpectedTtp[] }>();
    for (const e of data?.expected ?? []) {
      const g = groups.get(e.tacticId) ?? { tacticName: e.tacticName, rows: [] };
      g.rows.push(e);
      groups.set(e.tacticId, g);
    }
    return [...groups.entries()].sort(([a], [b]) => (tacticOrder.get(a) ?? 99) - (tacticOrder.get(b) ?? 99));
  }, [data, tacticOrder]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: expectedKey });

  return (
    <div className="page" style={{ padding: 'var(--space-xl)' }}>
      <div style={{ ...monoLabel, marginBottom: 4 }}>Scenario configuration</div>
      <h1 style={{ fontSize: 22, color: 'var(--text-primary)', margin: '0 0 var(--space-md)' }}>Scenarios</h1>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)', alignItems: 'center', marginBottom: 'var(--space-lg)' }}>
        <select
          aria-label="Scenario"
          value={cyberRangeId}
          onChange={(e) => {
            setCyberRangeId(e.target.value ? Number(e.target.value) : '');
            setCreating(false);
            setEditingDetails(false);
          }}
          style={{ ...fieldStyle, maxWidth: '100%' }}
        >
          <option value="">Select a scenario…</option>
          {rangesData?.cyberRanges.map((cr) => (
            <option key={cr.id} value={cr.id}>
              {cr.dayLabel} — {cr.name}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setCreating(true);
            setCyberRangeId('');
          }}
          style={{ padding: '6px 14px', fontSize: 14 }}
        >
          + New scenario
        </Button>
        {cyberRangeId !== '' && !creating && (
          <Button type="button" variant="ghost" onClick={() => setEditingDetails((v) => !v)} style={{ padding: '6px 14px', fontSize: 14 }}>
            {editingDetails ? 'Hide details' : 'Edit details & student briefing'}
          </Button>
        )}
      </div>

      {creating && (
        <ScenarioDetailsForm
          cyberRangeId="new"
          onCancel={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false);
            setCyberRangeId(id);
          }}
        />
      )}
      {cyberRangeId !== '' && editingDetails && (
        <ScenarioDetailsForm cyberRangeId={cyberRangeId} onSaved={() => setEditingDetails(false)} onCancel={() => setEditingDetails(false)} />
      )}

      {creating ? null : cyberRangeId === '' ? (
        <EmptyState
          message={
            rangesData && rangesData.cyberRanges.length === 0
              ? 'No scenarios yet — click "+ New scenario" to create the first one (or register an Azure environment, which creates one).'
              : 'Pick a scenario to edit its details, student briefing and the MITRE ATT&CK techniques students should identify.'
          }
        />
      ) : error ? (
        <EmptyState message={error instanceof ApiError ? error.message : 'Could not load this scenario.'} />
      ) : (
        <section
          style={{
            background: 'var(--surface-1)',
            border: '1px solid var(--surface-border)',
            borderRadius: 'var(--radius-container)',
            padding: 'var(--space-lg)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-md)',
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <h2 style={{ ...monoLabel, margin: 0 }}>Expected MITRE ATT&amp;CK techniques</h2>
            {data && (
              <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <TelemetryBadge tone="secondary">{data.expected.length} techniques</TelemetryBadge>
                <TelemetryBadge tone="primary">{data.totalPoints} pts available</TelemetryBadge>
                <TelemetryBadge>ATT&amp;CK v{data.attackVersion}</TelemetryBadge>
              </span>
            )}
          </div>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)' }}>
            Points are awarded automatically, once per team, when a student tags the technique (or one of its sub-techniques) on a
            Timeline entry. Students never see this list. MTTD is measured only when an occurrence is recorded — a successful run of the
            trigger script, or <em>Mark occurred</em> — and shows N/A otherwise.
          </p>

          {data && data.expected.length === 0 && <EmptyState message="No expected techniques yet — add the first one below." />}

          {grouped.map(([tacticId, group]) => (
            <div key={tacticId} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
              <div style={{ ...monoLabel, color: 'var(--signal-secondary)' }}>{group.tacticName}</div>
              {group.rows.map((row) => (
                <ExpectedRow
                  // Remount when the server copy changes (another instructor's edit, a refetch), so
                  // the row's local points/note drafts never overwrite newer data on blur.
                  key={`${row.id}:${row.points}:${row.description ?? ''}`}
                  row={row}
                  techniqueName={techniqueDisplayName(catalog, row.techniqueId)}
                  occurrences={data!.occurrences.filter((o) => o.expectedTtpId === row.id)}
                  scripts={scriptsData?.scripts ?? []}
                  nodes={topologyData?.nodes ?? []}
                  onChanged={invalidate}
                />
              ))}
            </div>
          ))}

          <AddExpectedForm
            cyberRangeId={cyberRangeId}
            scripts={scriptsData?.scripts ?? []}
            nodes={topologyData?.nodes ?? []}
            onAdded={invalidate}
          />
        </section>
      )}
    </div>
  );
}

function ExpectedRow({
  row,
  techniqueName,
  occurrences,
  scripts,
  nodes,
  onChanged,
}: {
  row: ExpectedTtp;
  techniqueName: string;
  occurrences: Occurrence[];
  scripts: Script[];
  nodes: TopologyNode[];
  onChanged: () => void;
}) {
  const [points, setPoints] = useState(String(row.points));
  const [note, setNote] = useState(row.description ?? '');
  const [occurredAt, setOccurredAt] = useState('');

  const patch = useMutation({
    mutationFn: (changes: Record<string, unknown>) =>
      apiFetch(`/admin/expected-ttps/${row.id}`, { method: 'PATCH', body: JSON.stringify(changes) }),
    onSuccess: onChanged,
    onError: () => {
      setPoints(String(row.points));
      setNote(row.description ?? '');
    },
  });
  const remove = useMutation({
    mutationFn: (voidDetections: boolean) =>
      apiFetch(`/admin/expected-ttps/${row.id}${voidDetections ? '?voidDetections=true' : ''}`, { method: 'DELETE' }),
    onSuccess: onChanged,
    onError: (err) => {
      // 409 = teams were already credited; removing must explicitly void their points.
      if (err instanceof ApiError && err.status === 409) {
        void confirmAction({
          title: `Remove ${row.techniqueId} and void its credits?`,
          message: err.message,
          confirmLabel: 'Remove and void',
          danger: true,
        }).then((ok) => ok && remove.mutate(true));
      }
    },
  });
  const markOccurred = useMutation({
    mutationFn: () =>
      apiFetch(`/admin/expected-ttps/${row.id}/occurrences`, {
        method: 'POST',
        body: JSON.stringify(occurredAt ? { occurredAt: new Date(occurredAt).toISOString() } : {}),
      }),
    onSuccess: () => {
      setOccurredAt('');
      onChanged();
    },
  });
  const deleteOccurrence = useMutation({
    mutationFn: (id: number) => apiFetch(`/admin/ttp-occurrences/${id}`, { method: 'DELETE' }),
    onSuccess: onChanged,
  });

  function savePoints() {
    const n = Number(points);
    if (!Number.isInteger(n) || n < 1 || n > 1000) {
      setPoints(String(row.points));
      return;
    }
    if (n !== row.points) patch.mutate({ points: n });
  }

  // patch/remove handle their own errors (inline, below); markOccurred/deleteOccurrence fall through
  // to the global mutation toast. remove's 409 is the confirm-and-void prompt, not an error to show.
  const errorMessage = [patch.error, remove.error].find(
    (e) => e instanceof ApiError && !(e === remove.error && e.status === 409),
  ) as ApiError | undefined;

  return (
    <div
      style={{
        border: '1px solid var(--surface-border)',
        borderRadius: 'var(--radius-control)',
        padding: 'var(--space-sm) var(--space-md)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-sm)',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)', alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--signal-secondary)' }}>{row.techniqueId}</span>
        <span style={{ color: 'var(--text-primary)', flex: '1 1 12rem', minWidth: 0 }}>{techniqueName}</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)' }}>
          Points
          <input
            aria-label={`Points for ${row.techniqueId}`}
            type="number"
            min={1}
            max={1000}
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            onBlur={savePoints}
            className="tabular"
            style={{ ...fieldStyle, width: 80, padding: 6 }}
          />
        </label>
        <Button
          type="button"
          variant="ghost"
          style={{ fontSize: 13, padding: '4px 10px' }}
          disabled={remove.isPending}
          onClick={async () => {
            const ok = await confirmAction({
              title: `Remove ${row.techniqueId} from this scenario?`,
              message: 'Students tagging it will no longer earn points for it.',
              confirmLabel: 'Remove',
              danger: true,
            });
            if (ok) remove.mutate(false);
          }}
        >
          Remove
        </Button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
        <ScriptPicker
          scripts={scripts}
          value={row.triggerScriptId}
          onChange={(id) => patch.mutate({ triggerScriptId: id })}
          noneLabel="No trigger script (MTTD via Mark occurred only)"
          style={{ flex: '1 1 12rem' }}
        />
        <select
          aria-label="Expected host"
          title="Optional: the machine where this technique happens. Limits which trigger-script runs count as an occurrence."
          value={row.topologyNodeId ?? ''}
          onChange={(e) => patch.mutate({ topologyNodeId: e.target.value ? Number(e.target.value) : null })}
          style={{ ...fieldStyle, flex: '1 1 10rem', fontSize: 13 }}
        >
          <option value="">{nodes.length ? 'No specific host' : 'No hosts yet — add them in Topology Admin'}</option>
          {nodes.map((n) => (
            <option key={n.id} value={n.id}>
              Host: {n.label}
            </option>
          ))}
        </select>
        <input
          aria-label="Instructor note"
          value={note}
          placeholder="Instructor note (never shown to students)"
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== (row.description ?? '') && patch.mutate({ description: note })}
          style={{ ...fieldStyle, flex: '2 1 14rem', fontSize: 13 }}
        />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)', alignItems: 'center', fontSize: 13 }}>
        <span style={monoLabel}>Occurred</span>
        {occurrences.length === 0 ? (
          <span style={{ color: 'var(--text-telemetry)' }}>not recorded this run — MTTD will be N/A</span>
        ) : (
          occurrences.map((o) => (
            <span
              key={o.id}
              style={{
                display: 'inline-flex',
                gap: 6,
                alignItems: 'center',
                border: '1px solid var(--surface-border)',
                borderRadius: 'var(--radius-control)',
                padding: '2px 6px',
                color: 'var(--text-muted)',
              }}
            >
              <span className="tabular" style={{ color: 'var(--text-primary)' }}>{formatEntryTime(o.occurredAt)}</span>
              {o.source === 'script_execution'
                ? `auto · ${o.scriptName ?? 'script'}${o.nodeLabel ? ` on ${o.nodeLabel}` : ''}`
                : `manual${o.recordedByName ? ` · ${o.recordedByName}` : ''}`}
              <button
                type="button"
                aria-label="Delete occurrence"
                onClick={async () => {
                  const ok = await confirmAction({
                    title: 'Delete this occurrence?',
                    message: 'MTTD values based on it will change.',
                    confirmLabel: 'Delete',
                    danger: true,
                  });
                  if (ok) deleteOccurrence.mutate(o.id);
                }}
                style={{ background: 'none', border: 'none', color: 'var(--text-telemetry)', cursor: 'pointer', padding: 0 }}
              >
                ×
              </button>
            </span>
          ))
        )}
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginLeft: 'auto', flexWrap: 'wrap' }}>
          <input
            type="datetime-local"
            step={1}
            aria-label="Occurred at (leave empty for now)"
            value={occurredAt}
            max={toLocalInputValue(new Date())}
            onChange={(e) => setOccurredAt(e.target.value)}
            style={{ ...fieldStyle, padding: 5, fontSize: 13 }}
          />
          <Button
            type="button"
            variant="ghost"
            style={{ fontSize: 13, padding: '4px 10px' }}
            disabled={markOccurred.isPending}
            onClick={() => markOccurred.mutate()}
          >
            {occurredAt ? 'Mark occurred at' : 'Mark occurred now'}
          </Button>
        </span>
      </div>

      {errorMessage && (
        <div role="alert" style={{ color: 'var(--signal-alert)', fontSize: 13 }}>
          {errorMessage.message}
        </div>
      )}
    </div>
  );
}

function AddExpectedForm({
  cyberRangeId,
  scripts,
  nodes,
  onAdded,
}: {
  cyberRangeId: number;
  scripts: Script[];
  nodes: TopologyNode[];
  onAdded: () => void;
}) {
  const { data: catalog } = useMitreCatalog();
  const [technique, setTechnique] = useState<string[]>([]);
  const [tacticId, setTacticId] = useState('');
  const [points, setPoints] = useState('10');
  const [triggerScriptId, setTriggerScriptId] = useState<number | ''>('');
  const [topologyNodeId, setTopologyNodeId] = useState<number | ''>('');
  const [note, setNote] = useState('');

  const selected = technique[0] ? catalog?.techniqueById.get(technique[0]) : undefined;
  const tacticOptions = selected?.tacticIds ?? [];

  const add = useMutation({
    mutationFn: () =>
      apiFetch(`/admin/cyber-ranges/${cyberRangeId}/expected-ttps`, {
        method: 'POST',
        body: JSON.stringify({
          techniqueId: technique[0],
          tacticId: tacticId || tacticOptions[0],
          points: Number(points),
          description: note.trim() || null,
          triggerScriptId: triggerScriptId === '' ? null : triggerScriptId,
          topologyNodeId: topologyNodeId === '' ? null : topologyNodeId,
        }),
      }),
    onSuccess: () => {
      setTechnique([]);
      setTacticId('');
      setPoints('10');
      setTriggerScriptId('');
      setTopologyNodeId('');
      setNote('');
      onAdded();
    },
  });

  const pointsValid = Number.isInteger(Number(points)) && Number(points) >= 1 && Number(points) <= 1000;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!technique[0] || !pointsValid) return;
    add.mutate();
  }

  return (
    <form
      onSubmit={submit}
      style={{
        borderTop: '1px solid var(--surface-border)',
        paddingTop: 'var(--space-md)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-sm)',
      }}
    >
      <div style={monoLabel}>Add expected technique</div>
      <TechniquePicker
        value={technique}
        onChange={(ids) => {
          setTechnique(ids);
          setTacticId('');
        }}
        max={1}
        label="Expected technique"
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)', alignItems: 'center' }}>
        {tacticOptions.length > 1 && (
          <select aria-label="Tactic" value={tacticId || tacticOptions[0]} onChange={(e) => setTacticId(e.target.value)} style={{ ...fieldStyle, fontSize: 13 }}>
            {tacticOptions.map((id) => (
              <option key={id} value={id}>
                Tactic: {catalog?.tacticById.get(id)?.name ?? id}
              </option>
            ))}
          </select>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)' }}>
          Points
          <input
            aria-label="Points"
            type="number"
            min={1}
            max={1000}
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            className="tabular"
            style={{ ...fieldStyle, width: 80, padding: 6 }}
          />
        </label>
        <ScriptPicker
          scripts={scripts}
          value={triggerScriptId === '' ? null : triggerScriptId}
          onChange={(id) => setTriggerScriptId(id ?? '')}
          noneLabel="No trigger script"
          style={{ flex: '1 1 12rem' }}
        />
        <select
          aria-label="Expected host"
          title="Optional: the machine where this technique happens. Limits which trigger-script runs count as an occurrence."
          value={topologyNodeId}
          onChange={(e) => setTopologyNodeId(e.target.value ? Number(e.target.value) : '')}
          style={{ ...fieldStyle, flex: '1 1 10rem', fontSize: 13 }}
        >
          <option value="">{nodes.length ? 'No specific host' : 'No hosts yet — add them in Topology Admin'}</option>
          {nodes.map((n) => (
            <option key={n.id} value={n.id}>
              Host: {n.label}
            </option>
          ))}
        </select>
      </div>
      <input
        aria-label="Instructor note"
        value={note}
        maxLength={500}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Instructor note, e.g. “AI agent runs net user on DC01” (never shown to students)"
        style={{ ...fieldStyle, fontSize: 13 }}
      />
      {add.isError && (
        <div role="alert" style={{ color: 'var(--signal-alert)', fontSize: 13 }}>
          {add.error instanceof ApiError ? add.error.message : 'Could not add the technique.'}
        </div>
      )}
      <div>
        <Button type="submit" disabled={!technique[0] || !pointsValid || add.isPending}>
          {add.isPending ? 'Adding…' : 'Add technique'}
        </Button>
      </div>
    </form>
  );
}
