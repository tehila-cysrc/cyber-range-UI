# id: repeated-failed-lookup-burst
# name: Repeated failed lookup burst (AI agent, suspicious)
# description: Resolves a small fixed set of deliberately nonexistent lab-style hostnames, twice each (6 lookups total, bounded). All failures are expected.
# expected_result: A burst of FAIL resolve lines printed with marker; this is the intended, successful outcome.
# target_os: windows
# script_type: powershell
# category: ai-agent
# required_permissions: none (DNS query only)
# expected_logs: none (stdout only)
# qradar_visibility: repeated NXDOMAIN / failed-resolution telemetry if DNS logging is onboarded
# complexity: basic
# status: implemented
# mvp: false
# auto_inject_candidate: false

# Hardcoded, bounded list of deliberately-nonexistent names — do not parameterize or expand unbounded.
$Names = @('nx1.lab.invalid', 'nx2.lab.invalid', 'nx3.lab.invalid')
$runId = [guid]::NewGuid().ToString('N').Substring(0, 12)
Write-Output "CR-SCRIPT-ID=repeated-failed-lookup-burst"
Write-Output "CR-RUN-ID=$runId"
Write-Output "CR-MARKER:repeated-failed-lookup-burst:$runId"

for ($round = 1; $round -le 2; $round++) {
  foreach ($n in $Names) {
    try {
      Resolve-DnsName -Name $n -ErrorAction Stop | Out-Null
      Write-Output "UNEXPECTED-OK resolve $n (round $round)"
    } catch {
      Write-Output "FAIL resolve $n (round $round)"
    }
  }
}

exit 0
