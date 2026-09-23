# Safety rules for the Script Library

## Allowed

- Read-only connectivity checks (DNS, TCP, HTTP GET)
- Writing **marker** events to Event Log / syslog / a dedicated lab log file
- Creating/modifying files under a lab workspace (`C:\CyberRange\Lab` or `/var/log/cyber-range` / `/tmp/cyber-range`)
- Local or domain **lab** account create / disable / group add (named `cr-lab-*`)
- Start / stop / restart of **allowlisted** services (parameterized; default: Spooler / nginx on lab boxes only)
- Short, capped resource sims (max 30s, low intensity) — Intermediate+

## Forbidden

- Exploit payloads, reverse shells, C2 beacons
- Credential theft / dumping / hash scraping
- Ransomware / mass encryption / mass delete
- Disabling security products (Defender, EDR, firewall rules that open the world)
- Unbounded stress (fork bombs, fill-disk)
- Hard-coded production secrets

## AI Agent Simulator capability set (`scripts/ai-agent/`)

Additional notes specific to the 19 capabilities exposed to the external LLM-driven Agent
Simulator (see `../AGENT_SIMULATOR_INTEGRATION.md`) — the rules above still apply in full; these
are clarifications for that set:

- All 19 tools are **parameterless** — every target (service name, port list, decoy hostname,
  env-var allowlist, scratch-dir path) is hardcoded in the script, never passed in by the caller.
- Bounded, local-only network probes (loopback port checks, fixed internal hostname resolution)
  are allowed; scanning a range or accepting a caller-supplied host/port is not.
- Decoy scratch-dir writes (`write_decoy_payload_file`, `archive_scratch_directory`) use a
  **fixed, overwritten** filename, never timestamped, so repeated agent turns cannot accumulate
  files — this library still has no destructive/unbounded write capability.
- `simulate_credential_probe` and `beacon_to_decoy_endpoint` are `dry_run_only`: they print a
  `SIMULATED:` narrative and perform zero real action, regardless of caller. This library still
  has **no default external decoy destination** — the "never phones home to non-lab infra" rule
  above is why beaconing stays synthetic rather than pointed at a real address.

## Conventions

1. Every script prints a clear `CR-SCRIPT-ID=<id>` and `CR-RUN-ID=<uuid-or-timestamp>` line to stdout.
2. Marker strings use prefix `CR-MARKER:` so QRadar AQL can search them.
3. Prefer parameters at the top of the file (`$TargetHost`, `$ServiceName`) — instructors edit before Run, or future inject params.
4. Prefer reversible actions; document cleanup in the script header.
5. PowerShell for Windows nodes; Bash for Linux nodes. Never mix OS in one file.
