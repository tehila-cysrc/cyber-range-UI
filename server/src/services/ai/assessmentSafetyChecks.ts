// Deterministic safety and consistency checks on an agent reply (Phase 8 calibration, 2026-10-18).
//
// Like assessmentValidation.ts these never change a judgement, a score or a text — they only raise flags
// and warnings for the instructor:
//   - instruction-like text in the team's records (defence in depth next to Prompt Shields and the agent's
//     own rule; the agent's "instructions were ignored" warnings are cross-checked against it);
//   - reference terms in student-safe text: words the agent itself used in reference-derived fields
//     (stage names, corrections, instructor notes) that the team never wrote anywhere;
//   - the anchored identification rule of the proposed rubric (contract 3).
import type { EvidenceIndex } from './assessmentSnapshot.service.js';

export interface RecordRef {
  type: 'timeline_entry' | 'canvas_node' | 'canvas_edge';
  id: number;
}

// ---------------------------------------------------------------------------------------------
// Instruction-like text. High precision on purpose: text must address the assessor (ignore your rules,
// "you are now", score demands, requests for the answer key). Ordinary investigation language such as
// "the macro told Word to ignore security warnings" does not match. Quoted attack payloads (an AI-day
// scenario documenting a prompt injection) DO match; the resulting notice says so.

const INSTRUCTION_PATTERNS: RegExp[] = [
  // "the"/"all" are not enough: "override the script rules" is ordinary investigation language.
  /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|your|system)\b[^.\n]{0,20}\b(instructions?|rules?|prompts?|guidelines?|directions?)\b/i,
  /\b(you are now|from now on,? you)\b/i,
  /\byou\b[^.\n]{0,30}\b(admin|developer|jailbreak|god) mode\b/i,
  /\b(give|award|grant|assign)\b[^.\n]{0,30}\b(us|this team|our team|the team|me)\b[^.\n]{0,30}(\b100\b|\bfull (marks|points|score)\b|\bmaximum\b|\bmax (points|score)\b|\bperfect score\b|\b\d{2,3}\s*\/\s*100\b)/i,
  /\bmark (everything|all|every \w+|each \w+) (as )?correct\b/i,
  /\b(print|show|reveal|output|repeat|list|tell us|give us)\b[^.\n]{0,40}\b(answer key|system prompt|your instructions|hidden (answers?|instructions?)|reference document|ground truth)\b/i,
  /\b(note|message|instructions?) (to|for) the (ai|assistant|grader|assessor|model|evaluator)\b/i,
];

export function isInstructionLike(text: string): boolean {
  return INSTRUCTION_PATTERNS.some((re) => re.test(text));
}

export function findInstructionLikeRecords(idx: EvidenceIndex): RecordRef[] {
  const out: RecordRef[] = [];
  for (const type of ['timeline_entry', 'canvas_node', 'canvas_edge'] as const) {
    for (const [id, text] of idx[type]) if (isInstructionLike(text)) out.push({ type, id });
  }
  return out;
}

// Does an agent warning claim that instructions / an injection were found and ignored?
const INSTRUCTION_WARNING_RE = /\b(instruction|injection|jailbreak|prompt[- ]?(attack|injection)|manipulat)/i;
export function warnsAboutInstructions(warnings: string[]): boolean {
  return warnings.some((w) => INSTRUCTION_WARNING_RE.test(w));
}

// ---------------------------------------------------------------------------------------------
// Reference terms in student-safe text.
//
// Source terms come from the reply's reference-derived, instructor-only fields; a term is "established"
// when the team's own records contain it (or its stem). Generic investigation vocabulary is ignored, so
// a flag means a specific word (a technique, host, file, account, "phishing", "credential") that only
// the reference knows. A flag is a prompt to read carefully, never an automatic block.

