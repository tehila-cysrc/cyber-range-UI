# Planned Active Directory scripts (not implemented as code yet)
#
# Implement only against lab domain accounts (prefix cr-lab-), never production.

## ad-create-user (intermediate)
- Create AD user `cr-lab-<id>` in OU=Lab
- Expected logs: Security 4720 on DC
- QRadar: EventID 4720 from DC log source
- Permissions: Domain Admin / account operators on lab domain
- auto_inject_candidate: true (after live verify)

## ad-add-group-member (intermediate)
- Add `cr-lab-*` to a lab security group (e.g. CR-Lab-Analysts) — NOT Domain Admins by default
- Expected: 4728
- QRadar: 4728
- auto_inject_candidate: true

## ad-disable-user (basic)
- Disable `cr-lab-*`
- Expected: 4725
- auto_inject_candidate: true

## ad-reset-password (intermediate)
- Reset password for `cr-lab-*` only (script must enforce name prefix)
- Expected: 4724
- auto_inject_candidate: false until review

## ad-lockout-sim (basic) — careful
- Prefer simulating "user locked" narrative via disable + documentation, not real lockout storms
- Prefer: failed logons capped (max 3) against a decoy lab account if needed for 4625 practice
