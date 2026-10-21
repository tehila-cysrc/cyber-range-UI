# AI Investigation Assessment — operator guide

For admins and instructors running the feature.
- Design: `docs/ai-investigation-assessment-plan.md`.
- Rollout and pin changes: `docs/runbooks/ai-assessment-rollout.md`.
- Deploy and backup: `docs/runbooks/production-deploy-backup-and-rollback.md`.

> **Status (2026-10-18).** Agent work and scoring calibration are **frozen**. The final AI score is **advisory**:
> it is not calibrated, can differ between runs on the same work, and is never added to team points or the
> leaderboard. Every result needs an instructor's review. No environment pins an agent version yet, so AI is off
> until an approved rollout.

## What it does

The feature compares a team's investigation with the scenario's reference document. The investigation is its timeline entries, canvas, instructor feedback, help requests and scores. The reference document is the instructor's ground truth.

- **Progress review (live):** a short read on where the team stands. It produces suggested feedback that the instructor can edit and post on an entry.
- **Final assessment:** stage-by-stage judgements, strengths and gaps, and a recommended score out of 100. The instructor approves, edits or rejects it. The decision is recorded on the assessment only.

The app never sends anything to students on its own. Microsoft Foundry receives pseudonyms ("Student 1"), never names.

## Who can do what

| Action | Permission | Who |
|---|---|---|
| See or upload reference documents, rebuild, download | `scenario.inspect` / `scenario.author` | admin; instructors on their assigned scenarios |
| Run reviews, read results, post feedback, record decisions | `ai_assessment.use` (+ `documentation.feedback`, `score.award`) | admin; instructors on their assigned (organization, scenario) pairs |
| AI Management: readiness, reference document overview, review and delete unused resources | `ai_resources.manage` | admin only |
| Results export with the "AI Assessment" sheet | `event.export` (all) / `results.export` (assigned pairs) | admin / instructors |

Out-of-scope requests answer 404, and missing permissions answer 403. Both are audited. Students have no AI access.

## Reference documents (Scenarios page → "Reference document for AI")

Instructors see one Upload / Replace button, a plain status (Ready, Preparing…, Failed + Retry) and the file name. Everything below except upload and retry (version numbers, version history, Rebuild, Download, file details) is under **Advanced settings (admin)**, shown only with `ai_resources.manage`. The server rules are unchanged.


- **Upload:** PDF, DOCX or TXT, up to 5 MB. Each upload is a new **version**. It is processed in Foundry (a file and a vector store) and becomes current when ready.
- **Pinning:**
  - A team's scenario session keeps the version that was current when it started.
  - Replacing the document affects only sessions that start later.
  - The version history shows which teams use each version, and how many assessments used it.
- **Failed processing:** retry it, or upload another version. A failed replacement never affects the current version.
- **"Foundry copy deleted"** means the version's copy in Foundry is gone. The file is still stored. If sessions still use it, **Rebuild in Foundry** re-uploads it, and the pins don't change.
- **Download** gives authors the original file. Every download is audited.
- **Deleting a scenario** removes its versions. Their Foundry copies are never deleted automatically: they appear as unused resources under AI Management.
- **Rubric:** the weights for the final score are defined in code (`DEFAULT_RUBRIC`: 40/30/20/10) and are the same for every scenario. There is no editor (2026-10-21); a change is a reviewed code change and a deploy.

## Running reviews

