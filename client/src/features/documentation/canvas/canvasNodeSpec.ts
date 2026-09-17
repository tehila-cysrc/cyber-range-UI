// Single source of truth for the Canvas's node palette — chip list, colors/shapes, legend, and
// nodeTypes lookup all read from this one place. Deliberately distinct from Topology's `role`
// vocabulary (domain_controller/siem/firewall/...): those name literal infrastructure, these name
// steps in an investigative narrative — conflating the two would make Canvas read as a second,
// broken Topology view.
export type CanvasNodeTypeKey = 'entry' | 'system' | 'evidence' | 'finding' | 'decision' | 'action' | 'impact';
export type CanvasNodeShape = 'circle' | 'diamond' | 'rect';

export interface CanvasNodeSpec {
  type: CanvasNodeTypeKey;
  label: string;
  shape: CanvasNodeShape;
  colorVar: string;
  description: string;
  filled?: boolean;
}

export const CANVAS_NODE_SPECS: CanvasNodeSpec[] = [
  {
    type: 'entry',
    label: 'Entry Point',
    shape: 'circle',
    colorVar: 'var(--signal-primary)',
    description: 'The starting fact or trigger — an alert fired, a ticket opened, a user report received.',
  },
  {
    type: 'system',
    label: 'System / Asset',
    shape: 'rect',
    colorVar: 'var(--signal-secondary)',
    description: 'A machine, account, or service implicated in the story.',
  },
  {
    type: 'evidence',
    label: 'Evidence',
    shape: 'rect',
    colorVar: 'var(--role-pink)',
    description: 'A concrete artifact collected — a log line, a registry key, a PCAP excerpt.',
  },
  {
    type: 'finding',
    label: 'Finding',
    shape: 'circle',
    filled: true,
    colorVar: 'var(--signal-alert)',
    description: 'A conclusion promoted to significance — echoes Timeline’s important-finding flag.',
  },
  {
    type: 'decision',
    label: 'Decision',
    shape: 'diamond',
    colorVar: 'var(--signal-tertiary)',
    description: 'A branch point in the reasoning — "is this malicious? escalate or contain?"',
  },
  {
    type: 'action',
    label: 'Action',
    shape: 'rect',
    colorVar: 'var(--role-orange)',
    description: 'A response step taken or recommended — isolate host, reset credential, notify.',
  },
  {
    type: 'impact',
    label: 'Impact / Outcome',
    shape: 'circle',
    colorVar: 'var(--role-violet)',
    description: 'The closing state — what was actually affected, or the resolution reached.',
  },
];

export const CANVAS_NODE_SPEC_BY_TYPE = Object.fromEntries(
  CANVAS_NODE_SPECS.map((spec) => [spec.type, spec]),
) as Record<CanvasNodeTypeKey, CanvasNodeSpec>;

export const CANVAS_DEFAULT_LABEL: Record<CanvasNodeTypeKey, string> = {
  entry: 'New entry point',
  system: 'New system/asset',
  evidence: 'New evidence',
  finding: 'New finding',
  decision: 'New decision',
  action: 'New action',
  impact: 'New impact/outcome',
};
