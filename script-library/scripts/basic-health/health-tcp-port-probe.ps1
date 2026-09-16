# id: health-tcp-port-probe
# name: Verify TCP port reachable
# description: Tests TCP connect to host:port (DC LDAP, SQL, SMB, web). Read-only.
# expected_result: Exit 0 if TcpTestSucceeded.
# target_os: windows
# script_type: powershell
# category: basic-health
# required_permissions: none
# expected_logs: none
# qradar_visibility: none (use for DC/DB/SMB health before scenarios)
# complexity: basic
# status: implemented
# mvp: true

param(
  [Parameter(Mandatory = $false)][string]$ComputerName = '127.0.0.1',
  [Parameter(Mandatory = $false)][int]$Port = 445
)

$runId = [guid]::NewGuid().ToString('N').Substring(0, 12)
Write-Output "CR-SCRIPT-ID=health-tcp-port-probe"
Write-Output "CR-RUN-ID=$runId"
Write-Output "CR-MARKER:health-tcp-port-probe:$runId"
Write-Output "TARGET=${ComputerName}:${Port}"

$r = Test-NetConnection -ComputerName $ComputerName -Port $Port -WarningAction SilentlyContinue
Write-Output "TcpTestSucceeded=$($r.TcpTestSucceeded)"
if ($r.TcpTestSucceeded) { exit 0 }
exit 1
