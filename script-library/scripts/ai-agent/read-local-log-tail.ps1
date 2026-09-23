# id: read-local-log-tail
# name: Read local log tail (AI agent)
# description: Prints the most recent System event log entries (bounded to 20). Safe read-only check.
# expected_result: Up to 20 recent event log lines printed with marker.
# target_os: windows
# script_type: powershell
# category: ai-agent
# required_permissions: none (read Event Log)
# expected_logs: none produced (read-only)
# qradar_visibility: none directly
# complexity: basic
# status: implemented
# mvp: false
# auto_inject_candidate: false

$runId = [guid]::NewGuid().ToString('N').Substring(0, 12)
Write-Output "CR-SCRIPT-ID=read-local-log-tail"
Write-Output "CR-RUN-ID=$runId"
Write-Output "CR-MARKER:read-local-log-tail:$runId"

try {
  Get-WinEvent -LogName System -MaxEvents 20 -ErrorAction Stop | ForEach-Object {
    Write-Output "LOG time=$($_.TimeCreated.ToString('o')) id=$($_.Id) level=$($_.LevelDisplayName)"
  }
  exit 0
} catch {
  Write-Output "RESULT=no entries available: $($_.Exception.Message)"
  exit 0
}