- **Check with AI (each timeline entry):** in the staff timeline, while the session is active or paused. It runs the team's live review of the whole investigation, or reuses the last one when nothing changed, and shows a short card for that entry only: the verdict, one suggested score (not awarded; 0 when the AI suggested none) and a recommendation cut to two lines (the suggested feedback, or the score rationale when there is none; hover shows it in full). Related judgements, gaps and the team overall status are left out on purpose — they are under **Details**, and the extensive feedback is the Event Summary final assessment. All entries share one review, so checking several entries costs one model call. **Edit & send** opens the existing feedback form, pre-filled — the text and a **Points** field holding the suggested score, both editable; nothing is sent or awarded until **Send** (the points go through the same `POST /admin/scores` as the Scoring tab, credited to the entry's author, with the feedback text as the student-visible note; empty or 0 = no points; "Already awarded" shows earlier awards; a resend after Posted starts with no points). The plain **+ Feedback** form on the staff team view has the same Points field. The leak gate and the instruction-like-entry warning apply here too. When the AI said nothing about the entry, the card says so.
- **View details** opens the full review (`/instructor/teams/<id>?tab=ai`). There is no AI tab in the workspace tab bar any more, and no "Analyze progress" button in the team header.

- **Session:** the active one by default. Paused and completed sessions can be picked, and the choice is kept in the URL (`?tab=ai&view=final&session=…`).
  - Progress reviews need an active or paused session.
  - A final assessment works on any started session; a confirmation appears while the scenario is still running.
- **Reuse:** an unchanged investigation reuses the previous result. "Run a fresh review" / "Generate again" forces a new run.
- **Post as feedback:**
  - It opens the normal feedback form, pre-filled and editable. Nothing is sent until **Send**.
  - The suggestion then shows **Posted**, based on the saved feedback. It survives reloads, and it disappears if that feedback is deleted.
  - Team-level text and the guiding question are copy-only.
- **"This feedback may reveal part of the answer":**
  - The check found an answer-key technique ID, or a word from the reference that the team never wrote.
  - Post and Copy stay disabled until you tick "I've reviewed this".
  - The check is lexical: read the text anyway.
- **"Checks on this result":**
  - an entry contains text addressed to the AI (possible prompt injection);
  - the AI claimed to ignore instructions that no entry contains (probably a false positive);
  - identification points don't match the AI's own stage judgements.

  None of these changes the result.
- **History rows** show the time, status, reference version, requester, agent version and reply format.

## Final assessments for all teams (Event Summary → "AI Assessment")

- One list of every started team session you may assess (pair scope), with its status: not assessed, generating, waiting for your review (AI score), approved / edited / rejected, failed, or why it can't run (no reference document, copy unavailable).
- **Generate N selected:** the default selection is every session whose work changed since its last final (or that has none). Sessions already covered by their latest final are not selectable, so no duplicate model call is made; the server's reuse is the backstop.
- Before starting, a confirmation lists the count, the sessions still running (final covers only what is documented so far), and a warning when the selection may exceed your hourly limit (30 per account; the screen shows how many are left).
- The browser runs at most 3 requests at once; "busy" answers are retried after 15 s; the hourly limit stops the batch and the rest are marked "not started". Progress shows done / generating / waiting / failed / not started. **Stop** keeps running ones going on the server. Closing the page stops what has not started yet.
- **Review** opens the result with the score decision inline; **View details** opens the team's full AI view. Nothing is approved or sent automatically.

## Final score decisions and export

- **Approve, Edit (with a note) or Reject.** Recorded on the assessment and audited. Official scores and the leaderboard never change; award points on the Scoring tab.
- **Excel results** include an "AI Assessment" sheet with the latest approved or edited final per team and scenario.
- **Event reset** deletes all assessments.
  - The Reset page warns when approved finals exist.
  - Download the Excel first, because it is the only copy afterwards.

## AI Management (admin; System → AI Management, route `/admin/ai-resources`)

Operational only (2026-10-21). The admin does not manage the agent: its name, version, reply contract — and with the version its model, instructions and temperature — are pinned in code (`PINNED_AGENT` in `server/src/services/ai/aiConfig.ts`), and the rubric is `DEFAULT_RUBRIC`. Changing them is a reviewed code change and a controlled deploy. The page answers three questions:

- **AI status:** **Ready / Disabled / Needs attention**, with the reasons.
  - *Disabled* = the server switch is off. *Needs attention* = switched on but the deployment is incomplete, or a reference document failed / needs a rebuild / no scenario has a ready document.
  - No agent, version or setting names are shown. The server log lists missing setting names at startup (`[ai] … missing or invalid: …`). It never claims a working connection: this page runs no connectivity check.
  - AI is switched on or off only in the deployment configuration (no toggle here).
