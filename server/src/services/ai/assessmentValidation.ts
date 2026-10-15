// Deterministic validation of the agent's reply (plan §E "assessmentValidation.ts", §I.4, Phase 4).
//
// NO assessment logic lives here — judgements, wording and scores are the agent's (Foundry-owned). This
// layer only checks what can be checked mechanically, and never "improves" an answer:
//   - retrieval happened (Phase 0: without File Search the agent judged from generic knowledge);
//   - the reply matches the agreed contract and the requested mode (assessmentContract.parseEnvelope);
//   - every evidence reference names a record that exists in THIS snapshot; quotes are verbatim;
//   - correct/partial claims left without any valid evidence are FLAGGED (never re-judged);
//   - final-score arithmetic: criteria = the rubric sent, points within 0..max, total = sum;
//   - student-safe text is scanned for answer-key technique ids the team has not found itself;
//   - over-long strings are truncated (with a warning) rather than failing a whole assessment.
// Failures carry a code; `retryable` tells the Phase 5 runner whether one retry is worthwhile.
import {
  TEXT_LIMITS,
  parseEnvelope,
  type AssessmentMode,
  type EvidenceT,
  type FinalAssessmentT,
  type LiveAssessmentT,
} from './assessmentContract.js';
import type { EvidenceIndex, LeakScanContext } from './assessmentSnapshot.service.js';

export interface RubricCriterion {
  key: string;
  maxPoints: number;
}

export interface ValidationInput {
  outputText: string;
  mode: AssessmentMode;
  fileSearchCalls: number;
  evidenceIndex: EvidenceIndex;
  rubric: RubricCriterion[] | null; // required for final mode
  leak: LeakScanContext;
}

export type ValidationErrorCode = 'ai_no_retrieval' | 'invalid_response' | 'contract_mismatch' | 'rubric_mismatch';

export interface ValidationFlags {
  droppedEvidence: number;
  droppedQuotes: number;
  unsupportedItems: number;
  droppedEntryFeedback: number;
  droppedEntryScores: number;
  truncatedFields: number;
  scoreAdjusted: boolean;
  leakSuspected: boolean;
  leakedTechniqueIds: string[];
}

// Validated results carry an `unsupported` flag on judged items: true = claimed correct/partial but no
// valid evidence survived. The UI shows it ("no verified evidence"); the judgement itself is untouched.
type Flagged<T> = T & { unsupported: boolean };
export type ValidatedLive = Omit<LiveAssessmentT, 'correctlyIdentified' | 'partiallyUnderstood'> & {
  correctlyIdentified: Flagged<LiveAssessmentT['correctlyIdentified'][number]>[];
  partiallyUnderstood: Flagged<LiveAssessmentT['partiallyUnderstood'][number]>[];
};
export type ValidatedFinal = Omit<FinalAssessmentT, 'stages'> & { stages: Flagged<FinalAssessmentT['stages'][number]>[] };

export type ValidationResult =
  | { ok: true; mode: 'live'; result: ValidatedLive; warnings: string[]; agentWarnings: string[]; flags: ValidationFlags }
  | { ok: true; mode: 'final'; result: ValidatedFinal; warnings: string[]; agentWarnings: string[]; flags: ValidationFlags }
  | { ok: false; errorCode: ValidationErrorCode; retryable: boolean; issues: string[] };

const MAX_WARNINGS = 50;
const SCORE_POINTS_MIN = 1; // suggested per-entry award (live) — positive, small, never automatic
const SCORE_POINTS_MAX = 100;
const FINAL_MAX_TOTAL = 100;

