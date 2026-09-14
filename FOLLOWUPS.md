# Followups

Out-of-scope bugs found in passing. One line per item. Read at session start; surface P0/P1 to the user before starting new work.

Format:

```
- [ ] P<0|1|2|3> | <YYYY-MM-DD> | <file>:<line> | <one-line repro/symptom>
```

## Open

- [ ] P2 | 2026-01-01 | example/file.ts:42 | <symptom> — <repro>
- [ ] P3 | 2026-09-14 | server/src/services/accessBroker/accessBroker.service.ts:52 | `requestAccessSession`'s `deny()` inserts an `access_sessions` row with `topology_node_id = topologyNodeId` even when the node doesn't exist at all (not just wrong-range) — with `PRAGMA foreign_keys = ON` this throws an unhandled FK-constraint error (500) instead of a clean 4xx. Repro: POST `/teams/me/access-sessions` with a `topologyNodeId` that doesn't exist in `topology_nodes`. Noticed while adding the new instructor Connect path, which deliberately avoids the same trap by 404-ing before any insert when the node isn't found.
- [ ] P3 | 2026-09-14 | server/src/services/azureErrors.ts:19 | `classifyAzureError` only reads `.statusCode`/`.code` off the thrown error, but `bastionConnect.service.ts#createShareableLink`/`deleteShareableLink` throw plain `Error` objects with the real HTTP status embedded in the message string — so every Bastion Connect failure (both the student and new instructor path) surfaces as the generic `'operation failed for an unexpected reason'` regardless of the actual cause. Observed live: a Connect attempt against a real VM returned this generic 502 once, then succeeded on immediate retry with no code change — almost certainly a transient Azure-side timing issue, but there's no way to tell from the client-facing message alone.

## Done

- [x] P1 | 2025-12-15 | fixed in commit abc1234
