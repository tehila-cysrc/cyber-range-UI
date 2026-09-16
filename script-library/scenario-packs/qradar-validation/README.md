# QRadar Validation Pack

Sole purpose: prove **VM → Agent/Collector → QRadar** before training content.

## Procedure

1. Pick a Windows lab VM with known log source in QRadar → fire `inj-qradar-win-probe`
2. Note `CR-RUN-ID` / full `CR-MARKER:...` from execution output
3. Within 5–15 minutes search QRadar for that exact marker
4. Repeat on Linux with `inj-qradar-linux-probe`
5. Optional: `logging-write-custom-applog*` only if custom file log source exists

## Pass criteria

| Check | Pass |
| --- | --- |
| Marker in host Event Log / syslog | Required |
| Marker in QRadar | Required for "pipeline green" |
| Marker in custom file only | Partial — file source not onboarded |

## Do not score students on this pack

This is instructor/range-ops validation.
