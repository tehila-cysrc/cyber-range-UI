# Foundry agent schema files

Generated from `server/src/services/ai/assessmentContract.ts` by `npm run export-ai-schema -w server`.
Do not edit by hand — `server/tests/ai.contract.test.mjs` fails if these drift from the contract.

| File | Use |
|---|---|
| `agent-text-format.json` | The agent definition's `text` value (strict `json_schema`, name `assessment_envelope`). |
| `assessment-envelope.schema.json` | The same schema alone (for the portal's Text format → JSON schema field). |

Why on the agent: Phase 0 proved a per-request `text.format` is rejected for named agents
(`docs/ai-assessment-foundry-poc.md`, finding 6). One envelope covers both modes:
`{contractVersion: "2", mode: "live"|"final", result: {...}}` (contract 2; the result is the last property).

**Contract 2 applied 2026-10-18 as `cyber-range-assessor` v6** (stabilization; NOT production yet), fixing
live-validation finding F1. Contract 1 (`{live, final}`) is v5 (2026-10-15). Both were created by
`server/scripts/ai-live-validation.mjs create-agent` with `agent-instructions.md`; earlier versions unchanged.
The app requires a pinned `FOUNDRY_AGENT_VERSION` and refuses replies with another contract version. Results and the open schema issue (F1): `docs/ai-assessment-live-validation.md`.
Changing this schema is a contract change: bump `CONTRACT_VERSION` in the app at the same time, or jobs
fail with `contract_mismatch`.

**`proposed/` — contract 3 and v7 instructions (Phase 8, 2026-10-18; NOT applied in Foundry).** Contract 3
adds the judgements `hypothesis` and `unsupported_claim` and `instructionLikeRecords` (records the agent
ignored as instructions). The app already accepts contract 2 and 3 replies (`ACCEPTED_CONTRACT_VERSIONS`)
while requests still carry `CONTRACT_VERSION` "2". Promotion (after approval): create v7 from
`proposed/agent-instructions.v7.md` + `proposed/agent-text-format.json`, set `CONTRACT_VERSION = '3'`, then
move the pin. Rationale: `docs/ai-assessment-phase8-calibration.md`. **Applied 2026-10-18 as `cyber-range-assessor` v7** (evaluation only, NOT production, temperature 0; no environment pins it); results in `docs/ai-assessment-phase8-live-evaluation.md`. `CONTRACT_VERSION` in the app is still "2".
