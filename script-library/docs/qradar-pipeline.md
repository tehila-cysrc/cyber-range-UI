# QRadar validation expectations

Assumption for this catalog (adjust per your range): Windows Event Log / Linux syslog ship via agent or collector into QRadar log sources for lab VMs.

## Pipeline stages to prove

```
Instructor Run Script on VM
        ↓
OS / app produces log line or Event
        ↓
Agent / WinCollect / Syslog forwarder
        ↓
QRadar Event Collector
        ↓
QRadar Console search (AQL / Quick Search)
```

## Marker convention

Scripts emit a unique token:

```
CR-MARKER:<script-id>:<run-id>
```

Example search (adjust log source / field names to your DSM):

```
CR-MARKER:qradar-win-pipeline-probe
```

or AQL sketch:

```sql
SELECT * FROM events
WHERE UTF8(payload) ILIKE '%CR-MARKER:qradar-win-pipeline-probe%'
LAST 15 MINUTES
```

## Per-script expectations

Documented on each script under **QRadar visibility**. Minimum for MVP probes:

| Script | Where produced | Likely log source | What appears in QRadar |
| --- | --- | --- | --- |
| `logging-win-event-marker` | Windows Application log | Windows Event Log / WinCollect | Event with marker in Message |
| `logging-linux-syslog-marker` | `/var/log/syslog` or journal | Linux OS / Syslog | Line containing marker |
| `qradar-win-pipeline-probe` | Application Event Log + stdout | Same as above | Searchable `CR-MARKER:qradar-win-pipeline-probe:<id>` |
| `qradar-linux-pipeline-probe` | syslog `logger` + stdout | Syslog | Same pattern |

If the marker is on the VM but missing in QRadar within ~5–15 minutes, the fault is in collection — not in the scenario narrative.
