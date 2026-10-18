// The response contract between Cyber Range and the Foundry assessment agent
// (docs/ai-investigation-assessment-plan.md §I.4). Structure only — no assessment logic.
//
// Phase 0 decided the shape: a per-request `text.format` is rejected for named agents, so ONE strict
// envelope schema is set on the agent definition in Foundry and covers both modes.
// Contract 2 (2026-10-18, live validation finding F1): { contractVersion, mode, result: Live | Final }.
// Contract 1 was { contractVersion, mode, live: Live | null, final: Final | null }; after a long `live`
// object gpt-4.1 sometimes emitted thousands of newlines instead of the trailing `,"final":null}` until
// the output cap. With `result` as the last property nothing has to follow the large object.
// `buildEnvelopeJsonSchema()` generates that schema from the zod definitions below
// (`npm run export-ai-schema -w server` writes docs/ai-agent/assessment-envelope.schema.json).
//
// Contract 3 (PROPOSED in Phase 8, 2026-10-18; for a future agent version, not applied in Foundry): two
// more judgements ("hypothesis" = a hedged idea the reference supports; "unsupported_claim" = asserted as
// fact with nothing in the records behind it) and `instructionLikeRecords` (records the agent ignored as
// instructions, so a "we ignored instructions" warning must point at real records). The app accepts both
// contracts; requests still carry CONTRACT_VERSION ("2", the pinned v6) until a contract-3 agent is approved.
//
// zod here is structural (types, enums, integers, nullability, no extra keys). Ranges, lengths, evidence
// ids and score arithmetic are deterministic checks in the validation layer (Phase 4), which truncates
// or flags instead of rejecting a whole assessment for one overlong string.
import { z } from 'zod/v4';

export const CONTRACT_VERSION = '2'; // sent in requests; = the contract of the pinned agent version (v6)
export const PROPOSED_CONTRACT_VERSION = '3';
export const ACCEPTED_CONTRACT_VERSIONS = ['2', '3'] as const;
export type ContractVersion = (typeof ACCEPTED_CONTRACT_VERSIONS)[number];

// Soft caps the validation layer applies (truncate + warning). Not part of the agent schema.
export const TEXT_LIMITS = {
  short: 300, // concept, topic, stage, labels, quotes are capped tighter in validation
  quote: 200,
  medium: 1000,
  long: 3000,
} as const;

const JUDGEMENTS_V2 = ['correct', 'partial', 'incorrect', 'not_documented', 'insufficient_information'] as const;
const JUDGEMENTS_V3 = ['correct', 'partial', 'hypothesis', 'unsupported_claim', 'incorrect', 'not_documented', 'insufficient_information'] as const;
export const Judgement = z.enum(JUDGEMENTS_V3);
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

export const Gap = z.strictObject({
  topic: z.string(),
  // Attack-stage progress is unknown to the platform, so "unknown" is a first-class answer.
  expectedByNow: z.enum(['yes', 'no', 'unknown']),
  whyItMatters: z.string(),
  evidence: z.array(Evidence),
});

function buildResultSchemas<J extends readonly [string, ...string[]], E extends z.core.$ZodLooseShape>(judgements: J, extra: E) {
  const judgement = z.enum(judgements);
  const judgedItem = z.strictObject({
    concept: z.string(),
    judgement,
    evidence: z.array(Evidence),
    interpretation: z.string(),
  });
  const live = z.strictObject({
    status: z.enum(['on_track', 'partially_on_track', 'needs_guidance', 'insufficient_evidence']),
    summary: z.string(),
    correctlyIdentified: z.array(judgedItem),
    partiallyUnderstood: z.array(judgedItem),
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
    ...extra,
    warnings: z.array(z.string()),
  });
  const final = z.strictObject({
    investigationSummary: z.string(),
    overallAssessment: z.strictObject({
      level: z.enum(['excellent', 'good', 'fair', 'limited', 'insufficient']),
      text: z.string(),
    }),
    stages: z.array(z.strictObject({ stage: z.string(), judgement, evidence: z.array(Evidence), interpretation: z.string() })),
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
    ...extra,
    warnings: z.array(z.string()),
  });
  const envelope = z.strictObject({
    contractVersion: z.string(),
    mode: z.enum(['live', 'final']),
    result: z.union([live, final]), // the variant must match `mode` (checked in parseEnvelope)
  });
  return { live, final, envelope };
}

