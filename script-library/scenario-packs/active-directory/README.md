# Active Directory Pack

Legitimate AD operations for investigation (domain-joined lab only).

## Status

- Implemented now: `health-ldap-probe` (+ inject can reuse `health-tcp-port-probe` toward DC)
- Planned scripts: see `scripts/active-directory/PLANNED.md`

## Target sequence (when AD scripts are implemented)

| Order | Action | Expected EventIDs |
| ---: | --- | --- |
| 1 | LDAP/TCP health to DC | — |
| 2 | Create `cr-lab-*` AD user | 4720 on DC |
| 3 | Add to lab group (not Domain Admins) | 4728 |
| 4 | Disable user | 4725 |
| 5 | Optional single failed logon for 4625 practice | 4625 (capped) |

## Inject placeholders

Until AD scripts land, instructors can:

1. Run `health-ldap-probe` / `health-tcp-port-probe` (port 389) against DC
2. Perform AD changes manually in lab and still use this pack as the **objective checklist**
