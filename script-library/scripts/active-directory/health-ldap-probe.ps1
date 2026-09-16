# id: health-ldap-probe
# name: Verify LDAP/TCP to domain controller
# description: TCP 389/636 probe toward a DC hostname (edit -ComputerName). Does not bind with credentials.
# expected_result: TcpTestSucceeded for chosen port.
# target_os: windows
# script_type: powershell
# category: active-directory
# required_permissions: none
# expected_logs: none
# qradar_visibility: none (health)
# complexity: basic
# status: implemented
# mvp: true

param(
  [string]$ComputerName = 'dc01.lab.local',
  [int]$Port = 389
)

$runId = [guid]::NewGuid().ToString('N').Substring(0, 12)
Write-Output "CR-SCRIPT-ID=health-ldap-probe"
Write-Output "CR-RUN-ID=$runId"
Write-Output "CR-MARKER:health-ldap-probe:$runId"
Write-Output "TARGET=${ComputerName}:${Port}"

$r = Test-NetConnection -ComputerName $ComputerName -Port $Port -WarningAction SilentlyContinue
Write-Output "TcpTestSucceeded=$($r.TcpTestSucceeded)"
if ($r.TcpTestSucceeded) { exit 0 }
exit 1
