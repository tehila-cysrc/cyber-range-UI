# Beginner Pack

Very light narrative for first-time SOC / helpdesk-style investigation.

## Objectives (instructor checklist — not auto-graded)

1. Confirm a connectivity/DNS symptom was checked or observed
2. Find a service restart in System logs
3. Find a disabled/locked user account event (4725)

## Inject sequence (manual fire order)

| Order | Inject | Script | Suggested gap |
| ---: | --- | --- | --- |
| 1 | `inj-dns-health-check` | `health-dns-resolve` | T+0 (baseline or fail demo) |
| 2 | `inj-service-restart` | `infra-restart-service` | T+10m |
| 3 | `inj-new-local-account` | `admin-create-local-user` | T+15m (setup for disable) |
| 4 | `inj-disable-user` | `admin-disable-local-user` | T+20m |

## Student observations

- DNS stdout / ops symptoms
- Spooler SCM events
- 4720 then 4725 for `cr-lab-*`

## Instructor notes

Keep verbal story simple: "users report print issues and one account locked." No malware narrative.
