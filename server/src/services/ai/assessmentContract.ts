// The response contract between Cyber Range and the Foundry assessment agent
// (docs/ai-investigation-assessment-plan.md §I.4). Structure only — no assessment logic.
//
// Phase 0 decided the shape: a per-request `text.format` is rejected for named agents, so ONE strict
// envelope schema is set on the agent definition in Foundry and covers both modes:
//   { contractVersion, mode, live: Live | null, final: Final | null }
// `buildEnvelopeJsonSchema()` generates that schema from the zod definitions below
// (`npm run export-ai-schema -w server` writes docs/ai-agent/assessment-envelope.schema.json).
//
// zod here is structural (types, enums, integers, nullability, no extra keys). Ranges, lengths, evidence
// ids and score arithmetic are deterministic checks in the validation layer (Phase 4), which truncates
// or flags instead of rejecting a whole assessment for one overlong string.
import { z } from 'zod/v4';

export const CONTRACT_VERSION = '1';

// Soft caps the validation layer applies (truncate + warning). Not part of the agent schema.
export const TEXT_LIMITS = {
  short: 300, // concept, topic, stage, labels, quotes are capped tighter in validation
  quote: 200,
  medium: 1000,
  long: 3000,
} as const;

export const Judgement = z.enum(['correct', 'partial', 'incorrect', 'not_documented', 'insufficient_information']);
export const EvidenceType = z.enum(['timeline_entry', 'canvas_node', 'canvas_edge']);
export const FeedbackVerdict = z.enum(['on_track', 'off_track', 'comment']); // = documentation_feedback.verdict
export const RubricKey = z.enum(['identification', 'understanding', 'connections', 'clarity']);

export const Evidence = z.strictObject({
  type: EvidenceType,
  id: z.int(),
  quote: z.string().nullable(), // verbatim student text, or null
});

export const Confidence = z.strictObject({
  level: z.enum(['low', 'medium', 'high']),
  reason: z.string(),
});

export const JudgedItem = z.strictObject({
  concept: z.string(),
  judgement: Judgement,
  evidence: z.array(Evidence),
  interpretation: z.string(),
});

export const Gap = z.strictObject({
  topic: z.string(),
  // Attack-stage progress is unknown to the platform, so "unknown" is a first-class answer.
  expectedByNow: z.enum(['yes', 'no', 'unknown']),
  whyItMatters: z.string(),
  evidence: z.array(Evidence),
});

export const LiveAssessment = z.strictObject({
  status: z.enum(['on_track', 'partially_on_track', 'needs_guidance', 'insufficient_evidence']),
  summary: z.string(),
  correctlyIdentified: z.array(JudgedItem),
  partiallyUnderstood: z.array(JudgedItem),
  missingOrUnclear: z.array(Gap),
  direction: z.strictObject({
    assessment: z.enum(['right_direction', 'mixed', 'wrong_direction', 'too_early']),
    explanation: z.string(),
  }),
  instructorOnlyNotes: z.string(),
  studentSafeFeedback: z.strictObject({
    teamLevel: z.string().nullable(),
    entryFeedback: z.array(z.strictObject({ entryId: z.int(), verdict: FeedbackVerdict, text: z.string() })),
    guidingQuestion: z.string().nullable(),
  }),
  suggestedEntryScores: z.array(z.strictObject({ entryId: z.int(), points: z.int(), rationale: z.string() })),
  confidence: Confidence,
  warnings: z.array(z.string()),
});

export const FinalAssessment = z.strictObject({
  investigationSummary: z.string(),
  overallAssessment: z.strictObject({
    level: z.enum(['excellent', 'good', 'fair', 'limited', 'insufficient']),
    text: z.string(),
  }),
  stages: z.array(z.strictObject({ stage: z.string(), judgement: Judgement, evidence: z.array(Evidence), interpretation: z.string() })),
  incorrectConclusions: z.array(z.strictObject({ claim: z.string(), evidence: z.array(Evidence), correction: z.string() })),
  strengths: z.array(z.string()),
  areasForImprovement: z.array(z.string()),
  score: z.strictObject({
    criteria: z.array(z.strictObject({ key: RubricKey, maxPoints: z.int(), awardedPoints: z.int(), rationale: z.string() })),
    recommendedTotal: z.int(),
    maxTotal: z.int(),
    explanation: z.string(),
  }),
  suggestedFinalFeedback: z.strictObject({ instructorVersion: z.string(), studentSafeVersion: z.string() }),
  confidence: Confidence,
  warnings: z.array(z.string()),
});

