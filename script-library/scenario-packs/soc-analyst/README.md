# SOC Analyst Pack

Ordered administrative trail for investigation practice (no exploits).

## Objectives

1. Detect new local account (4720)
2. Detect privilege group change (4732)
3. Detect scheduled task persistence (Task Scheduler / file drop)
4. Correlate optional service restart

## Inject sequence

| Order | Inject | Script | Suggested timing |
| ---: | --- | --- | --- |
| 1 | `inj-eventlog-breadcrumb` | `logging-win-event-marker` | T+2m (auto later) |
| 2 | `inj-new-local-account` | `admin-create-local-user` | T+5m |
| 3 | `inj-local-admin-group` | `admin-add-local-group` | T+12m |
| 4 | `inj-scheduled-task` | `admin-scheduled-task` | T+20m |
| 5 | `inj-service-restart` | `infra-restart-service` | T+25m |
| 6 | `inj-file-activity` | `user-create-temp-file` | T+30m |

## Expected QRadar / host evidence

- Application CyberRangeLab markers
- Security 4720, 4732
- Task `CR-Lab-Marker-*`
- SCM Spooler restart
- Files under `C:\CyberRange\Lab\activity`

## Auto-inject candidates later

Breadcrumb + file activity first; admin chain remains manual until trusted.