- **Reference documents:** each scenario with Ready / Processing / Failed / Missing, the file name and a link to the scenario page. Upload and replace stay on the Scenarios page.
- **Foundry resources:** counts of tracked, in use and unused (eligible for cleanup) resources.
  - **Review unused resources** opens the cleanup list: type, Foundry ID, why it is unused. Nothing is preselected.
  - Confirm the exact IDs by typing DELETE. The server re-checks each one. Results are shown per ID, and failures stay listed for a retry.
- There are no advanced settings. The read-only Foundry inventory remains an API for maintenance only (`GET /admin/ai/foundry-inventory`, admin): it lists the project's vector stores, files and agent versions, marks the code-pinned version, and deletes nothing.

### Test resources outside the app (kept on decision, cleanup needs a separate approval)

| Kind | IDs |
|---|---|
| Agent versions | `cyber-range-assessor` v5 (contract 1), v6 (contract 2), v7 (contract 3, temperature 0) |
| Files | `assistant-14NjsAauiu5dKfCfEeEAW6`, `assistant-Qr59VGT8HyB4Az2M9YTBNF`, `assistant-BjUN2sJdkTGX9DhXxZkSFJ` |
| Vector stores | `vs_oHsKp7ahHzbxqSGMZyLflvYk`, `vs_8rWe3thbMPxdrTyYMUEEI9sb`, `vs_D5kjUKbHLn1QPXgB2hgSkYVG` |
| 2026-10-19 connectivity test (v7, isolated DB copy) | file `assistant-VMU9EnHAM2u84YMCUorP69`, vector store `vs_B6XfogyW0KYRkcHzJqC0GUfd` (TJS test reference, 1 KB) — tracked only in the isolated copy's `ai_foundry_resources`, so the main app's AI Management will not list them; kept on decision |

The project's other two stores (`vs_YgzS…`, `vs_cFNP…`) belong to their owner and must never be touched.

## Messages and what to do

| Message (code) | Meaning / action |
|---|---|
| AI assessment is turned off (`ai_disabled`) | The kill switch is off on the server |
| Not configured (`ai_not_configured`) | The deployment is missing a setting; the server log at startup names it |
| No reference document was ready when this session started (`ground_truth_not_ready`) | Upload one; sessions started before any version get the first ready one |
| Reference version not available in Foundry (`ground_truth_unavailable`) | Rebuild it from the version history |
| A review is already running (`assessment_in_progress`) / busy (`ai_busy`) / hourly limit (`rate_limited`) | Wait and try again |
| Timeout / unavailable / rate limited by Foundry | Try again. The server already retried transport errors twice |
| Content safety filter blocked this review (`ai_content_filtered`) | Often student text that looks like instructions to the AI; review the timeline by hand |
| Wrong format twice / ran past its length limit / didn't consult the reference (`invalid_response`, `ai_output_runaway`, `ai_no_retrieval`) | No result kept; try again. If repeated, an admin checks the agent |
| Answer format changed (`contract_mismatch`) | The pinned agent's reply format isn't accepted; check `PINNED_AGENT` in `server/src/services/ai/aiConfig.ts` (a code change) |
| Interrupted | The server restarted mid-run; run it again |

## Cost (estimate)

- **Per request:** about $0.015–0.02 per live review or final with gpt-4.1. This is from the 2026-10-18 live evaluation: 51 requests, about $0.74.
- **Vector storage:** negligible for a few MB of documents.
- **Billing:** Azure bills the actual usage. The estimate is not a cap.

## Data and privacy

- **Reference documents** are CONFIG data and survive resets. **Assessments** are RUN data and are deleted by a reset.
- **What goes to Foundry:** pseudonymous snapshots only, with `store: false`.
- **Audit rows** hold IDs, codes, counts and tokens. They never hold document text, student text or model output.
