# id: resolve-internal-hostname
# name: Resolve internal hostname (AI agent)
# description: Resolves a small fixed set of predefined internal-looking lab hostnames. Safe read-only DNS check.
# expected_result: Per-name resolution result printed with marker; failures are informational, not fatal.
# target_os: windows
# script_type: powershell
# category: ai-agent
# required_permissions: none (DNS query only)
# expected_logs: none (stdout only)
# qradar_visibility: DNS query telemetry if DNS logging/Sysmon DNS is onboarded
# complexity: basic
# status: implemented
# mvp: false
# auto_inject_candidate: false

$Names = @('dc01.lab.local', 'fileserver.lab.local', 'web01.lab.local')
$runId = [guid]::NewGuid().ToString('N').Substring(0, 12)
Write-Output "CR-SCRIPT-ID=resolve-internal-hostname"
Write-Output "CR-RUN-ID=$runId"
Write-Output "CR-MARKER:resolve-internal-hostname:$runId"

foreach ($n in $Names) {
  try {
    $r = Resolve-DnsName -Name $n -ErrorAction Stop | Select-Object -First 1
    Write-Output "OK resolve $n -> $($r.IPAddress)"
  } catch {
    Write-Output "FAIL resolve $n : $($_.Exception.Message)"
  }
}

exit 0
