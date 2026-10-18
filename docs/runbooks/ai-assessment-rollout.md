# AI Investigation Assessment — safe rollout, pin changes and rollback

Status: **prepared 2026-10-18, not executed.**
- Agent work and calibration are frozen.
- No environment pins an agent version yet.
- Final AI scores are advisory.

Enabling AI in any real environment, moving a pin, or any Foundry change needs explicit approval.

## Settings (server environment; a restart applies them)

| Setting | Meaning | Safe default |
|---|---|---|
| `AI_ASSESSMENT_ENABLED` | Kill switch. Anything but `true`/`1`/`on`/`yes` = off | unset (off) |
| `FOUNDRY_PROJECT_ENDPOINT`, `FOUNDRY_AGENT_NAME` | Which Foundry project and agent | — |
| `FOUNDRY_AGENT_VERSION` | **Required** pinned agent version. Unset = AI stays off (never Foundry's "latest") | unset |
| `FOUNDRY_AGENT_CONTRACT_VERSION` | Reply format of that version: `2` = v6, `3` = v7. Unknown value = AI stays off | unset (= `2`) |
| `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` | Dedicated service principal, **Foundry User** role on the project only | — |
| `AI_REQUEST_TIMEOUT_MS`, `AI_MAX_CONCURRENT` | 120000 ms; 3 concurrent jobs | defaults |

**Check** under System → **AI Resources** → "AI configuration". It shows switch / configured / enabled, the pinned version, the request format, and the names of missing settings. Values and secrets are never shown.

## Agent versions known on 2026-10-18 (all test candidates, none production)

| Version | Contract | Notes |
|---|---|---|
| v5 | 1 | Not accepted by the app any more (contract 1) — do not pin |
| v6 | 2 | Stabilization candidate |
| v7 | 3 | Phase 8 candidate (anchored rubric, temperature 0). Live evaluation: JSON/evidence 100%, injection 9/9 with 0 false positives, but score spread > 5 points on 8 of 17 identical investigations — `docs/ai-assessment-phase8-live-evaluation.md` |

Foundry marks the newest version as "latest"; the app never follows it.

## Rollout order (each step needs approval)

1. **Deploy with AI off.** Deploy the code with `AI_ASSESSMENT_ENABLED` unset (`docs/runbooks/production-deploy-backup-and-rollback.md`).
2. **Configure without enabling.**
   - Set the endpoint, agent name, service principal, `FOUNDRY_AGENT_VERSION`, and the matching `FOUNDRY_AGENT_CONTRACT_VERSION`.
   - Restart, then check AI Resources: "configured", "AI assessment off".
3. **Reference documents.** Upload a reference document per scenario on the Scenarios page. This creates one Foundry file and one vector store per version, and every one is tracked under AI Resources.
4. **Enable for a pilot.** Set `AI_ASSESSMENT_ENABLED=true`, restart, and run one live review and one final on a test team before an event.
5. **Operate.**
   - Instructors review every result.
   - "Post as feedback" opens the normal form, and nothing reaches students automatically.
   - Final scores are recorded only, never added to the leaderboard.

## Moving the pin (e.g. v6 → v7)

1. Change `FOUNDRY_AGENT_VERSION` **and** `FOUNDRY_AGENT_CONTRACT_VERSION` together (v7 → `3`).
2. Restart.
3. **Check what has to stay the same:**
   - running assessments finish on the old version;
   - new ones use the new pin;
   - history rows show "agent vN · format N".
4. The app accepts replies in formats 2 and 3, so a mismatch between pin and format still parses. Setting both keeps the request honest.

## Rollback / emergency stop

| Situation | Action |
|---|---|
| Wrong or bad results | Set `FOUNDRY_AGENT_VERSION` (and format) back to the previous version, then restart |
| Stop everything now | `AI_ASSESSMENT_ENABLED=false`, restart. New AI actions (reviews, uploads, rebuilds) are refused with 503 `ai_disabled`, the UI hides them, and stored results stay readable |
| Foundry outage | Rate limits and server errors are retried up to twice with backoff, then the job fails with a safe code (`ai_unavailable`, `ai_timeout`, `ai_rate_limited`); instructors can run it again |

## Foundry resources and cleanup

- Every file and vector store the app creates is recorded under AI Resources → "Tracked Foundry resources".
- **Deletion is never automatic:**
  - an admin selects unused candidates and confirms the exact IDs (type DELETE);
  - the server re-checks every one.
- "Foundry project inventory" is a read-only listing on request. Resources created outside the app are shown as **not tracked** and can't be deleted there. The 2026-10-15/18 test resources are like that: agent v5–v7, 3 files, 3 vector stores; see `BACKLOG.md`.
- If a version's Foundry copy is gone while sessions still use it, rebuild it from the stored file: Scenarios → AI reference document → version history → **Rebuild in Foundry**.

## Data retention

- **Kept across event resets:** reference documents and their versions (CONFIG).
- **Deleted by an event reset:** assessments, decisions and session pins (RUN).
  - The Reset page warns when approved AI finals exist.
  - They survive only in the Excel download's "AI Assessment" sheet.
