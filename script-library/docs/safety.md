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

## Conventions

1. Every script prints a clear `CR-SCRIPT-ID=<id>` and `CR-RUN-ID=<uuid-or-timestamp>` line to stdout.
2. Marker strings use prefix `CR-MARKER:` so QRadar AQL can search them.
3. Prefer parameters at the top of the file (`$TargetHost`, `$ServiceName`) — instructors edit before Run, or future inject params.
4. Prefer reversible actions; document cleanup in the script header.
5. PowerShell for Windows nodes; Bash for Linux nodes. Never mix OS in one file.
