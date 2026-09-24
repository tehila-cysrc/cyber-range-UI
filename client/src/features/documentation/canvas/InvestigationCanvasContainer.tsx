import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../../../lib/apiClient';
import { useSocketEvent } from '../../../hooks/useSocketEvent';
import { InvestigationCanvas, type CanvasEdgeDataDTO, type CanvasNodeDataDTO } from './InvestigationCanvas';
import { CANVAS_DEFAULT_LABEL, type CanvasNodeTypeKey } from './canvasNodeSpec';

interface CanvasResponse {
  nodes: CanvasNodeDataDTO[];
  edges: CanvasEdgeDataDTO[];
}

interface InvestigationCanvasContainerProps {
  cyberRangeId: number;
  /** The team currently being viewed (own team for a student, the picked team for an instructor) — used to filter realtime events. */
  teamId: number;
  /** Query param to send; null for a student (server resolves their own team implicitly). */
  teamIdParam: number | null;
  editable: boolean;
}

// Owns all data fetching/mutation/socket wiring for the Canvas, keeping InvestigationCanvas.tsx
// itself presentational — same split as TopologyAdminPage (owns queries) / TopologyGraph
// (presentational). Autosave-per-action with optimistic cache updates (no manual Save button),
// matching Timeline's and Topology's existing immediate-persist conventions.
export function InvestigationCanvasContainer({ cyberRangeId, teamId, teamIdParam, editable }: InvestigationCanvasContainerProps) {
  const queryClient = useQueryClient();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);

  const queryKey = ['investigation-canvas', cyberRangeId, teamIdParam];

  const { data } = useQuery({
    queryKey,
    queryFn: () =>
      apiFetch<CanvasResponse>(
        `/cyber-ranges/${cyberRangeId}/investigation-canvas${teamIdParam ? `?teamId=${teamIdParam}` : ''}`,
      ),
  });

  function showError(err: unknown, fallback: string) {
    setErrorMessage(err instanceof ApiError ? err.message : fallback);
    window.setTimeout(() => setErrorMessage(null), 3000);
  }

  function patchCache(mutator: (current: CanvasResponse) => CanvasResponse) {
    queryClient.setQueryData<CanvasResponse>(queryKey, (current) => (current ? mutator(current) : current));
  }

  const createNode = useMutation({
    mutationFn: (params: { nodeType: CanvasNodeTypeKey; label?: string; body?: string | null; posX: number; posY: number }) =>
      apiFetch<{ node: CanvasNodeDataDTO }>(`/cyber-ranges/${cyberRangeId}/investigation-canvas/nodes`, {
        method: 'POST',
        body: JSON.stringify({
          nodeType: params.nodeType,
          label: params.label ?? CANVAS_DEFAULT_LABEL[params.nodeType],
          body: params.body ?? undefined,
          posX: params.posX,
          posY: params.posY,
        }),
      }),
    onSuccess: ({ node }) => {
      patchCache((current) =>
        current.nodes.some((n) => n.id === node.id) ? current : { ...current, nodes: [...current.nodes, node] },
      );
      // Open the inspector on the shape this client just placed, so writing a note is the very
      // next thing you can do — never fires for a node a teammate created via realtime, since this
      // only runs on this mutation's own success, not the socket handler below.
      setSelectedNodeId(node.id);
    },
    onError: (err) => showError(err, 'Could not add that node'),
  });

  const moveNode = useMutation({
    mutationFn: ({ nodeId, posX, posY }: { nodeId: number; posX: number; posY: number }) =>
      apiFetch(`/cyber-ranges/${cyberRangeId}/investigation-canvas/nodes/${nodeId}`, {
        method: 'PATCH',
        body: JSON.stringify({ posX, posY }),
      }),
    onMutate: ({ nodeId, posX, posY }) => {
      const previous = queryClient.getQueryData<CanvasResponse>(queryKey);
      patchCache((current) => ({ ...current, nodes: current.nodes.map((n) => (n.id === nodeId ? { ...n, posX, posY } : n)) }));
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      showError(err, 'Could not save that move');
    },
  });

  const editLabel = useMutation({
    mutationFn: ({ nodeId, label }: { nodeId: number; label: string }) =>
      apiFetch(`/cyber-ranges/${cyberRangeId}/investigation-canvas/nodes/${nodeId}`, {
        method: 'PATCH',
        body: JSON.stringify({ label }),
      }),
    onMutate: ({ nodeId, label }) => {
      const previous = queryClient.getQueryData<CanvasResponse>(queryKey);
      patchCache((current) => ({ ...current, nodes: current.nodes.map((n) => (n.id === nodeId ? { ...n, label } : n)) }));
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      showError(err, 'Could not save that label');
    },
  });

  const editBody = useMutation({
    mutationFn: ({ nodeId, body }: { nodeId: number; body: string }) =>
      apiFetch(`/cyber-ranges/${cyberRangeId}/investigation-canvas/nodes/${nodeId}`, {
        method: 'PATCH',
        body: JSON.stringify({ body }),
      }),
    onMutate: ({ nodeId, body }) => {
      const previous = queryClient.getQueryData<CanvasResponse>(queryKey);
      patchCache((current) => ({ ...current, nodes: current.nodes.map((n) => (n.id === nodeId ? { ...n, body } : n)) }));
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      showError(err, 'Could not save that note');
    },
  });

  const deleteNode = useMutation({
    mutationFn: (nodeId: number) => apiFetch(`/cyber-ranges/${cyberRangeId}/investigation-canvas/nodes/${nodeId}`, { method: 'DELETE' }),
    onMutate: (nodeId) => {
      const previous = queryClient.getQueryData<CanvasResponse>(queryKey);
      patchCache((current) => ({
        nodes: current.nodes.filter((n) => n.id !== nodeId),
        edges: current.edges.filter((e) => e.fromNodeId !== nodeId && e.toNodeId !== nodeId),
      }));
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      showError(err, 'Could not delete that node');
    },
  });

  const createEdge = useMutation({
    mutationFn: (params: { fromNodeId: number; toNodeId: number }) =>
      apiFetch<{ edge: CanvasEdgeDataDTO }>(`/cyber-ranges/${cyberRangeId}/investigation-canvas/edges`, {
        method: 'POST',
        body: JSON.stringify(params),
      }),
    onSuccess: ({ edge }) => {
      patchCache((current) =>
        current.edges.some((e) => e.id === edge.id) ? current : { ...current, edges: [...current.edges, edge] },
      );
    },
    onError: (err) =>
      showError(err, err instanceof ApiError && err.status === 409 ? 'These nodes are already connected' : 'Could not connect those nodes'),
  });

  const deleteEdge = useMutation({
    mutationFn: (edgeId: number) => apiFetch(`/cyber-ranges/${cyberRangeId}/investigation-canvas/edges/${edgeId}`, { method: 'DELETE' }),
    onMutate: (edgeId) => {
      const previous = queryClient.getQueryData<CanvasResponse>(queryKey);
      patchCache((current) => ({ ...current, edges: current.edges.filter((e) => e.id !== edgeId) }));
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      showError(err, 'Could not delete that connection');
    },
  });

  // Realtime: merge teammates' canvas edits without a refetch — same id-dedup + instructor
  // team-filter pattern as Timeline's documentation:new handler.
  useSocketEvent<{ node: CanvasNodeDataDTO; teamId: number }>('investigation_canvas:node_created', (payload) => {
    if (payload.teamId !== teamId) return;
    patchCache((current) =>
      current.nodes.some((n) => n.id === payload.node.id) ? current : { ...current, nodes: [...current.nodes, payload.node] },
    );
  });
  useSocketEvent<{ node: CanvasNodeDataDTO; teamId: number }>('investigation_canvas:node_updated', (payload) => {
    if (payload.teamId !== teamId) return;
    patchCache((current) => ({ ...current, nodes: current.nodes.map((n) => (n.id === payload.node.id ? payload.node : n)) }));
  });
  useSocketEvent<{ nodeId: number; teamId: number }>('investigation_canvas:node_deleted', (payload) => {
    if (payload.teamId !== teamId) return;
    patchCache((current) => ({
      nodes: current.nodes.filter((n) => n.id !== payload.nodeId),
      edges: current.edges.filter((e) => e.fromNodeId !== payload.nodeId && e.toNodeId !== payload.nodeId),
    }));
  });
  useSocketEvent<{ edge: CanvasEdgeDataDTO; teamId: number }>('investigation_canvas:edge_created', (payload) => {
    if (payload.teamId !== teamId) return;
    patchCache((current) =>
      current.edges.some((e) => e.id === payload.edge.id) ? current : { ...current, edges: [...current.edges, payload.edge] },
    );
  });
  useSocketEvent<{ edgeId: number; teamId: number }>('investigation_canvas:edge_deleted', (payload) => {
    if (payload.teamId !== teamId) return;
    patchCache((current) => ({ ...current, edges: current.edges.filter((e) => e.id !== payload.edgeId) }));
  });

  if (!data) {
    // Was `return null` — a blank area for a few seconds that looked broken.
    return (
      <div style={{ height: 560, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-container)' }}>
        Loading canvas…
      </div>
    );
  }

  // Self-healing: if the selected node was just deleted (by this client, a teammate, or a realtime
  // event), it simply stops being in `data.nodes` and the inspector disappears on its own — no
  // separate "clear selection on delete" bookkeeping needed anywhere else.
  const validSelectedNodeId = selectedNodeId != null && data.nodes.some((n) => n.id === selectedNodeId) ? selectedNodeId : null;

  return (
    <div style={{ position: 'relative', height: 560, border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-container)' }}>
      <InvestigationCanvas
        nodes={data.nodes}
        edges={data.edges}
        editable={editable}
        selectedNodeId={validSelectedNodeId}
        onSelectionChange={setSelectedNodeId}
        onNodeCreate={(type, x, y) => createNode.mutate({ nodeType: type, posX: x, posY: y })}
        onNodeDragStop={(nodeId, x, y) => moveNode.mutate({ nodeId, posX: x, posY: y })}
        onLabelChange={(nodeId, label) => editLabel.mutate({ nodeId, label })}
        onBodyChange={(nodeId, body) => editBody.mutate({ nodeId, body })}
        onNodeDelete={(nodeId) => deleteNode.mutate(nodeId)}
        onNodeDuplicate={(node) =>
          createNode.mutate({
            nodeType: node.nodeType,
            label: `${node.label} (copy)`,
            body: node.body,
            posX: node.posX + 24,
            posY: node.posY + 24,
          })
        }
        onConnect={(fromNodeId, toNodeId) => createEdge.mutate({ fromNodeId, toNodeId })}
        onEdgeDelete={(edgeId) => deleteEdge.mutate(edgeId)}
      />
      {errorMessage && (
        <div
          style={{
            position: 'absolute',
            bottom: 12,
            left: 12,
            background: 'var(--surface-1)',
            border: '1px solid var(--signal-alert)',
            color: 'var(--signal-alert)',
            borderRadius: 'var(--radius-control)',
            padding: '6px 10px',
            fontSize: 12,
            maxWidth: 260,
          }}
        >
          {errorMessage}
        </div>
      )}
    </div>
  );
}
