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
| See or upload reference documents, set the rubric, rebuild, download | `scenario.inspect` / `scenario.author` | admin; instructors on their assigned scenarios |
| Run reviews, read results, post feedback, record decisions | `ai_assessment.use` (+ `documentation.feedback`, `score.award`) | admin; instructors on their assigned (organization, scenario) pairs |
| AI Resources: configuration, tracked resources, cleanup, Foundry inventory | `ai_resources.manage` | admin only |
| Results export with the "AI Assessment" sheet | `event.export` (all) / `results.export` (assigned pairs) | admin / instructors |

Out-of-scope requests answer 404, and missing permissions answer 403. Both are audited. Students have no AI access.

## Reference documents (Scenarios page → "AI assessment reference")

- **Upload:** PDF, DOCX or TXT, up to 5 MB. Each upload is a new **version**. It is processed in Foundry (a file and a vector store) and becomes current when ready.
- **Pinning:**
  - A team's scenario session keeps the version that was current when it started.
  - Replacing the document affects only sessions that start later.
  - The version history shows which teams use each version, and how many assessments used it.
- **Failed processing:** retry it, or upload another version. A failed replacement never affects the current version.
- **"Foundry copy deleted"** means the version's copy in Foundry is gone. The file is still stored. If sessions still use it, **Rebuild in Foundry** re-uploads it, and the pins don't change.
- **Download** gives authors the original file. Every download is audited.
- **Deleting a scenario** removes its versions. Their Foundry copies are never deleted automatically: they appear as cleanup candidates under AI Resources.
- **Rubric:** the weights for the final score (default 40/30/20/10; they must add up to 100).

## Running reviews (team workspace → AI Review)

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

## Final score decisions and export

- **Approve, Edit (with a note) or Reject.** Recorded on the assessment and audited. Official scores and the leaderboard never change; award points on the Scoring tab.
- **Excel results** include an "AI Assessment" sheet with the latest approved or edited final per team and scenario.
- **Event reset** deletes all assessments.
  - The Reset page warns when approved finals exist.
  - Download the Excel first, because it is the only copy afterwards.

## AI Resources (admin; System → AI Resources)

- **AI configuration:** switch, configured or not, pinned agent version, request format, and the names of missing settings. Settings are changed in the server environment, then a restart.
- **Tracked Foundry resources:** everything the app created.
  - **Cleanup** is explicit. Select unused candidates (reasons: replaced version, failed upload, earlier attempt, deleted scenario), then confirm the exact IDs by typing DELETE.
  - The server re-checks each one. Results are shown per ID, and failures stay listed for a retry.
- **Foundry project inventory:** a read-only listing, loaded only on request.
  - Items the app doesn't track are marked **Not tracked by this app** and can't be deleted here.
  - The agent version pinned on this server is marked.

### Test resources outside the app (kept on decision, cleanup needs a separate approval)

| Kind | IDs |
|---|---|
| Agent versions | `cyber-range-assessor` v5 (contract 1), v6 (contract 2), v7 (contract 3, temperature 0) |
| Files | `assistant-14NjsAauiu5dKfCfEeEAW6`, `assistant-Qr59VGT8HyB4Az2M9YTBNF`, `assistant-BjUN2sJdkTGX9DhXxZkSFJ` |
| Vector stores | `vs_oHsKp7ahHzbxqSGMZyLflvYk`, `vs_8rWe3thbMPxdrTyYMUEEI9sb`, `vs_D5kjUKbHLn1QPXgB2hgSkYVG` |

The project's other two stores (`vs_YgzS…`, `vs_cFNP…`) belong to their owner and must never be touched.

## Messages and what to do

| Message (code) | Meaning / action |
|---|---|
| AI assessment is turned off (`ai_disabled`) | The kill switch is off on the server |
| Not configured (`ai_not_configured`) | A setting is missing; AI Resources lists which |
| No reference document was ready when this session started (`ground_truth_not_ready`) | Upload one; sessions started before any version get the first ready one |
| Reference version not available in Foundry (`ground_truth_unavailable`) | Rebuild it from the version history |
| A review is already running (`assessment_in_progress`) / busy (`ai_busy`) / hourly limit (`rate_limited`) | Wait and try again |
| Timeout / unavailable / rate limited by Foundry | Try again. The server already retried transport errors twice |
| Content safety filter blocked this review (`ai_content_filtered`) | Often student text that looks like instructions to the AI; review the timeline by hand |
| Wrong format twice / ran past its length limit / didn't consult the reference (`invalid_response`, `ai_output_runaway`, `ai_no_retrieval`) | No result kept; try again. If repeated, an admin checks the agent |
| Answer format changed (`contract_mismatch`) | The pinned agent's reply format isn't accepted; check `FOUNDRY_AGENT_VERSION` / `FOUNDRY_AGENT_CONTRACT_VERSION` |
| Interrupted | The server restarted mid-run; run it again |

## Cost (estimate)

- **Per request:** about $0.015–0.02 per live review or final with gpt-4.1. This is from the 2026-10-18 live evaluation: 51 requests, about $0.74.
- **Vector storage:** negligible for a few MB of documents.
- **Billing:** Azure bills the actual usage. The estimate is not a cap.

## Data and privacy

- **Reference documents** are CONFIG data and survive resets. **Assessments** are RUN data and are deleted by a reset.
- **What goes to Foundry:** pseudonymous snapshots only, with `store: false`.
- **Audit rows** hold IDs, codes, counts and tokens. They never hold document text, student text or model output.
