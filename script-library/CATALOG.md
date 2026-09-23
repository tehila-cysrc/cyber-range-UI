# Script Catalog (human index)

Legend: **MVP** = implement/use first · **I** = implemented file · **P** = planned

---

## basic-health

| ID | File | OS | Complexity | MVP | Status |
| --- | --- | --- | --- | --- | --- |
| health-dns-resolve | `scripts/basic-health/health-dns-resolve.ps1` | Windows | Basic | yes | I |
| health-dns-resolve-linux | `.../health-dns-resolve-linux.sh` | Linux | Basic | yes | I |
| health-http-probe | `.../health-http-probe.ps1` | Windows | Basic | yes | I |
| health-http-probe-linux | `.../health-http-probe-linux.sh` | Linux | Basic | yes | I |
| health-tcp-port-probe | `.../health-tcp-port-probe.ps1` | Windows | Basic | yes | I |
| health-tcp-port-probe-linux | `.../health-tcp-port-probe-linux.sh` | Linux | Basic | yes | I |
| health-internet-access | `.../health-internet-access.ps1` | Windows | Basic | yes | I |
| health-smb-share | — | Windows | Basic | no | P |
| health-db-tcp | use tcp probe :1433/:5432 | either | Basic | no | P (use tcp probe) |

### health-dns-resolve
- **Description:** Resolve hostnames (default Microsoft endpoints).
- **Expected result:** OK lines; exit 0.
- **Permissions:** none
- **Logs/events:** stdout only
- **QRadar:** none (health)

### health-tcp-port-probe
- **Description:** TCP connect to host:port (DC 389, SMB 445, SQL 1433, web 443).
- **Expected result:** `TcpTestSucceeded=True`
- **Permissions:** none
- **QRadar:** none

---

## user-activity

| ID | File | OS | Complexity | MVP | Status |
| --- | --- | --- | --- | --- | --- |
| user-create-temp-file | `scripts/user-activity/user-create-temp-file.ps1` | Windows | Basic | yes | I |
| user-create-temp-file-linux | `...-linux.sh` | Linux | Basic | yes | I |
| user-modify-temp-file | `.../user-modify-temp-file.ps1` | Windows | Basic | yes | I |
| user-folder-create | — | Windows | Basic | no | P |
| user-smb-list | — | Windows | Basic | no | P |
| user-launch-app | — | Windows | Basic | no | P |

### user-create-temp-file
- **Description:** Create marked file under `C:\CyberRange\Lab\activity`
- **Expected result:** PATH printed
- **Permissions:** write Lab folder (elevated RC OK)
- **Logs:** FIM/Sysmon if present
- **QRadar:** file create if FIM onboarded; else host forensics

---

## administrative

| ID | File | OS | Complexity | MVP | Auto-inject? | Status |
| --- | --- | --- | --- | --- | --- | --- |
| admin-create-local-user | `.../admin-create-local-user.ps1` | Windows | Basic | yes | yes | I |
| admin-disable-local-user | `.../admin-disable-local-user.ps1` | Windows | Basic | yes | yes | I |
| admin-add-local-group | `.../admin-add-local-group.ps1` | Windows | Intermediate | yes | yes | I |
| admin-scheduled-task | `.../admin-scheduled-task.ps1` | Windows | Intermediate | no | yes | I |
| admin-create-service | — | Windows | Intermediate | no | later | P |
| admin-reset-password | — | Windows | Intermediate | no | no | P |
| admin-install-software | — | Windows | Advanced | no | no | P (deferred) |

### admin-create-local-user
- **Description:** Create `cr-lab-<id>` local user
- **Expected result:** user exists; cleanup hint printed
- **Permissions:** local admin
- **Logs:** Security **4720**
- **QRadar:** Account Management / 4720 / `cr-lab-`

### admin-add-local-group
- **Description:** Add newest `cr-lab-*` to Administrators
- **Logs:** **4732**
- **QRadar:** 4732

### admin-scheduled-task
- **Description:** Task `CR-Lab-Marker-*` writes marker file in 2 minutes
- **Logs:** Task Scheduler Operational
- **QRadar:** task name search

---

## infrastructure

| ID | File | OS | Complexity | MVP | Status |
| --- | --- | --- | --- | --- | --- |
| infra-restart-service | `.../infra-restart-service.ps1` | Windows | Basic | yes | I |
| infra-restart-service-linux | `...-linux.sh` | Linux | Basic | yes | I |
| infra-start/stop-service | — | either | Basic | no | P |
| infra-cpu/mem/disk sims | — | either | Intermediate | no | P (capped only) |