const GENERIC_TERMS = new Set(
  (
    'about above across after again against also another around because been before being below between both ' +
    'cannot could does doing down during each even every from further have having here into just like made make ' +
    'many more most much must near need next only other over same should since some such than that their them ' +
    'then there these they this those through under until upon very want were what when where which while whom ' +
    'whose will with within without would your yours already always maybe perhaps possibly possible likely might ' +
    'probably whether still really able clear clearly well good great nice better best main major minor important ' +
    'key help helps keep look looks show shows showed shown make makes part parts thing things something anything ' +
    'attack attacks attacked attacker attackers activity activities access accessed account accounts action actions ' +
    'admin administrator alert alerts analysis analyse analyze behavior behaviour cause caused causes chain check ' +
    'checked command commands compromise compromised confirm confirmed connect connected connection connections ' +
    'data detail details detailed detect detected detection device devices document documented documenting ' +
    'documentation entry entries environment event events evidence explain explained final first found goal goals ' +
    'happen happened host hosts identify identified identifying impact incident incidents indicator indicators ' +
    'initial initially investigate investigated investigating investigation later link linked links machine ' +
    'machines malicious movement network networks note noted notes objective objectives origin path process ' +
    'processes record records recorded related relation review reviewed root sequence server servers source ' +
    'stage stages step steps story suspicious system systems team teams theft steal stealing stolen timeline ' +
    'time times tool tools unusual user users understand understanding understood finding findings observe ' +
    'observed observation activity attempt attempts started start began begin happened noticed notice spotted ' +
    'later earlier exercise scenario reference effort work good strong weak correct correctly partial partially ' +
    'missing missed miss unclear explicit explicitly specific specifically overall several student students ' +
    // common verbs, sequence and degree words (they describe any investigation, not a scenario)
    'follow follows followed following trace traced tracing track tracked tracking lead leads leading led move ' +
    'moved moving take taken taking find finding seem seems appear appears appeared continue continued consider ' +
    'suggest suggests suggested indicate indicates indicated focus focused focusing pivot pivoted point points ' +
    'pointed build building built establish established aware awareness attention approach progress progressing ' +
    'early earlier late later prior previous previously soon recent recently immediately directly quickly ' +
    'promptly crucial critical central core essential relevant significant possible potentially tentative ' +
    'tentatively strongly closely fully mostly partly broadly rather quite truly actual actually real really ' +
    'gap gaps area areas coverage context narrative chronology chronological order ' +
    'log logs logged logging login logins logon logons'
  ).split(/\s+/),
);

const SUFFIXES = ['ations', 'ation', 'ings', 'ing', 'ions', 'ion', 'ers', 'er', 'ed', 'es', 's'];
function stem(term: string): string {
  for (const suf of SUFFIXES) if (term.length - suf.length >= 4 && term.endsWith(suf)) return term.slice(0, -suf.length);
  return term;
}

const TOKEN_RE = /[A-Za-z0-9][A-Za-z0-9._\\-]*[A-Za-z0-9]/g;
function terms(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(TOKEN_RE)) {
    const t = m[0].toLowerCase();
    const ipLike = /^\d{1,3}(\.\d{1,3}){3}$/.test(t);
    if (!ipLike && !/[a-z]/.test(t)) continue; // bare numbers, times
    if (!ipLike && t.length < 4 && !/\d/.test(t)) continue; // short words; keep short ids such as "c2", "ws3"
    if (t.length < 3 && !ipLike) continue;
    if (GENERIC_TERMS.has(t) || GENERIC_TERMS.has(stem(t))) continue;
    out.add(t);
  }
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function findLeakedReferenceTerms(input: { referenceTexts: string[]; studentSafeTexts: (string | null | undefined)[]; teamCorpus: string }): string[] {
  const corpus = input.teamCorpus.toLowerCase();
  const candidates = new Set<string>();
  for (const text of input.referenceTexts) {
    for (const t of terms(text)) {
      if (corpus.includes(t) || corpus.includes(stem(t))) continue; // the team wrote it (or a form of it)
      candidates.add(t);
    }
  }
  const safe = input.studentSafeTexts.filter(Boolean).join('\n');
  const found: string[] = [];
  for (const t of candidates) {
    if (new RegExp(`(^|[^a-z0-9])${escapeRe(stem(t))}`, 'i').test(safe)) found.push(t);
  }
  return found.sort();
}

export function teamCorpusFromIndex(idx: EvidenceIndex): string {
  return [...idx.timeline_entry.values(), ...idx.canvas_node.values(), ...idx.canvas_edge.values()].join('\n');
}

// ---------------------------------------------------------------------------------------------
// Anchored identification (proposed rubric, docs/ai-assessment-phase8-calibration.md §3): the share of
// reference stages the team documented with evidence — correct = 1, partial or hypothesis = 0.5, anything
// else 0; stages judged insufficient_information are left out — times the criterion's maxPoints.

const STAGE_WEIGHT: Record<string, number> = { correct: 1, partial: 0.5, hypothesis: 0.5 };

export function anchoredIdentificationPoints(stages: { judgement: string }[], maxPoints: number): number | null {
  const assessable = stages.filter((s) => s.judgement !== 'insufficient_information');
  if (assessable.length === 0) return null;
  const share = assessable.reduce((sum, s) => sum + (STAGE_WEIGHT[s.judgement] ?? 0), 0) / assessable.length;
  return Math.round(maxPoints * share);
}

export function identificationTolerance(maxPoints: number): number {
  return Math.max(2, Math.round(maxPoints * 0.1));
}
