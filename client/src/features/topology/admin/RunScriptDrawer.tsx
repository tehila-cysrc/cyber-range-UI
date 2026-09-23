import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiFetch, ApiError } from '../../../lib/apiClient';
import { Button } from '../../../components/Button';
import { TypeBadge, SUGGESTED_CATEGORIES, type ScriptSummary } from '../../scripts/ScriptLibraryPage';

type ScriptType = 'powershell' | 'bash';

interface ScriptExecutionSummary {
  id: number;
  scriptId: number | null;
  scriptName: string | null;
  scriptType: ScriptType;
  actorUsername: string;
  status: 'running' | 'succeeded' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  outputExcerpt: string | null;
  errorText: string | null;
}

const fieldStyle: React.CSSProperties = {
  background: 'var(--surface-1)',
  border: '1px solid var(--surface-border)',
  borderRadius: 'var(--radius-control)',
  padding: 8,
  color: 'var(--text-primary)',
  fontFamily: 'inherit',
  fontSize: 13,
  width: '100%',
};

function requiredType(osType: 'Windows' | 'Linux' | null): ScriptType | null {
  if (osType === 'Windows') return 'powershell';
  if (osType === 'Linux') return 'bash';
  return null;
}

export function RunScriptDrawer({ nodeId, nodeLabel, osType, onClose }: { nodeId: number; nodeLabel: string; osType: 'Windows' | 'Linux' | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'library' | 'manual'>('library');
  const [category, setCategory] = useState('');
  const [selectedScriptId, setSelectedScriptId] = useState<number | null>(null);
  const [manualContent, setManualContent] = useState('');
  const [saveToLibrary, setSaveToLibrary] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveCategory, setSaveCategory] = useState('');
  const [runningExecutionId, setRunningExecutionId] = useState<number | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const required = requiredType(osType);

  const { data: scriptsData } = useQuery({
    queryKey: ['scripts', category],
    queryFn: () => apiFetch<{ scripts: ScriptSummary[] }>(`/admin/scripts?${new URLSearchParams(category ? { category } : {})}`),
  });
  const compatibleScripts = (scriptsData?.scripts ?? []).filter((s) => !required || s.scriptType === required);
  const hiddenCount = (scriptsData?.scripts.length ?? 0) - compatibleScripts.length;
  // Real categories present in the library, not the fixed SUGGESTED_CATEGORIES list — that list is
  // just free-text naming suggestions for new scripts and drifts from what's actually in the DB (e.g.
  // it never had the ai-agent-* categories, so scripts under them couldn't be filtered to here).
  const availableCategories = Array.from(new Set((scriptsData?.scripts ?? []).map((s) => s.category).filter((c): c is string => !!c))).sort();
  const selectedScript = compatibleScripts.find((s) => s.id === selectedScriptId) ?? null;

  const { data: historyData, refetch: refetchHistory } = useQuery({
    queryKey: ['script-executions', nodeId],
    queryFn: () => apiFetch<{ executions: ScriptExecutionSummary[] }>(`/admin/topology/nodes/${nodeId}/script-executions`),
  });

  const { data: executionData } = useQuery({
    queryKey: ['script-execution', runningExecutionId],
    queryFn: () => apiFetch<{ execution: ScriptExecutionSummary }>(`/admin/script-executions/${runningExecutionId}`),
    enabled: runningExecutionId != null,
    refetchInterval: (query) => (query.state.data?.execution.status === 'running' ? 2500 : false),
  });

  const current = executionData?.execution;
  if (current && current.status !== 'running' && runningExecutionId === current.id) {
    // Fire a one-time history refresh once the poll observes completion.
    void Promise.resolve().then(() => refetchHistory());
  }

  const runMutation = useMutation({
    mutationFn: async () => {
      setRunError(null);
      let scriptId = selectedScriptId ?? undefined;
      let content: string | undefined;
      let scriptType: ScriptType | undefined;

      if (mode === 'manual') {
        content = manualContent;
        scriptType = required ?? 'powershell';
        if (saveToLibrary) {
          const { script } = await apiFetch<{ script: ScriptSummary }>('/admin/scripts', {
            method: 'POST',
            body: JSON.stringify({ name: saveName, description: null, content, scriptType, category: saveCategory || null }),
          });
          scriptId = script.id;
          content = undefined;
          scriptType = undefined;
          queryClient.invalidateQueries({ queryKey: ['scripts'] });
        }
      }

      return apiFetch<{ executionId: number }>(`/admin/topology/nodes/${nodeId}/run-script`, {
        method: 'POST',
        body: JSON.stringify({ scriptId, content, scriptType }),
      });
    },
    onSuccess: ({ executionId }) => setRunningExecutionId(executionId),
    onError: (err) => setRunError(err instanceof ApiError ? err.message : 'Failed to start the script'),
  });

  const canRunLibrary = mode === 'library' && !!selectedScript;
  const canRunManual = mode === 'manual' && manualContent.trim() && (!saveToLibrary || saveName.trim());
  const canRun = (canRunLibrary || canRunManual) && !!required && runMutation.isPending === false && current?.status !== 'running';

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 50, display: 'flex', justifyContent: 'flex-end' }} onClick={onClose}>
      <div
        style={{ width: 480, maxWidth: '100%', height: '100%', background: 'var(--surface-1)', borderLeft: '1px solid var(--surface-border)', padding: 'var(--space-lg)', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h2 style={{ fontSize: 16, color: 'var(--text-primary)', margin: 0 }}>Run Script</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16 }}>
            ×
          </button>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-telemetry)', marginTop: 0 }}>
          Machine: <strong style={{ color: 'var(--text-primary)' }}>{nodeLabel}</strong>
          {osType && <> — {osType}</>}
        </p>

        {!required && (
          <div style={{ fontSize: 12, color: 'var(--signal-alert)', marginBottom: 10 }}>
            This VM's OS type is unknown — re-run discovery before running a script here.
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginBottom: 'var(--space-md)' }}>
          <Button variant={mode === 'library' ? 'primary' : 'ghost'} onClick={() => setMode('library')}>
            Select from Library
          </Button>
          <Button variant={mode === 'manual' ? 'primary' : 'ghost'} onClick={() => setMode('manual')}>
            Write Manually
          </Button>
        </div>

        {mode === 'library' && (
          <div>
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ ...fieldStyle, marginBottom: 8 }}>
              <option value="">All categories</option>
              {availableCategories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto', marginBottom: 8 }}>
              {compatibleScripts.length === 0 && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No compatible scripts in the library yet.</p>}
              {compatibleScripts.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelectedScriptId(s.id)}
                  style={{
                    textAlign: 'left',
                    background: selectedScriptId === s.id ? 'var(--surface-2)' : 'transparent',
                    border: '1px solid var(--surface-border)',
                    borderRadius: 'var(--radius-control)',
                    padding: 8,
                    cursor: 'pointer',
                    color: 'var(--text-primary)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{s.name}</span>
                    <TypeBadge type={s.scriptType} />
                  </div>
                  {s.description && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{s.description}</div>}
                </button>
              ))}
            </div>
            {hiddenCount > 0 && (
              <p style={{ fontSize: 11, color: 'var(--text-telemetry)' }}>
                {hiddenCount} script{hiddenCount === 1 ? '' : 's'} hidden — wrong OS for this machine.
              </p>
            )}
            <Link to="/admin/scripts" style={{ fontSize: 12, color: 'var(--signal-primary)' }}>
              Edit / Manage Library →
            </Link>
          </div>
        )}

        {mode === 'manual' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--text-telemetry)' }}>
              Script type: <TypeBadge type={required ?? 'powershell'} /> (fixed to this machine's OS)
            </div>
            <textarea
              value={manualContent}
              onChange={(e) => setManualContent(e.target.value)}
              placeholder="Paste or write your script…"
              rows={12}
              style={{ ...fieldStyle, fontFamily: 'var(--font-mono)', resize: 'vertical' }}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)' }}>
              <input type="checkbox" checked={saveToLibrary} onChange={(e) => setSaveToLibrary(e.target.checked)} />
              Save to Script Library
            </label>
            {saveToLibrary && (
              <>
                <input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="Name for the library" style={fieldStyle} />
                <input value={saveCategory} onChange={(e) => setSaveCategory(e.target.value)} placeholder="Category (optional)" list="run-script-categories" style={fieldStyle} />
                <datalist id="run-script-categories">
                  {SUGGESTED_CATEGORIES.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </>
            )}
          </div>
        )}

        <Button variant="primary" disabled={!canRun} onClick={() => runMutation.mutate()} style={{ width: '100%', marginTop: 'var(--space-md)' }}>
          Run
        </Button>
        {runError && <p style={{ fontSize: 12, color: 'var(--signal-alert)', marginTop: 6 }}>{runError}</p>}

        {current && (
          <div style={{ marginTop: 'var(--space-lg)', borderTop: '1px solid var(--surface-border)', paddingTop: 10 }}>
            <h3 style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 6px' }}>Current run</h3>
            <StatusRow execution={current} />
          </div>
        )}

        <div style={{ marginTop: 'var(--space-lg)', borderTop: '1px solid var(--surface-border)', paddingTop: 10 }}>
          <h3 style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 6px' }}>History</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(historyData?.executions ?? []).length === 0 && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No runs yet.</p>}
            {(historyData?.executions ?? []).map((e) => (
              <StatusRow key={e.id} execution={e} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusRow({ execution }: { execution: ScriptExecutionSummary }) {
  const color = execution.status === 'succeeded' ? 'var(--signal-primary)' : execution.status === 'failed' ? 'var(--signal-alert)' : 'var(--signal-tertiary)';
  const duration = execution.finishedAt ? `${Math.round((new Date(execution.finishedAt).getTime() - new Date(execution.startedAt).getTime()) / 1000)}s` : '…';
  return (
    <div style={{ fontSize: 12, border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-control)', padding: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>
          <span style={{ color, textTransform: 'uppercase', fontSize: 11, letterSpacing: '0.04em' }}>{execution.status}</span>{' '}
          <span style={{ color: 'var(--text-primary)' }}>{execution.scriptName ?? '(manual script)'}</span>
        </span>
        <span style={{ color: 'var(--text-telemetry)' }}>{duration}</span>
      </div>
      <div style={{ color: 'var(--text-telemetry)', marginTop: 2 }}>
        by {execution.actorUsername} · {new Date(execution.startedAt).toLocaleString()}
      </div>
      {execution.outputExcerpt && (
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, color: 'var(--text-muted)', marginTop: 6, maxHeight: 120, overflowY: 'auto' }}>{execution.outputExcerpt}</pre>
      )}
      {execution.errorText && <div style={{ color: 'var(--signal-alert)', marginTop: 6 }}>{execution.errorText}</div>}
    </div>
  );
}
