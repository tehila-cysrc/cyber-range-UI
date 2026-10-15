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

**Applied 2026-10-15 as `cyber-range-assessor` v5** (approved live validation), together with the
production instructions in `agent-instructions.md`, by `server/scripts/ai-live-validation.mjs create-agent`.
v1–v4 are unchanged. Results and the open schema issue (F1): `docs/ai-assessment-live-validation.md`.
Changing this schema is a contract change: bump `CONTRACT_VERSION` in the app at the same time, or jobs
fail with `contract_mismatch`.
