# id: check-service-status
# name: Check service status (AI agent)
# description: Reports the status of the allowlisted default service (Spooler), read-only. Same default as infra-restart-service.
# expected_result: Service status printed with marker.
# target_os: windows
# script_type: powershell
# category: ai-agent
# required_permissions: none (read-only status)
# expected_logs: none (stdout only)
# qradar_visibility: none directly
# complexity: basic
# status: implemented
# mvp: false
# auto_inject_candidate: false

$ServiceName = 'Spooler'
$runId = [guid]::NewGuid().ToString('N').Substring(0, 12)
Write-Output "CR-SCRIPT-ID=check-service-status"
Write-Output "CR-RUN-ID=$runId"
Write-Output "CR-MARKER:check-service-status:$runId"
Write-Output "SERVICE=$ServiceName"

try {
  $s = Get-Service -Name $ServiceName -ErrorAction Stop
  Write-Output "STATUS=$($s.Status)"
  exit 0
} catch {
  Write-Output "RESULT=fail $($_.Exception.Message)"
  exit 1
}