### infra-restart-service
- **Description:** Restart allowlisted service (default Spooler)
- **Permissions:** local admin
- **Logs:** System SCM 7036/7040
- **QRadar:** Service Control Manager

---

## web

See `scripts/web/PLANNED.md` — all **P** until lab app URL known.

---

## logging

| ID | File | OS | Complexity | MVP | Status |
| --- | --- | --- | --- | --- | --- |
| logging-win-event-marker | `.../logging-win-event-marker.ps1` | Windows | Basic | yes | I |
| logging-linux-syslog-marker | `.../logging-linux-syslog-marker.sh` | Linux | Basic | yes | I |
| logging-write-custom-applog | `.../logging-write-custom-applog.ps1` | Windows | Basic | yes | I |
| logging-write-custom-applog-linux | `...-linux.sh` | Linux | Basic | yes | I |

### logging-win-event-marker
- **Produced:** Application / Source `CyberRangeLab` / EventID 1000
- **Log source:** Windows Event Log
- **QRadar:** Message contains `CR-MARKER:logging-win-event-marker`

---

## qradar

| ID | File | OS | Complexity | MVP | Status |
| --- | --- | --- | --- | --- | --- |
| qradar-win-pipeline-probe | `.../qradar-win-pipeline-probe.ps1` | Windows | Basic | yes | I |
| qradar-linux-pipeline-probe | `.../qradar-linux-pipeline-probe.sh` | Linux | Basic | yes | I |

### qradar-win-pipeline-probe
1. **Produced:** EventID 1001 Application + `qradar-probe.log`
2. **Where:** guest Windows VM
3. **Log source:** WinCollect/Agent (+ optional file)
4. **QRadar:** exact `CR-MARKER:qradar-win-pipeline-probe:<runId>`

---

## active-directory

| ID | File | Status |
| --- | --- | --- |
| health-ldap-probe | `scripts/active-directory/health-ldap-probe.ps1` | I (MVP) |
| ad-create-user / add-group / disable / reset | PLANNED.md | P |

---

## cloud

| ID | File | OS | MVP | Status |
| --- | --- | --- | --- | --- |
| cloud-az-vm-metadata | `scripts/cloud/cloud-az-vm-metadata.ps1` | Windows | yes | I |
| cloud-az-vm-metadata-linux | `...-linux.sh` | Linux | yes | I |

---

## ai-agent

Capabilities for the external LLM-driven Agent Simulator (separate repo). See
`AGENT_SIMULATOR_INTEGRATION.md` for the full tool table, classifications, and adapter dispatch
keys — this section is the human index of the underlying script files only.

**Sub-categories** (the actual `category` value in `catalog.json` / the `scripts` DB table / the
Instructor Console's category filter — split out so Normal/Suspicious/Adversarial are distinguishable
in the product UI, not just in this doc):

| DB/UI category | Classification | Count |
| --- | --- | --- |
| `ai-agent-normal` | Normal | 18 (9 tools × Windows/Linux) |
| `ai-agent-suspicious` | Suspicious | 10 (5 tools × Windows/Linux) |
| `ai-agent-adversarial` | Adversarial-simulated | 10 (5 tools × Windows/Linux) |

