# Foundry agent schema files

Generated from `server/src/services/ai/assessmentContract.ts` by `npm run export-ai-schema -w server`.
Do not edit by hand — `server/tests/ai.contract.test.mjs` fails if these drift from the contract.

| File | Use |
|---|---|
| `agent-text-format.json` | The agent definition's `text` value (strict `json_schema`, name `assessment_envelope`). |
| `assessment-envelope.schema.json` | The same schema alone (for the portal's Text format → JSON schema field). |

Why on the agent: Phase 0 proved a per-request `text.format` is rejected for named agents
(`docs/ai-assessment-foundry-poc.md`, finding 6). One envelope covers both modes:
`{contractVersion: "1", mode: "live"|"final", live: {...}|null, final: {...}|null}`.

**Applying it to the live agent is a manual, approved step** (planned before Phase 5, together with the
real instructions from plan §I.3). The current live agent (v4) still carries the reduced PoC schema.
Changing this schema is a contract change: bump `CONTRACT_VERSION` in the app at the same time, or jobs
fail with `contract_mismatch`.
