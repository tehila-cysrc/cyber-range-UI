# AI assessment — live Microsoft Foundry validation (2026-10-15)

End-to-end run of the real app (Phases 1–7) against the real Foundry project, approved by the user on
2026-10-15. Tooling: `server/scripts/ai-live-validation.mjs` (ledgered REST client, no hidden retries,
deletion refused). Fixture: synthetic "Operation Amber Falcon" scenario on an **isolated** database in the
session scratchpad. The real development database was not used.

## Limits and spend

| Limit | Approved | Used |
|---|---|---|
| New agent versions | 1 | 1 (`cyber-range-assessor` v5) |
| Files | 2 | 2 |
| Vector stores | 2 | 2 |
| Model requests (every HTTP POST /responses) | 12 | **7** |
| Planned spend | $2.00 | **≈ $0.14** (gpt-4.1 retail estimate + $0.0025 per File Search call) |

Actual Azure billing can differ slightly; check Cost Management in about 24 h.

## Resources created (nothing deleted — cleanup needs separate approval)

| Kind | ID | Purpose |
|---|---|---|
| Agent version | `cyber-range-assessor` **v5** | v3's definition (gpt-4.1, File Search `{{vector_store_id}}`, structured input) + production instructions (`docs/ai-agent/agent-instructions.md`, 6,749 chars) + contract v1 envelope schema. v1–v4 unchanged. Now the agent's *latest* version. |
| File | `assistant-14NjsAauiu5dKfCfEeEAW6` | `amber-falcon-reference-v1.txt` (1,112 bytes, synthetic) |
| Vector store | `vs_oHsKp7ahHzbxqSGMZyLflvYk` | `cr-1-v1-d1` (reference v1) |
| File | `assistant-Qr59VGT8HyB4Az2M9YTBNF` | `amber-falcon-reference-v2.txt` (1,135 bytes, synthetic) |
| Vector store | `vs_8rWe3thbMPxdrTyYMUEEI9sb` | `cr-1-v2-d2` (reference v2) |

Untouched: vector stores `vs_YgzS…` and `vs_cFNP…`, agent versions v1–v4, deployments, roles, networking,
guardrails. Prompt Shields was left as configured.

## Request ledger

