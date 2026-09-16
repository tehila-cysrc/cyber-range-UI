# id: health-internet-access
# name: Verify internet access
# description: DNS + HTTP probe as a single day-0 check.
# expected_result: Both DNS and HTTP succeed.
# target_os: windows
# script_type: powershell
# category: basic-health
# required_permissions: none
# expected_logs: none
# qradar_visibility: none
# complexity: basic
# status: implemented
# mvp: true

$runId = [guid]::NewGuid().ToString('N').Substring(0, 12)
Write-Output "CR-SCRIPT-ID=health-internet-access"
Write-Output "CR-RUN-ID=$runId"
Write-Output "CR-MARKER:health-internet-access:$runId"

$ok = $true
try {
  Resolve-DnsName www.microsoft.com -ErrorAction Stop | Out-Null
  Write-Output "DNS=OK"
} catch {
  Write-Output "DNS=FAIL"
  $ok = $false
}

try {
  $r = Invoke-WebRequest -Uri 'https://www.microsoft.com' -UseBasicParsing -TimeoutSec 20
  Write-Output "HTTP=$($r.StatusCode)"
} catch {
  Write-Output "HTTP=FAIL $($_.Exception.Message)"
  $ok = $false
}

if ($ok) { exit 0 }
exit 1
