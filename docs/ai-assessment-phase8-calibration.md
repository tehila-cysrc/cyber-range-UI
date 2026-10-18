# AI assessment — scoring calibration recommendations for Phase 8

Prepared 2026-10-18 after the live validation and stabilization runs (`docs/ai-assessment-live-validation.md`).
Recommendations only — Phase 8 has not started.

## What we observed

| Team | Evidence in the records | v5 (2026-10-15) | v6 (2026-10-18) |
|---|---|---|---|
| Alpha | admin logon on FS01 ✔, encoded PowerShell on FS01 ✔, "email with an invoice attachment … not sure if related" (hedged) | 75 / 100, email `correct` | 43 / 100, email `partial` |
| Bravo | wrong root cause (VPN brute force), `stage.zip` on FS01 ✔ | 23 / 100 | 27 / 100 |

- The **ranking** is stable (Alpha > Bravo), but the **absolute score** moved 32 points for the same work after an
  instruction change that only touched hedged observations and student-safe text. Absolute numbers are not yet
  reliable enough to approve without instructor judgement.
- v6's stage judgements look right; the drop comes from stricter per-criterion points (identification 30 → 18).
- Each fixture was scored once per version, so run-to-run variance is still unmeasured.

## Recommendations

1. **Anchor the rubric with explicit bands in the agent instructions** (per criterion). Example: identification =
   share of reference stages documented with evidence (correct = full weight, partial = half), mapped linearly to
   maxPoints; understanding, connections and clarity with 3–4 described levels each. This makes strictness a rule
   rather than a style, so instruction edits are less likely to swing totals.
2. **Instructor reference scores:** have one or two instructors blind-score the 8 planned eval fixtures (plan §K);
   use them as the target (mean absolute error ≤ 10 points; same ranking).
3. **Measure variance:** 3 runs per fixture per agent version; accept a version only if the spread is ≤ 5 points
   (plan §K target). Cost is small (≈ $0.015 per final).
4. **Track calibration in the product:** decisions already store the AI and the instructor score per final — add
   the planned admin report (mean |AI − instructor|, approval rate) per agent version.
5. **Pin and promote deliberately:** keep `FOUNDRY_AGENT_VERSION` pinned per environment (now enforced) and move it
   only after a version passes 1–3.
6. **Instruction fixes queued from the runs:** no spurious "instruction-like text" warnings when none exists; keep
   hedged observations at `partial`; keep student-safe text limited to the team's own facts (v6 behaviour).
7. **Optional model comparison:** evaluate `gpt-4.1-mini` only after 1–3 pass on `gpt-4.1`.

## Expected Phase 8 cost (estimate; needs approval)

8 fixtures × 3 runs × (1 live + 1 final) ≈ 48 requests × ≈ $0.015–0.02 ≈ **$0.75–1.00**, plus up to 2 small
synthetic documents / vector stores if new fixture scenarios are needed.
