# Implementation priorities

## Build first (MVP — implement as real files)

These give immediate Instructor Console value and validate the QRadar pipeline.

| Priority | ID | Category | Why |
| --- | ---: | --- | --- |
| P0 | `logging-win-event-marker` | logging | Proves Windows → agent → QRadar |
| P0 | `logging-linux-syslog-marker` | logging | Proves Linux → agent → QRadar |
| P0 | `qradar-win-pipeline-probe` | qradar | End-to-end search token |
| P0 | `qradar-linux-pipeline-probe` | qradar | End-to-end search token |
| P0 | `health-dns-resolve` | basic-health | Day-0 connectivity |
| P0 | `health-http-probe` | basic-health | Web reachability |
| P0 | `health-tcp-port-probe` | basic-health | DC / DB / SMB ports |
| P1 | `user-create-temp-file` | user-activity | File audit trail |
| P1 | `user-modify-temp-file` | user-activity | File change audit |
| P1 | `admin-create-local-user` | administrative | Account creation events |
| P1 | `admin-disable-local-user` | administrative | Account disable events |
| P1 | `admin-add-local-group` | administrative | Group membership |
| P1 | `infra-restart-service` | infrastructure | Service control events |
| P1 | `logging-write-custom-applog` | logging | App log path check |

## Next (v1 — after MVP works live)

| ID | Category | Notes |
| --- | --- | --- |
| `health-smb-share` | basic-health | Needs share path param |
| `health-ldap-bind` | basic-health | Needs DC hostname |
| `admin-scheduled-task` | administrative | Strong SOC signal |
| `admin-create-service` | administrative | Strong SOC signal |
| `ad-create-user` | active-directory | Domain-joined only |
| `ad-add-group-member` | active-directory | Domain-joined only |
| `ad-reset-password` | administrative / AD | Reversible lab account only |
| `infra-start-stop-service` | infrastructure | Pair with restart |
| `web-http-login-success` | web | Against lab app URL |
| `web-http-login-fail` | web | Against lab app URL |
| `cloud-az-vm-metadata` | cloud | Azure IMDS only (safe) |

## Later (v2+)

- Disk / CPU / memory **gentle** load sims (time-boxed, capped)
- Web upload / API sequence generators against lab apps
- Automatic timed injects (elapsed_seconds) wiring into product
- Student-visible objective checklist (no auto-hints)

## Good automatic-inject candidates (future Scenario Engine)

Safe to fire on a timer **after** instructor Start, once MVP scripts are verified in QRadar:

1. `qradar-*-pipeline-probe` — pipeline health at T+2m
2. `admin-create-local-user` — SOC Analyst pack beat 1
3. `admin-add-local-group` — beat 2
4. `admin-scheduled-task` — beat 3
5. `infra-restart-service` — beat 4
6. `logging-win-event-marker` — correlation breadcrumb

Do **not** auto-fire AD password resets or service installs until reviewed per range.

## Do not build (out of scope for this library)

- Exploit / Metasploit / brute-force / malware emulation
- Credential dumping, LSASS, Mimikatz-style tools
- Destructive disk wipe, ransomware encryption sims
- Unbounded CPU/memory stress
- Anything that phones home to non-lab infrastructure