// Case/whitespace/quote-style-insensitive comparison for verbatim quotes.
export function normaliseForQuote(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const TECHNIQUE_ID_RE = /\bT\d{4}(?:\.\d{3})?\b/gi;

// Answer-key technique ids (or their parent techniques) mentioned in student-safe text that the team has
// not tagged itself. Mentioning a technique the team already found is fine.
export function findLeakedTechniqueIds(texts: (string | null | undefined)[], leak: LeakScanContext): string[] {
  const sensitive = new Set<string>();
  for (const id of leak.expectedTechniqueIds) {
    sensitive.add(id.toUpperCase());
    sensitive.add(id.toUpperCase().split('.')[0]); // a parent id points at the answer too
  }
  const tagged = new Set(leak.teamTaggedTechniqueIds.map((t) => t.toUpperCase()));
  const taggedParents = new Set([...tagged].map((t) => t.split('.')[0]));
  const found = new Set<string>();
  for (const text of texts) {
    for (const m of (text ?? '').matchAll(TECHNIQUE_ID_RE)) {
      const id = m[0].toUpperCase();
      if (sensitive.has(id) && !tagged.has(id) && !(id.length === 5 && taggedParents.has(id))) found.add(id);
    }
  }
  return [...found].sort();
}

export function validateAssessment(input: ValidationInput): ValidationResult {
  if (input.fileSearchCalls < 1) {
    return { ok: false, errorCode: 'ai_no_retrieval', retryable: true, issues: ['the agent did not search the scenario reference document'] };
  }
  const parsed = parseEnvelope(input.outputText, input.mode);
  if (!parsed.ok) {
    return { ok: false, errorCode: parsed.errorCode, retryable: parsed.errorCode === 'invalid_response', issues: parsed.issues };
  }

  const warnings: string[] = [];
  const warn = (w: string) => {
    if (warnings.length < MAX_WARNINGS) warnings.push(w);
  };
  const flags: ValidationFlags = {
    droppedEvidence: 0,
    droppedQuotes: 0,
    unsupportedItems: 0,
    droppedEntryFeedback: 0,
    droppedEntryScores: 0,
    truncatedFields: 0,
    scoreAdjusted: false,
    leakSuspected: false,
    leakedTechniqueIds: [],
  };
  const idx = input.evidenceIndex;

  const capText = (s: string, max: number, where: string): string => {
    if (s.length <= max) return s;
    flags.truncatedFields++;
    warn(`${where}: text truncated to ${max} characters`);
    return s.slice(0, max);
  };
  const capNullable = (s: string | null, max: number, where: string) => (s === null ? null : capText(s, max, where));

  const checkEvidence = (list: EvidenceT[], where: string): EvidenceT[] => {
    const out: EvidenceT[] = [];
    const seen = new Set<string>();
    for (const e of list) {
      const text = idx[e.type].get(e.id);
      if (text === undefined) {
        flags.droppedEvidence++;
        warn(`${where}: removed a reference to ${e.type} #${e.id}, which is not in this team's records`);
        continue;
      }
      const key = `${e.type}:${e.id}`;
      if (seen.has(key)) continue; // duplicate reference
      seen.add(key);
      let quote = e.quote;
      if (quote !== null) {
        quote = quote.slice(0, TEXT_LIMITS.quote);
        if (!quote.trim() || !normaliseForQuote(text).includes(normaliseForQuote(quote))) {
          flags.droppedQuotes++;
          warn(`${where}: removed a quote that does not appear verbatim in ${e.type} #${e.id}`);
          quote = null;
        }
      }
      out.push({ type: e.type, id: e.id, quote });
    }
    return out;
  };

  const flagSupport = <T extends { judgement: string; evidence: EvidenceT[] }>(item: T, where: string): Flagged<T> => {
    const evidence = checkEvidence(item.evidence, where);
    const unsupported = (item.judgement === 'correct' || item.judgement === 'partial') && evidence.length === 0;
    if (unsupported) {
      flags.unsupportedItems++;
      warn(`${where}: marked "${item.judgement}" but no valid evidence reference remains`);
    }
    return { ...item, evidence, unsupported };
  };

  const strings = (list: string[], where: string) => list.map((s, i) => capText(s, TEXT_LIMITS.medium, `${where}[${i}]`));

  if (parsed.mode === 'live') {
    const r = parsed.result;
    const entryIds = idx.timeline_entry;
    const entryFeedback = r.studentSafeFeedback.entryFeedback.filter((f) => {
      if (entryIds.has(f.entryId)) return true;
      flags.droppedEntryFeedback++;
      warn(`studentSafeFeedback: removed feedback for timeline entry #${f.entryId}, which is not in this team's records`);
      return false;
    });
    const suggestedEntryScores = r.suggestedEntryScores.filter((s) => {
      if (entryIds.has(s.entryId) && s.points >= SCORE_POINTS_MIN && s.points <= SCORE_POINTS_MAX) return true;
      flags.droppedEntryScores++;
      warn(`suggestedEntryScores: removed a suggestion for entry #${s.entryId} (${s.points} points) — unknown entry or outside ${SCORE_POINTS_MIN}..${SCORE_POINTS_MAX}`);
      return false;
    });
    const result: ValidatedLive = {
      ...r,
      summary: capText(r.summary, TEXT_LIMITS.long, 'summary'),
      correctlyIdentified: r.correctlyIdentified.map((it, i) => flagSupport({ ...it, concept: capText(it.concept, TEXT_LIMITS.short, `correctlyIdentified[${i}].concept`), interpretation: capText(it.interpretation, TEXT_LIMITS.medium, `correctlyIdentified[${i}].interpretation`) }, `correctlyIdentified[${i}]`)),
      partiallyUnderstood: r.partiallyUnderstood.map((it, i) => flagSupport({ ...it, concept: capText(it.concept, TEXT_LIMITS.short, `partiallyUnderstood[${i}].concept`), interpretation: capText(it.interpretation, TEXT_LIMITS.medium, `partiallyUnderstood[${i}].interpretation`) }, `partiallyUnderstood[${i}]`)),
      missingOrUnclear: r.missingOrUnclear.map((g, i) => ({ ...g, topic: capText(g.topic, TEXT_LIMITS.short, `missingOrUnclear[${i}].topic`), whyItMatters: capText(g.whyItMatters, TEXT_LIMITS.medium, `missingOrUnclear[${i}].whyItMatters`), evidence: checkEvidence(g.evidence, `missingOrUnclear[${i}]`) })),
      direction: { ...r.direction, explanation: capText(r.direction.explanation, TEXT_LIMITS.medium, 'direction.explanation') },
      instructorOnlyNotes: capText(r.instructorOnlyNotes, TEXT_LIMITS.long, 'instructorOnlyNotes'),
      studentSafeFeedback: {
        teamLevel: capNullable(r.studentSafeFeedback.teamLevel, TEXT_LIMITS.medium, 'studentSafeFeedback.teamLevel'),
        // 1000 = the existing documentation_feedback body limit, so "Post as feedback" always fits.
        entryFeedback: entryFeedback.map((f, i) => ({ ...f, text: capText(f.text, TEXT_LIMITS.medium, `studentSafeFeedback.entryFeedback[${i}].text`) })),
        guidingQuestion: capNullable(r.studentSafeFeedback.guidingQuestion, TEXT_LIMITS.short, 'studentSafeFeedback.guidingQuestion'),
      },
      suggestedEntryScores: suggestedEntryScores.map((s, i) => ({ ...s, rationale: capText(s.rationale, TEXT_LIMITS.medium, `suggestedEntryScores[${i}].rationale`) })),
      confidence: { ...r.confidence, reason: capText(r.confidence.reason, TEXT_LIMITS.medium, 'confidence.reason') },
      warnings: strings(r.warnings, 'warnings'),
    };
    const leaked = findLeakedTechniqueIds(
      [result.studentSafeFeedback.teamLevel, result.studentSafeFeedback.guidingQuestion, ...result.studentSafeFeedback.entryFeedback.map((f) => f.text)],
      input.leak,
    );
    if (leaked.length) {
      flags.leakSuspected = true;
      flags.leakedTechniqueIds = leaked;
      warn(`student-safe feedback mentions answer-key technique(s) the team has not found: ${leaked.join(', ')}`);
    }
    return { ok: true, mode: 'live', result, warnings, agentWarnings: result.warnings, flags };
  }

  // Final mode
  const r = parsed.result;
  const rubric = input.rubric;
  if (!rubric || rubric.length === 0) {
    return { ok: false, errorCode: 'rubric_mismatch', retryable: false, issues: ['no rubric was provided for a final assessment'] };
  }
  const rubricKeys = rubric.map((c) => c.key).sort();
  const gotKeys = r.score.criteria.map((c) => c.key).sort();
  if (rubricKeys.join(',') !== gotKeys.join(',')) {
    // The score can't be interpreted against a different rubric — retry once, then fail.
    return { ok: false, errorCode: 'rubric_mismatch', retryable: true, issues: [`criteria [${gotKeys.join(', ')}] do not match the rubric [${rubricKeys.join(', ')}]`] };
  }
  const maxByKey = new Map(rubric.map((c) => [c.key, c.maxPoints]));
  const criteria = rubric.map((rc) => {
    const c = r.score.criteria.find((x) => x.key === rc.key)!;
    let awarded = c.awardedPoints;
    if (c.maxPoints !== rc.maxPoints) {
      flags.scoreAdjusted = true;
      warn(`score: criterion ${rc.key} stated max ${c.maxPoints}; the rubric's ${rc.maxPoints} is used`);
    }
    if (awarded < 0 || awarded > rc.maxPoints) {
      flags.scoreAdjusted = true;
      const clamped = Math.min(rc.maxPoints, Math.max(0, awarded));
      warn(`score: criterion ${rc.key} awarded ${awarded}, outside 0..${rc.maxPoints}; clamped to ${clamped}`);
      awarded = clamped;
    }
    return { key: c.key, maxPoints: maxByKey.get(c.key)!, awardedPoints: awarded, rationale: capText(c.rationale, TEXT_LIMITS.medium, `score.criteria.${c.key}.rationale`) };
  });
  const sum = criteria.reduce((s, c) => s + c.awardedPoints, 0);
  if (r.score.recommendedTotal !== sum) {
    flags.scoreAdjusted = true;
    warn(`score: the agent's total ${r.score.recommendedTotal} differs from the sum of its criteria; ${sum} is used`);
  }
  if (r.score.maxTotal !== FINAL_MAX_TOTAL) {
    flags.scoreAdjusted = true;
    warn(`score: maxTotal ${r.score.maxTotal} replaced by ${FINAL_MAX_TOTAL}`);
  }
  const result: ValidatedFinal = {
    ...r,
    investigationSummary: capText(r.investigationSummary, TEXT_LIMITS.long, 'investigationSummary'),
    overallAssessment: { ...r.overallAssessment, text: capText(r.overallAssessment.text, TEXT_LIMITS.medium, 'overallAssessment.text') },
    stages: r.stages.map((s, i) => flagSupport({ ...s, stage: capText(s.stage, TEXT_LIMITS.short, `stages[${i}].stage`), interpretation: capText(s.interpretation, TEXT_LIMITS.medium, `stages[${i}].interpretation`) }, `stages[${i}]`)),
    incorrectConclusions: r.incorrectConclusions.map((c, i) => ({ ...c, claim: capText(c.claim, TEXT_LIMITS.medium, `incorrectConclusions[${i}].claim`), correction: capText(c.correction, TEXT_LIMITS.medium, `incorrectConclusions[${i}].correction`), evidence: checkEvidence(c.evidence, `incorrectConclusions[${i}]`) })),
    strengths: strings(r.strengths, 'strengths'),
    areasForImprovement: strings(r.areasForImprovement, 'areasForImprovement'),
    score: { criteria, recommendedTotal: sum, maxTotal: FINAL_MAX_TOTAL, explanation: capText(r.score.explanation, TEXT_LIMITS.medium, 'score.explanation') },
    suggestedFinalFeedback: {
      instructorVersion: capText(r.suggestedFinalFeedback.instructorVersion, TEXT_LIMITS.long, 'suggestedFinalFeedback.instructorVersion'),
      studentSafeVersion: capText(r.suggestedFinalFeedback.studentSafeVersion, TEXT_LIMITS.long, 'suggestedFinalFeedback.studentSafeVersion'),
    },
    confidence: { ...r.confidence, reason: capText(r.confidence.reason, TEXT_LIMITS.medium, 'confidence.reason') },
    warnings: strings(r.warnings, 'warnings'),
  };
  const leaked = findLeakedTechniqueIds([result.suggestedFinalFeedback.studentSafeVersion], input.leak);
  if (leaked.length) {
    flags.leakSuspected = true;
    flags.leakedTechniqueIds = leaked;
    warn(`student-safe feedback mentions answer-key technique(s) the team has not found: ${leaked.join(', ')}`);
  }
  return { ok: true, mode: 'final', result, warnings, agentWarnings: result.warnings, flags };
}
