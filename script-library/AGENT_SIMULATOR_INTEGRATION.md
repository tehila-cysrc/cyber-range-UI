# Agent Simulator integration

This document describes the `ai-agent` capability set: 19 bounded, safety-reviewed tools that an
external LLM-driven Agent Simulator (separate repo, not part of this project) can call turn-by-turn
to generate realistic normal → suspicious → adversarial-simulation telemetry on a Cyber Range
machine, for SOC students to detect and investigate.

Every capability is a real script under `scripts/ai-agent/` (paired `.ps1` / `-linux.sh`, same
convention as the rest of this library — see `docs/metadata-schema.md` and `docs/safety.md`) plus
one entry in `agent-tools/catalog.json`, shaped as the Agent Simulator's `ToolDeclaration` contract.

## Important: what this integration is, and isn't

**`agent-tools/adapter.mjs` is a reference/bridge implementation, not assumed to be the Agent
Simulator repo's final runtime integration.** It is a standalone Node module + CLI with zero
dependency on this project's server/DB/Azure. The external repo (not accessible from here) can:

- shell out to it: `node script-library/agent-tools/adapter.mjs <tool_name> <dry_run|live>`
  prints a `ToolResult` JSON object to stdout, or
- reimplement the same dispatch table directly against `agent-tools/catalog.json` in its own
  language (the Python-shaped `ToolDeclaration` in the original integration request maps field-
  for-field onto the JSON entries here).

Either way, **the integration step still needed in the Agent Simulator repo** is: point its tool
registry at `agent-tools/catalog.json`, and wire its tool-call path to one of the two options
above. Nothing in this repo assumes which option is chosen.

## Tool table

| Tool | Classification | Category | Blast Radius | Live/Dry Run | Purpose |
| --- | --- | --- | --- | --- | --- |
| `list_running_processes` | Normal | process_execution | host_local_read | Live | Baseline process inspection |
| `check_disk_space` | Normal | housekeeping | host_local_read | Live | Baseline disk health check |
| `read_local_log_tail` | Normal | file_access | host_local_read | Live | Baseline local log inspection |
| `check_scheduled_tasks` | Normal | automation | host_local_read | Live | Baseline automation inventory |
| `check_service_status` | Normal | housekeeping | host_local_read | Live | Baseline service health check |
| `resolve_internal_hostname` | Normal | network | network_egress | Live | Baseline internal DNS check |
| `check_local_time_sync` | Normal | housekeeping | host_local_read | Live | Baseline time sync check |
| `enumerate_local_users` | Normal | identity | host_local_read | Live | Baseline local account inventory |
| `enumerate_installed_software` | Normal | housekeeping | host_local_read | Live | Baseline software inventory |
| `enumerate_network_shares` | Suspicious | network | host_local_read | Live | Local share recon |
| `probe_internal_service_ports` | Suspicious | network | network_egress | Live | Bounded internal port recon |
| `query_decoy_destination` | Suspicious | network | network_egress | Live | Unusual-destination telemetry |
| `repeated_failed_lookup_burst` | Suspicious | network | network_egress | Live | DNS failure-burst telemetry |
| `inspect_safe_environment_variables` | Suspicious | housekeeping | host_local_read | Live | Allowlisted env recon |
| `simulate_privilege_check` | Adversarial-simulated | identity | host_local_read | Live | Elevation-check telemetry |
| `write_decoy_payload_file` | Adversarial-simulated | file_access | host_local_write | Live | Harmless drop-file telemetry |
| `archive_scratch_directory` | Adversarial-simulated | file_access | host_local_write | Live | Harmless staging/archive telemetry |
| `simulate_credential_probe` | Adversarial-simulated | identity | host_local_read | **Dry run only** | Synthetic credential-probe narrative |
| `beacon_to_decoy_endpoint` | Adversarial-simulated | network | network_egress | **Dry run only** | Synthetic beacon narrative |

`enumerate_installed_software` intentionally does double duty as the spec's "suspicious recon"
example — choosing it in a different multi-turn sequence (after share/port enumeration, say) is
what makes it read as suspicious, not a separate tool.

## Per-tool notes

### Normal

- **list_running_processes** — Top 15 processes by CPU. An agent picks this for general host
  awareness. Telemetry: none new; useful as context around other events. Safe: read-only,
  parameterless.
- **check_disk_space** — Free/used space per local volume. Picked for routine health checks.
  Telemetry: none. Safe: read-only.
- **read_local_log_tail** — Last 20 lines of the OS's own log (Windows System event log /
  journalctl-or-syslog on Linux), not an app file that might not exist yet. Picked to "check
  recent activity". Telemetry: none produced (read-only). Safe: bounded to 20 entries, read-only.
- **check_scheduled_tasks** — Read-only enumeration of scheduled tasks / cron entries. Distinct
  from `admin-scheduled-task`, which *creates* one — this tool never creates anything. Telemetry:
  none. Safe: read-only.
- **check_service_status** — Status of the same allowlisted default service (`Spooler` /
  `nginx`) used by `infra-restart-service*`. Telemetry: none (read-only; contrast with the
  restart script, which does produce SCM events). Safe: fixed service name, read-only.