const SCHEMAS = {
  '2': buildResultSchemas(JUDGEMENTS_V2, {}),
  // Contract 3: records that contained instruction-like text the agent ignored (empty when none).
  '3': buildResultSchemas(JUDGEMENTS_V3, { instructionLikeRecords: z.array(Evidence) }),
} as const;
export const LiveAssessment = SCHEMAS['3'].live;
export const FinalAssessment = SCHEMAS['3'].final;
export const AssessmentEnvelope = SCHEMAS['3'].envelope;

export type AssessmentMode = 'live' | 'final';
// Parsed results use the contract-3 shape; a contract-2 reply gets `instructionLikeRecords: []`.
export type LiveAssessmentT = z.infer<typeof LiveAssessment>;
export type FinalAssessmentT = z.infer<typeof FinalAssessment>;
export type EvidenceT = z.infer<typeof Evidence>;

export type EnvelopeParseResult =
  | { ok: true; mode: 'live'; contractVersion: ContractVersion; result: LiveAssessmentT }
  | { ok: true; mode: 'final'; contractVersion: ContractVersion; result: FinalAssessmentT }
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
  if (typeof version === 'string' && !(ACCEPTED_CONTRACT_VERSIONS as readonly string[]).includes(version)) {
    return { ok: false, errorCode: 'contract_mismatch', issues: [`contractVersion ${JSON.stringify(version)} is not one of ${ACCEPTED_CONTRACT_VERSIONS.join(', ')}`] };
  }
  const issuesOf = (e: z.ZodError) => e.issues.slice(0, 20).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
  // Envelope first (keys, mode), then the result against the REQUESTED mode's schema only, so a reply of
  // the other kind is rejected instead of silently matching the other union branch.
  const shell = z.strictObject({ contractVersion: z.string(), mode: z.enum(['live', 'final']), result: z.unknown() }).safeParse(raw);
  if (!shell.success) return { ok: false, errorCode: 'invalid_response', issues: issuesOf(shell.error) };
  if (shell.data.mode !== expectedMode) return { ok: false, errorCode: 'invalid_response', issues: [`mode ${shell.data.mode} != requested ${expectedMode}`] };
  const contractVersion = shell.data.contractVersion as ContractVersion;
  const schemas = SCHEMAS[contractVersion];
  const fail = (e: z.ZodError) => ({ ok: false as const, errorCode: 'invalid_response' as const, issues: issuesOf(e).map((i) => `result.${i}`) });
  if (expectedMode === 'live') {
    const r = schemas.live.safeParse(shell.data.result);
    return r.success ? { ok: true, mode: 'live', contractVersion, result: { instructionLikeRecords: [], ...r.data } as LiveAssessmentT } : fail(r.error);
  }
  const r = schemas.final.safeParse(shell.data.result);
  return r.success ? { ok: true, mode: 'final', contractVersion, result: { instructionLikeRecords: [], ...r.data } as FinalAssessmentT } : fail(r.error);
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

// `version` "2" = the schema applied to agent v6 (docs/ai-agent/); "3" = the Phase 8 proposal
// (docs/ai-agent/proposed/), not applied in Foundry.
export function buildEnvelopeJsonSchema(version: ContractVersion = CONTRACT_VERSION): Record<string, unknown> {
  const generated = z.toJSONSchema(SCHEMAS[version].envelope, { target: 'draft-2020-12', unrepresentable: 'throw' });
  const schema = normalise(generated) as Record<string, unknown>;
  // Pin the contract version in the agent schema so the model can only echo the current one.
  const props = schema.properties as Record<string, Record<string, unknown>>;
  props.contractVersion = { type: 'string', enum: [version] };
  return schema;
}

// The object to paste into the agent definition's `text` field (or the portal's Text format → JSON schema).
export function buildAgentTextFormat(version: ContractVersion = CONTRACT_VERSION): { format: { type: 'json_schema'; name: string; strict: true; schema: Record<string, unknown> } } {
  return { format: { type: 'json_schema', name: 'assessment_envelope', strict: true, schema: buildEnvelopeJsonSchema(version) } };
}
