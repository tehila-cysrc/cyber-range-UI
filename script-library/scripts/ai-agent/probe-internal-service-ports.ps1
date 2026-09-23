# id: probe-internal-service-ports
# name: Probe internal service ports (AI agent, suspicious)
# description: TCP-connects to a small fixed set of ports on loopback only (445, 1433, 3389, 8080). Target and ports are hardcoded, not parameterized.
# expected_result: Per-port TcpTestSucceeded result printed with marker.
# target_os: windows
# script_type: powershell
# category: ai-agent
# required_permissions: none
# expected_logs: none (stdout only)
# qradar_visibility: none directly; a burst of local port probes can itself be a detection signal
# complexity: basic
# status: implemented
# mvp: false
# auto_inject_candidate: false

# Hardcoded, bounded target — do not parameterize. 127.0.0.1 only, fixed port list only.
$TargetHost = '127.0.0.1'
$Ports = @(445, 1433, 3389, 8080)

$runId = [guid]::NewGuid().ToString('N').Substring(0, 12)
Write-Output "CR-SCRIPT-ID=probe-internal-service-ports"
Write-Output "CR-RUN-ID=$runId"
Write-Output "CR-MARKER:probe-internal-service-ports:$runId"
Write-Output "TARGET=$TargetHost"

foreach ($p in $Ports) {
  $r = Test-NetConnection -ComputerName $TargetHost -Port $p -WarningAction SilentlyContinue
  Write-Output "PORT $p TcpTestSucceeded=$($r.TcpTestSucceeded)"
}

exit 0