- **resolve_internal_hostname** — Resolves 3 fixed internal-looking lab names
  (`dc01.lab.local`, `fileserver.lab.local`, `web01.lab.local`). Telemetry: DNS query activity if
  DNS logging is onboarded. Safe: fixed name list, failures are informational not fatal.
- **check_local_time_sync** — `w32tm /query /status` / `timedatectl status`. Telemetry: none.
  Safe: read-only.
- **enumerate_local_users** — Local account names + enabled state only, no password/hash data.
  Telemetry: none. Safe: read-only, no credential material touched.
- **enumerate_installed_software** — Up to 25 installed programs/packages. Telemetry: none.
  Safe: read-only, bounded to 25 entries.

### Suspicious

- **enumerate_network_shares** — Locally-hosted SMB shares on *this* host only, never a remote
  target. An agent picks this to "map available resources"; a SOC analyst reasonably flags it
  alongside other recon. Telemetry: none directly; the pattern (paired with port probes) is the
  signal. Safe: local-only, read-only.
- **probe_internal_service_ports** — TCP-connects to 4 fixed ports (445, 1433, 3389, 8080) on
  **hardcoded `127.0.0.1`** — no parameter, no env var, no host indirection anywhere in the
  script (verified by `adapter.test.mjs`). Telemetry: a burst of local connect attempts is
  itself a plausible detection signal. Safe: fixed loopback target, repeated calls are inert.
- **query_decoy_destination** — One HTTP GET to a hardcoded decoy hostname
  (`decoy.lab.local`); failure to connect is a normal, expected outcome, not a script error.
  Telemetry: outbound request to an unusual destination name if proxy/firewall logging is
  onboarded. Safe: fixed hostname, bounded single request.
- **repeated_failed_lookup_burst** — 3 fixed nonexistent hostnames (`nx1/2/3.lab.invalid`) × 2
  rounds = 6 bounded lookups, all expected to fail. Telemetry: repeated NXDOMAIN-style failures
  if DNS logging is onboarded. Safe: fixed, capped list — no unbounded loop.
- **inspect_safe_environment_variables** — Reads a hardcoded allowlist only (hostname, OS,
  processor/core count, domain/user, architecture) — never a variable that could plausibly hold
  a secret. Telemetry: none. Safe: allowlist is baked into the script, not passed in.

### Adversarial-simulated

- **simulate_privilege_check** — Read-only "am I admin/root" check (`WindowsPrincipal`
  role check / `id -u`), no elevation attempted. An agent picks this right after recon, which is
  what makes the *sequence* read as adversarial. Telemetry: none directly. Safe: read-only
  identity check only.
- **write_decoy_payload_file** — Writes a harmless marker file to a **fixed, overwritten**
  filename (`.../agent-activity/scratch/decoy-payload.txt`) — not timestamped, so repeated calls
  never accumulate files (see `adapter.test.mjs`'s repeat-call test). Telemetry: FileCreate/
  Modify if FIM/Sysmon is onboarded. Safe: fixed path under the existing lab workspace
  convention, bounded disk usage.
- **archive_scratch_directory** — Archives that same scratch directory to a **fixed, overwritten**
  archive file (`.../agent-activity/scratch-archive.zip` / `.tar.gz`), placed as a *sibling* of
  the directory it archives (not inside it) to avoid self-inclusion. Not timestamped — disk usage
  is bounded to exactly one archive file regardless of call count (verified explicitly by a
  repeat-call test). Telemetry: FileCreate/Modify for the fixed archive path; the *pattern*
  (scratch-dir writes followed by an archive) is the adversarial signal. Safe: fixed path,
  bounded, reversible (delete the one file).
- **simulate_credential_probe** — `dry_run_only`. Prints a `SIMULATED:` narrative only; the
  script itself performs zero real action even if a trusted instructor ran it directly (separate
  from the Agent Simulator's own dry-run gate). Telemetry: none — nothing real happens. Safe:
  no credentials, no network, ever.
- **beacon_to_decoy_endpoint** — `dry_run_only`. Prints a `SIMULATED:` narrative only. This
  library has no default external decoy destination (per `docs/safety.md`'s "never phones home
  to non-lab infra" rule), so rather than invent one, the capability stays synthetic. Telemetry:
  none. Safe: no network traffic, ever.

## What the Agent Simulator expects from each result

Every call returns a `ToolResult`-shaped object: `{ status, result, target, mode, extra }`.
`result` is kept short (bounded by each tool's `max_result_bytes`, then summarized to ~200 chars)
since it's what the LLM sees on its next turn; full stdout is available under `extra.stdout` for
anything needing more detail. `mode` is `"dry_run"` or `"live"` so the caller always knows which
path executed. No new telemetry schema is introduced anywhere — live scripts keep emitting the
existing `CR-SCRIPT-ID` / `CR-RUN-ID` / `CR-MARKER:` lines that the existing QRadar pipeline
already knows how to find.

## Adapter dispatch keys

`handler.ref` in `agent-tools/catalog.json` equals the tool's `tool_name` exactly (e.g.
`check_disk_space`). The adapter converts that to a script path via
`scripts/ai-agent/<tool_name-with-hyphens>.ps1` (Windows) or `-linux.sh` (everywhere else), so the
dispatch key and the script id are always derivable from one another — no separate mapping table
to keep in sync.
