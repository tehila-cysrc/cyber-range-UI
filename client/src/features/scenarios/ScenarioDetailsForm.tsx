import { useEffect, useState, type CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { Button } from '../../components/Button';
import { useToastStore } from '../../stores/toastStore';

interface Day {
  id: number;
  key: string;
  label: string;
}

interface ScenarioDetails {
  id: number;
  name: string;
  dayId: number;
  difficulty: 'intermediate' | 'advanced';
  expectedDurationMinutes: number | null;
  studentBriefing: string | null;
}

const fieldStyle: CSSProperties = {
  background: 'var(--surface-1)',
  border: '1px solid var(--surface-border)',
  borderRadius: 'var(--radius-control)',
  padding: 8,
  color: 'var(--text-primary)',
  fontFamily: 'inherit',
  fontSize: 14,
  minWidth: 0,
};

const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: 'var(--text-muted)' };

// Create or edit a scenario's details, including the Student Briefing (UX-08): instructor-written
// mission context students read on their Home page. It is plain instructor text — nothing generated.
// A scenario can now be created here without registering an Azure environment (UX-37).
export function ScenarioDetailsForm({
  cyberRangeId,
  onSaved,
  onCancel,
}: {
  cyberRangeId: number | 'new';
  onSaved: (id: number) => void;
  onCancel?: () => void;
}) {
  const queryClient = useQueryClient();
  const push = useToastStore((s) => s.push);
  const isNew = cyberRangeId === 'new';

  const { data: daysData } = useQuery({ queryKey: ['days'], queryFn: () => apiFetch<{ days: Day[] }>('/admin/days') });
  const { data } = useQuery({
    queryKey: ['scenario-details', cyberRangeId],
    queryFn: () => apiFetch<{ cyberRange: ScenarioDetails }>(`/admin/cyber-ranges/${cyberRangeId}`),
    enabled: !isNew,
  });

  const [name, setName] = useState('');
  const [dayId, setDayId] = useState<number | ''>('');
  const [difficulty, setDifficulty] = useState<'intermediate' | 'advanced' | ''>('');
  const [duration, setDuration] = useState('');
  const [briefing, setBriefing] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = data?.cyberRange;
    if (isNew || !d) {
      setName('');
      setDayId('');
      setDifficulty('');
      setDuration('');
      setBriefing('');
      return;
    }
    setName(d.name);
    setDayId(d.dayId);
    setDifficulty(d.difficulty);
    setDuration(d.expectedDurationMinutes != null ? String(d.expectedDurationMinutes) : '');
    setBriefing(d.studentBriefing ?? '');
  }, [data, isNew]);

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        dayId,
        difficulty,
        expectedDurationMinutes: duration.trim() ? Number(duration) : null,
        studentBriefing: briefing,
      };
      if (isNew) {
        const res = await apiFetch<{ cyberRange: { id: number } }>('/admin/cyber-ranges', {
          method: 'POST',
          body: JSON.stringify({ ...body, expectedDurationMinutes: body.expectedDurationMinutes ?? undefined }),
        });
        return res.cyberRange.id;
      }
      await apiFetch(`/admin/cyber-ranges/${cyberRangeId}`, { method: 'PATCH', body: JSON.stringify(body) });
      return cyberRangeId as number;
    },
    onSuccess: (id) => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['cyber-ranges'] });
      queryClient.invalidateQueries({ queryKey: ['cyber-ranges-catalog'] });
      queryClient.invalidateQueries({ queryKey: ['scenario-details'] });
      push(isNew ? `Scenario "${name.trim()}" created.` : 'Scenario details saved.', 'success');
      onSaved(id);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not save the scenario'),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !dayId || !difficulty) {
      setError('Name, track and difficulty are required.');
      return;
    }
    if (duration.trim() && (!Number.isInteger(Number(duration)) || Number(duration) < 1)) {
      setError('Duration must be a whole number of minutes.');
      return;
    }
    save.mutate();
  }

  return (
    <form
      onSubmit={submit}
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--surface-border)',
        borderRadius: 'var(--radius-container)',
        padding: 'var(--space-lg)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-md)',
        marginBottom: 'var(--space-lg)',
      }}
    >
      <h2 style={{ margin: 0, fontSize: 15, color: 'var(--text-muted)' }}>{isNew ? 'New scenario' : 'Scenario details'}</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-md)' }}>
        <label style={{ ...labelStyle, gridColumn: 'span 2' }}>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Contoso Breach" maxLength={120} style={fieldStyle} />
        </label>
        <label style={labelStyle}>
          Track
          <select value={dayId} onChange={(e) => setDayId(e.target.value ? Number(e.target.value) : '')} style={fieldStyle}>
            <option value="">Select…</option>
            {daysData?.days.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label style={labelStyle}>
          Difficulty
          <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as 'intermediate' | 'advanced' | '')} style={fieldStyle}>
            <option value="">Select…</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </select>
        </label>
        <label style={labelStyle}>
          Time limit (minutes)
          <input value={duration} onChange={(e) => setDuration(e.target.value)} inputMode="numeric" placeholder="e.g. 90 (optional)" style={fieldStyle} />
        </label>
      </div>
      <label style={labelStyle}>
        Student briefing
        <span style={{ fontSize: 12, color: 'var(--text-telemetry)' }}>
          Shown to students on their Home page when this scenario starts: the mission, the scope, what to deliver. Don't include answers.
        </span>
        <textarea
          value={briefing}
          onChange={(e) => setBriefing(e.target.value)}
          rows={5}
          maxLength={4000}
          placeholder="e.g. Contoso's SOC saw unusual logins overnight. Investigate the corporate network, build a timeline of the attack and identify the techniques used."
          style={{ ...fieldStyle, resize: 'vertical' }}
        />
      </label>
      {!isNew && (
        <div style={{ fontSize: 12, color: 'var(--text-telemetry)' }}>
          A new time limit applies from the next time a team's scenario is started or restarted.
        </div>
      )}
      {error && <div style={{ color: 'var(--signal-alert)', fontSize: 14 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : isNew ? 'Create scenario' : 'Save details'}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
