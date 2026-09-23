# id: check-scheduled-tasks
# name: Check scheduled tasks (AI agent)
# description: Lists up to 20 scheduled tasks and their state. Read-only enumeration, creates nothing.
# expected_result: Task list printed with marker.
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
Write-Output "CR-SCRIPT-ID=check-scheduled-tasks"
Write-Output "CR-RUN-ID=$runId"
Write-Output "CR-MARKER:check-scheduled-tasks:$runId"

try {
  Get-ScheduledTask -ErrorAction Stop | Select-Object -First 20 TaskName, State | ForEach-Object {
    Write-Output "TASK name=$($_.TaskName) state=$($_.State)"
  }
  exit 0
} catch {
  Write-Output "RESULT=unable to enumerate: $($_.Exception.Message)"
  exit 0
}
