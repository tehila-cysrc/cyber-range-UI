# id: beacon-to-decoy-endpoint
# name: Beacon to decoy endpoint (AI agent, adversarial-simulated, dry-run only)
# description: Prints a synthetic narrative describing a beacon/check-in attempt. Performs NO real network call — the library has no default external decoy destination, per this library's "never phones home to non-lab infra" rule.
# expected_result: SIMULATED narrative line printed with marker; no real network traffic of any kind.
# target_os: windows
# script_type: powershell
# category: ai-agent
# required_permissions: none
# expected_logs: none (stdout only; nothing real happens)
# qradar_visibility: none — this script never sends network traffic
# complexity: basic
# status: implemented
# mvp: false
# auto_inject_candidate: false

$runId = [guid]::NewGuid().ToString('N').Substring(0, 12)
Write-Output "CR-SCRIPT-ID=beacon-to-decoy-endpoint"
Write-Output "CR-RUN-ID=$runId"
Write-Output "CR-MARKER:beacon-to-decoy-endpoint:$runId"
Write-Output "SIMULATED: would send a small fixed check-in payload to a lab decoy endpoint. No real network traffic was sent (no default external destination is configured in this library)."

exit 0