export const AssessmentEnvelope = z.strictObject({
  contractVersion: z.string(),
  mode: z.enum(['live', 'final']),
  live: LiveAssessment.nullable(),
  final: FinalAssessment.nullable(),
});

export type AssessmentMode = 'live' | 'final';
export type LiveAssessmentT = z.infer<typeof LiveAssessment>;
export type FinalAssessmentT = z.infer<typeof FinalAssessment>;
export type EvidenceT = z.infer<typeof Evidence>;

export type EnvelopeParseResult =
  | { ok: true; mode: 'live'; result: LiveAssessmentT }
  | { ok: true; mode: 'final'; result: FinalAssessmentT }
  | { ok: false; errorCode: 'invalid_response' | 'contract_mismatch'; issues: string[] };

// Parses the agent's raw output text for the mode that was requested. Structural checks only.
export function parseEnvelope(outputText: string, expectedMode: AssessmentMode): EnvelopeParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(outputText);
  } catch {
    return { ok: false, errorCode: 'invalid_response', issues: ['output is not JSON'] };
  }
  // An agent edit that changed the contract version is reported distinctly from malformed output.
  const version = (raw as { contractVersion?: unknown } | null)?.contractVersion;
  if (typeof version === 'string' && version !== CONTRACT_VERSION) {
    return { ok: false, errorCode: 'contract_mismatch', issues: [`contractVersion ${JSON.stringify(version)} != ${CONTRACT_VERSION}`] };
  }
  const parsed = AssessmentEnvelope.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errorCode: 'invalid_response', issues: parsed.error.issues.slice(0, 20).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
  }
  const env = parsed.data;
  const issues: string[] = [];
  if (env.mode !== expectedMode) issues.push(`mode ${env.mode} != requested ${expectedMode}`);
  if (expectedMode === 'live' && (env.live === null || env.final !== null)) issues.push('live mode needs live set and final null');
  if (expectedMode === 'final' && (env.final === null || env.live !== null)) issues.push('final mode needs final set and live null');
  if (issues.length) return { ok: false, errorCode: 'invalid_response', issues };
  return expectedMode === 'live' ? { ok: true, mode: 'live', result: env.live! } : { ok: true, mode: 'final', result: env.final! };
}

// ---------------------------------------------------------------------------------------------
// JSON Schema for the agent's Text format (strict structured outputs). Strict mode requires every
// object to list ALL its properties as required and to forbid additional properties; optional values
// are expressed as nullable (anyOf with null). Keywords strict mode may not support are stripped.

const STRIP_KEYWORDS = new Set(['$schema', 'minLength', 'maxLength', 'pattern', 'format', 'minimum', 'maximum',
  'exclusiveMinimum', 'exclusiveMaximum', 'minItems', 'maxItems', 'default', 'id', '$id']);

function normalise(node: unknown, isPropertiesMap = false): unknown {
  if (Array.isArray(node)) return node.map((n) => normalise(n));
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    // Inside a `properties` map the keys are field names (a field may be called "id"), not keywords.
    if (!isPropertiesMap && STRIP_KEYWORDS.has(k)) continue;
    out[k] = normalise(v, !isPropertiesMap && k === 'properties');
  }
  if (!isPropertiesMap && out.type === 'object' && out.properties && typeof out.properties === 'object') {
    out.required = Object.keys(out.properties as object);
    out.additionalProperties = false;
  }
  return out;
}

export function buildEnvelopeJsonSchema(): Record<string, unknown> {
  const generated = z.toJSONSchema(AssessmentEnvelope, { target: 'draft-2020-12', unrepresentable: 'throw' });
  const schema = normalise(generated) as Record<string, unknown>;
  // Pin the contract version in the agent schema so the model can only echo the current one.
  const props = schema.properties as Record<string, Record<string, unknown>>;
  props.contractVersion = { type: 'string', enum: [CONTRACT_VERSION] };
  return schema;
}

// The object to paste into the agent definition's `text` field (or the portal's Text format → JSON schema).
export function buildAgentTextFormat(): { format: { type: 'json_schema'; name: string; strict: true; schema: Record<string, unknown> } } {
  return { format: { type: 'json_schema', name: 'assessment_envelope', strict: true, schema: buildEnvelopeJsonSchema() } };
}
