# id: enumerate-local-users
# name: Enumerate local users (AI agent)
# description: Lists local user account names and enabled state. Read-only, no credentials touched.
# expected_result: Local user list printed with marker.
# target_os: windows
# script_type: powershell
# category: ai-agent
# required_permissions: none (local read)
# expected_logs: none (stdout only)
# qradar_visibility: none directly
# complexity: basic
# status: implemented
# mvp: false
# auto_inject_candidate: false

$runId = [guid]::NewGuid().ToString('N').Substring(0, 12)
Write-Output "CR-SCRIPT-ID=enumerate-local-users"
Write-Output "CR-RUN-ID=$runId"
Write-Output "CR-MARKER:enumerate-local-users:$runId"

try {
  Get-LocalUser -ErrorAction Stop | Select-Object -First 25 Name, Enabled | ForEach-Object {
    Write-Output "USER name=$($_.Name) enabled=$($_.Enabled)"
  }
  exit 0
} catch {
  Write-Output "RESULT=unable to enumerate: $($_.Exception.Message)"
  exit 0
}