| ID | File | OS | Classification | Status |
| --- | --- | --- | --- | --- |
| list-running-processes | `scripts/ai-agent/list-running-processes.ps1` | Windows | Normal | I |
| list-running-processes-linux | `.../list-running-processes-linux.sh` | Linux | Normal | I |
| check-disk-space | `.../check-disk-space.ps1` | Windows | Normal | I |
| check-disk-space-linux | `.../check-disk-space-linux.sh` | Linux | Normal | I |
| read-local-log-tail | `.../read-local-log-tail.ps1` | Windows | Normal | I |
| read-local-log-tail-linux | `.../read-local-log-tail-linux.sh` | Linux | Normal | I |
| check-scheduled-tasks | `.../check-scheduled-tasks.ps1` | Windows | Normal | I |
| check-scheduled-tasks-linux | `.../check-scheduled-tasks-linux.sh` | Linux | Normal | I |
| check-service-status | `.../check-service-status.ps1` | Windows | Normal | I |
| check-service-status-linux | `.../check-service-status-linux.sh` | Linux | Normal | I |
| resolve-internal-hostname | `.../resolve-internal-hostname.ps1` | Windows | Normal | I |
| resolve-internal-hostname-linux | `.../resolve-internal-hostname-linux.sh` | Linux | Normal | I |
| check-local-time-sync | `.../check-local-time-sync.ps1` | Windows | Normal | I |
| check-local-time-sync-linux | `.../check-local-time-sync-linux.sh` | Linux | Normal | I |
| enumerate-local-users | `.../enumerate-local-users.ps1` | Windows | Normal | I |
| enumerate-local-users-linux | `.../enumerate-local-users-linux.sh` | Linux | Normal | I |
| enumerate-installed-software | `.../enumerate-installed-software.ps1` | Windows | Normal | I |
| enumerate-installed-software-linux | `.../enumerate-installed-software-linux.sh` | Linux | Normal | I |
| enumerate-network-shares | `.../enumerate-network-shares.ps1` | Windows | Suspicious | I |
| enumerate-network-shares-linux | `.../enumerate-network-shares-linux.sh` | Linux | Suspicious | I |
| probe-internal-service-ports | `.../probe-internal-service-ports.ps1` | Windows | Suspicious | I |
| probe-internal-service-ports-linux | `.../probe-internal-service-ports-linux.sh` | Linux | Suspicious | I |
| query-decoy-destination | `.../query-decoy-destination.ps1` | Windows | Suspicious | I |
| query-decoy-destination-linux | `.../query-decoy-destination-linux.sh` | Linux | Suspicious | I |
| repeated-failed-lookup-burst | `.../repeated-failed-lookup-burst.ps1` | Windows | Suspicious | I |
| repeated-failed-lookup-burst-linux | `.../repeated-failed-lookup-burst-linux.sh` | Linux | Suspicious | I |
| inspect-safe-environment-variables | `.../inspect-safe-environment-variables.ps1` | Windows | Suspicious | I |
| inspect-safe-environment-variables-linux | `.../inspect-safe-environment-variables-linux.sh` | Linux | Suspicious | I |
| simulate-privilege-check | `.../simulate-privilege-check.ps1` | Windows | Adversarial-simulated | I |
| simulate-privilege-check-linux | `.../simulate-privilege-check-linux.sh` | Linux | Adversarial-simulated | I |
| write-decoy-payload-file | `.../write-decoy-payload-file.ps1` | Windows | Adversarial-simulated | I |
| write-decoy-payload-file-linux | `.../write-decoy-payload-file-linux.sh` | Linux | Adversarial-simulated | I |
| archive-scratch-directory | `.../archive-scratch-directory.ps1` | Windows | Adversarial-simulated | I |
| archive-scratch-directory-linux | `.../archive-scratch-directory-linux.sh` | Linux | Adversarial-simulated | I |
| simulate-credential-probe | `.../simulate-credential-probe.ps1` | Windows | Adversarial-simulated (dry-run only) | I |
| simulate-credential-probe-linux | `.../simulate-credential-probe-linux.sh` | Linux | Adversarial-simulated (dry-run only) | I |
| beacon-to-decoy-endpoint | `.../beacon-to-decoy-endpoint.ps1` | Windows | Adversarial-simulated (dry-run only) | I |
| beacon-to-decoy-endpoint-linux | `.../beacon-to-decoy-endpoint-linux.sh` | Linux | Adversarial-simulated (dry-run only) | I |

---

## Injects

See `injects/*.yaml` — 10 injects defined.

## Scenario packs

| Pack | Path |
| --- | --- |
| Beginner | `scenario-packs/beginner/` |
| SOC Analyst | `scenario-packs/soc-analyst/` |
| Active Directory | `scenario-packs/active-directory/` (partial) |
| Azure | `scenario-packs/azure/` |
| QRadar Validation | `scenario-packs/qradar-validation/` |

---

## Priority recap

1. **First:** all `qradar-*` + `logging-*-marker` → prove pipeline  
2. **Then:** health probes → day-zero  
3. **Then:** admin-create/disable/group + infra-restart → Beginner + SOC packs  
4. **Then:** scheduled-task + file activity → richer SOC pack  
5. **Later:** AD domain scripts, web app scripts, capped resource sims  
6. **Future auto-injects:** breadcrumb, file activity, then admin chain once trusted  

See `PRIORITIES.md`.
