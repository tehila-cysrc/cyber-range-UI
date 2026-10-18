import { useState } from 'react';
import { API_ORIGIN } from '../../lib/apiClient';
import { useAuthStore } from '../../stores/authStore';
import { useToastStore } from '../../stores/toastStore';
import { useCan } from '../../lib/permissions';
import { Button } from '../../components/Button';

// Instructor-only results download (UX audit UX-05): Reset wipes every timeline, score and debrief,
// and there was no way to keep them. Fetched with the bearer token, then saved as a file.
// With teamId only that team is exported (Event Summary page); without it, the whole event (Reset page).
// Admins (event.export) use the global export; instructors use the scoped one, which the server limits
// to their assigned (organization, scenario) pairs.
async function download(format: 'json' | 'xlsx', teamId: number | undefined, scoped: boolean) {
  const token = useAuthStore.getState().token;
  const params = new URLSearchParams();
  if (format === 'xlsx') params.set('format', 'xlsx');
  if (teamId != null) params.set('teamId', String(teamId));
  const qs = params.toString();
  const res = await fetch(`${API_ORIGIN}/api/admin/${scoped ? 'results' : 'event'}/export${qs ? `?${qs}` : ''}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  const blob = await res.blob();
  const match = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = match?.[1] ?? `cyber-range-results.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function ExportResultsButtons({ teamId }: { teamId?: number } = {}) {
  const [busy, setBusy] = useState<'json' | 'xlsx' | null>(null);
  const push = useToastStore((s) => s.push);
  const scoped = !useCan('event.export');

  async function run(format: 'json' | 'xlsx') {
    setBusy(format);
    try {
      await download(format, teamId, scoped);
    } catch (err) {
      push(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
      <Button
        variant="ghost"
        disabled={busy !== null}
        onClick={() => run('xlsx')}
        title="Excel workbook: summary plus every timeline entry (with screenshots), score, student, canvas item, help request and ATT&CK credit"
      >
        {busy === 'xlsx' ? 'Preparing…' : teamId != null ? 'Download team results (Excel)' : 'Download full results (Excel)'}
      </Button>
      <Button variant="ghost" disabled={busy !== null} onClick={() => run('json')} title="Full archive for re-import or tooling: the same data as JSON, screenshots included">
        {busy === 'json' ? 'Preparing…' : teamId != null ? 'Download team archive (JSON)' : 'Download full archive (JSON)'}
      </Button>
    </div>
  );
}