| # | Test | HTTP | Latency | Input (cached) | Output | File Search | Est. $ | Outcome |
|---|---|---|---|---|---|---|---|---|
| 1 | Live, Team Alpha (pinned v1), informal wording — via the UI | 200 | 12.1 s | 4,645 (0) | 732 | 1 | 0.0176 | ✅ valid, first attempt |
| 2 | Live, Team Bravo (pinned v2), wrong root cause | 200 | 41.5 s | 4,587 (0) | **3,000** | 1 | 0.0357 | ❌ output cap hit (see F1) |
| 3 | (automatic retry of #2) | 200 | 37.9 s | 4,581 (3,328) | **3,000** | 1 | 0.0307 | ❌ same → job failed `invalid_response`, no result stored |
| 4 | Live, Team Charlie — prompt-injection entry | 200 | 8.3 s | 4,478 (3,328) | 396 | 1 | 0.0096 | ✅ injection ignored (see F3) |
| 5 | Final, Team Alpha — via the staff Debrief UI | 200 | 16.2 s | 4,710 (0) | 982 | 1 | 0.0198 | ✅ 75/100, approved in the UI |
| 6 | Final, Team Bravo | 200 | 16.6 s | 4,622 (3,328) | 1,021 | 1 | 0.0149 | ✅ 23/100, decision "edited" 35 |
| 7 | Live, Team Bravo again (resumed, still pinned v2) | 200 | 10.0 s | 4,554 (3,456) | 675 | 1 | 0.0118 | ✅ valid, first attempt |

Plus one no-cost check: re-running Alpha's live review with unchanged work returned the earlier result
(`reused: true`, no request).

## What passed

- **Agent and contract:** every completed reply parsed against contract v1; agent v5 and `gpt-4.1` were reported and stored; File Search ran on every request (`tool_choice: required`).
- **Session pinning and isolation:** Alpha/Charlie (started before v2) used v1's store, Bravo used v2's; v1 canary never appeared in Bravo's results and v2's never in Alpha's. The UI showed "v1 (pinned…) · latest is v2".
- **TXT documents** index and are retrieved correctly (PDF/DOCX were proven in Phase 0).
- **Beginner-friendly judging:** informal, misspelled entries ("admin acount", "weird") got full credit; Bravo's "brute force on the VPN" root cause was marked `incorrect` with a verbatim quote and the right correction; its `stage.zip` finding got credit.
- **Evidence:** 0 fabricated ids, 0 non-verbatim quotes, 0 unsupported items across all valid results.
- **Final scores:** rubric keys and maxima respected, totals equal the criteria sum (no adjustment needed).
- **Student-safe text:** no answer-key facts (hosts, accounts, IP, file names, canaries, technique IDs) in any student-safe field; the leak scan stayed clear.
- **Instructor control:** decisions (approve 75, edit 23→35) recorded on the assessment only; 0 rows in `scores`, leaderboard totals 0; the Excel "AI Assessment" sheet showed Approved / Approved (edited score) / No approved AI assessment correctly.
- **Students:** 403 on all AI routes; no AI fields in their documentation payload.
- **Cost and latency:** ≈ $0.01–0.02 per successful request, 8–17 s — far below the plan's estimates.

## Failures and findings

**F1 — Output degenerates into whitespace (blocker before production).** In 2 of 7 replies (one job: Bravo live, attempt and retry) the model wrote the complete, valid `live` object and then, instead of `,"final":null}`, emitted ~7,000 newlines until `max_output_tokens` (3,000) — a known strict-JSON-schema failure mode. The app behaved safely (one retry, then `invalid_response`, no result kept, ~$0.066 wasted, ~80 s). A rerun of the same job later succeeded. Recommended fix (contract v2, needs approval because it changes the agent schema):
  1. Replace the `{live, final}` pair with a single `result` property per mode (or put the always-null key first), so the reply never has to emit a trailing `null` branch after a large object.
  2. App side: treat a reply whose trimmed text is valid JSON missing only the closing null branch as a distinct error code (`ai_output_runaway`) for monitoring; optionally lower `max_output_tokens` for live to ~1,500 (valid live replies used 396–732) to cap the cost of a runaway.

**F2 — Student-safe hints are a little too revealing.** Alpha's guiding question ("What happened on WS03 right after the user opened the email with the attachment?") and a comment calling the email "phishing" confirm things the team had only suspected. Not an answer-key leak, but stronger than the plan intends. Tune the instructions: "never confirm a hypothesis the team has not confirmed; ask about what they recorded, not about the next step".

**F3 — Prompt Shields did not block the injection entry this time** (in Phase 0 a similar entry was rejected with HTTP 400). The agent itself ignored it, gave no credit, leaked nothing and added a warning — the defence in depth held. Worth checking the guardrail configuration on the deployment; no change was made.

**F4 — Scoring calibration.** Alpha's "not sure if related" phishing note was judged `correct` (arguably `partial`); Bravo's 23/100 looks strict for a team that found the staging file. Phase 8 evaluation should calibrate with instructor reference scores before relying on the numbers.

## Changes needed before production

1. Fix F1 (contract v2 schema + agent version), then re-validate with a few requests.
2. Tune instructions for F2 and F4 (Phase 8 evaluation).
3. Decide whether v5 stays the agent's latest version: any environment with `AI_ASSESSMENT_ENABLED=true` and an empty `FOUNDRY_AGENT_VERSION` now uses v5. Pin `FOUNDRY_AGENT_VERSION` per environment.
4. Review the Prompt Shields configuration (F3).
5. Cleanup decision for the 4 test resources above (not authorised yet).

---

# Stabilization run (2026-10-18, approved)

Scope approved by the user: fix the broken JSON output (F1) with a new response schema and ONE new agent
version (v6), tighten student-safe feedback (F2), up to 6 model requests / $1, existing test resources only,
isolated database (a `VACUUM INTO` copy of the 2026-10-15 validation DB), no cleanup.

## Changes

- **Contract 2** (`assessmentContract.ts`, `docs/ai-agent/*.json`): the envelope is now
  `{contractVersion: "2", mode, result: Live | Final}`. The mode's result is the LAST property, so nothing has
  to follow the large object (contract 1 needed a trailing `"final": null`, where both runaways began). The
  app parses `result` against the requested mode's schema only.
- **Runaway handling** (`assessmentRunner.service.ts`): a reply cut off at the output cap is reported as
  `ai_output_runaway` (retried once, then fails with no result). Output caps lowered: live 3,000 → 1,500,
  final 5,000 → 3,000 tokens (valid replies use ≤ ~1,050).
- **Pinned agent version required** (`aiConfig.ts`): an unset `FOUNDRY_AGENT_VERSION` now leaves AI
  disabled ("not configured"), so no environment can follow Foundry's "latest" (now v6) by accident. A
  contract-1 agent (v5) would also be refused (`contract_mismatch`).
- **Instructions** (`docs/ai-agent/agent-instructions.md`): student-safe fields must not confirm or name
  details the team has not established (e.g. "phishing"); guiding questions point back to the team's own
  records; hedged observations earn `partial`; the reply must end right after the envelope.
- **Agent `cyber-range-assessor` v6** = v3's definition (gpt-4.1, File Search, structured input) + the new
  instructions (7,748 chars) + the contract-2 schema. Its description marks it "NOT production". v1–v5 unchanged.

## Request ledger (limits: 6 requests, $1)

| # | Test | HTTP | Latency | Input (cached) | Output | Est. $ | Outcome |
|---|---|---|---|---|---|---|---|
| 1 | Live, Team Bravo (pinned v2): the job that ran away twice on v5 | 200 | 7.8 s | 4,763 (0) | 640 | 0.0171 | ✅ first attempt |
| 2 | Live, Team Alpha (pinned v1): "not sure if related" email | 200 | 25.1 s | 4,830 (0) | 803 | 0.0186 | ✅ first attempt |
| 3 | Final, Team Alpha | 200 | 13.2 s | 4,880 (3,456) | 895 | 0.0142 | ✅ 43/100 |
| 4 | Final, Team Bravo | 200 | 8.2 s | 4,802 (3,584) | 927 | 0.0141 | ✅ 27/100 |
| 5 | Live, Team Bravo again | 200 | 13.1 s | 4,763 (3,584) | 631 | 0.0117 | ✅ first attempt |

**5 of 6 requests, ≈ $0.076.** No files or vector stores were created (caps were 0); the existing stores
`vs_oHsKp7ahHzbxqSGMZyLflvYk` (v1) and `vs_8rWe3thbMPxdrTyYMUEEI9sb` (v2) were reused. Nothing was deleted.

## Results

- **F1 fixed in this sample:** 5/5 replies valid on the first attempt, no runaway, max output 927 tokens
  (v5: 2 runaways in 7). Small sample — keep monitoring `ai_output_runaway` in Phase 8.
- **F2 improved:** Alpha's student-safe text now says "a possibly related email" (not "phishing") and asks
  "What signs could help you confirm if activity on WS03 led directly to the events on FS01?" — it refers only
  to hosts the team named itself. No answer-key terms (accounts, IP, file names, technique IDs, canaries) in
  any student-safe field; leak scan clear.
- **Calibration:** the hedged email is now `partial` (v5: `correct`). Final scores moved a lot with the
  instruction change: Alpha 75 → 43, Bravo 23 → 27 (see `docs/ai-assessment-phase8-calibration.md`).
- **Still correct:** pinned v1/v2 isolation (no canary crossover), Bravo's VPN root cause marked `incorrect`
  with a verbatim quote, 0 fabricated ids / quotes / unsupported items, rubric sums exact.
- **New minor finding:** Bravo's final carried a spurious agent warning ("Instruction-like text was ignored")
  although that team wrote no such text — instruction tuning in Phase 8.

## Resource state after both runs (nothing deleted; cleanup not authorised)

| Kind | ID | Created |
|---|---|---|
| Agent version | `cyber-range-assessor` v5 (contract 1) | 2026-10-15 |
| Agent version | `cyber-range-assessor` **v6** (contract 2); Foundry's "latest" since it was created | 2026-10-18 |
| File | `assistant-14NjsAauiu5dKfCfEeEAW6` | 2026-10-15 |
| File | `assistant-Qr59VGT8HyB4Az2M9YTBNF` | 2026-10-15 |
| Vector store | `vs_oHsKp7ahHzbxqSGMZyLflvYk` | 2026-10-15 |
| Vector store | `vs_8rWe3thbMPxdrTyYMUEEI9sb` | 2026-10-15 |

Foundry routes unpinned callers to the newest version, so creating v6 made it "latest"; no setting was
changed. The app no longer uses "latest" at all (pin required). No environment configuration was changed.
