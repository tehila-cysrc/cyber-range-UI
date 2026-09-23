# id: check-local-time-sync
# name: Check local time sync (AI agent)
# description: Queries Windows Time service status. Safe read-only check.
# expected_result: w32tm status output printed with marker.
# target_os: windows
# script_type: powershell
# category: ai-agent
# required_permissions: none
# expected_logs: none (stdout only)
# qradar_visibility: none directly
# complexity: basic
# status: implemented
# mvp: false
# auto_inject_candidate: false

$runId = [guid]::NewGuid().ToString('N').Substring(0, 12)
Write-Output "CR-SCRIPT-ID=check-local-time-sync"
Write-Output "CR-RUN-ID=$runId"
Write-Output "CR-MARKER:check-local-time-sync:$runId"

try {
  $out = & w32tm /query /status 2>&1
  $out | ForEach-Object { Write-Output "TIMESYNC $_" }
  exit 0
} catch {
  Write-Output "RESULT=unable to query time sync: $($_.Exception.Message)"
  exit 0
}
