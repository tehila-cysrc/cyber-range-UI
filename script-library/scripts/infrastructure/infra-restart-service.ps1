# id: infra-restart-service
# name: Restart allowlisted service
# description: Restarts a parameterized Windows service (default: Spooler). Change -ServiceName for lab services only.
# expected_result: Service running after restart; System log service control events.
# target_os: windows
# script_type: powershell
# category: infrastructure
# required_permissions: local administrators
# expected_logs: System 7036/7040 service state; 7034 if unexpected stop
# qradar_visibility: Windows System — Service Control Manager events for the service name
# complexity: basic
# status: implemented
# mvp: true
# auto_inject_candidate: true

param(
  [string]$ServiceName = 'Spooler'
)

# Hard allowlist — extend carefully per range
$Allow = @('Spooler', 'W32Time', 'Themes')
$runId = [guid]::NewGuid().ToString('N').Substring(0, 12)
Write-Output "CR-SCRIPT-ID=infra-restart-service"
Write-Output "CR-RUN-ID=$runId"
Write-Output "CR-MARKER:infra-restart-service:$runId"
Write-Output "SERVICE=$ServiceName"

if ($Allow -notcontains $ServiceName) {
  Write-Output "RESULT=denied service not in allowlist ($($Allow -join ', '))"
  exit 1
}

try {
  Restart-Service -Name $ServiceName -Force -ErrorAction Stop
  $s = Get-Service -Name $ServiceName
  Write-Output "STATUS=$($s.Status)"
  exit 0
} catch {
  Write-Output "RESULT=fail $($_.Exception.Message)"
  exit 1
}
