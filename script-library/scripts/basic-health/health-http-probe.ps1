# id: health-http-probe
# name: Verify HTTP(S) endpoint reachable
# description: Performs GET against a URL and reports status code. No auth bypass.
# expected_result: HTTP status printed; exit 0 for 2xx/3xx.
# target_os: windows
# script_type: powershell
# category: basic-health
# required_permissions: none (outbound HTTP)
# expected_logs: none by default
# qradar_visibility: none (health); pair with web scripts for app logs
# complexity: basic
# status: implemented
# mvp: true

param(
  [string]$Url = 'https://www.microsoft.com'
)

$runId = [guid]::NewGuid().ToString('N').Substring(0, 12)
Write-Output "CR-SCRIPT-ID=health-http-probe"
Write-Output "CR-RUN-ID=$runId"
Write-Output "CR-MARKER:health-http-probe:$runId"
Write-Output "URL=$Url"

try {
  $resp = Invoke-WebRequest -Uri $Url -Method GET -UseBasicParsing -TimeoutSec 20 -MaximumRedirection 5
  Write-Output "STATUS=$($resp.StatusCode)"
  if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 400) { exit 0 }
  exit 1
} catch {
  Write-Output "FAIL $($_.Exception.Message)"
  exit 1
}
