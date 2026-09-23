# id: query-decoy-destination
# name: Query decoy destination (AI agent, suspicious)
# description: HTTP GET against a single fixed, hardcoded internal lab decoy hostname. Not parameterized; failure to connect is a normal/expected outcome.
# expected_result: HTTP status or connection failure printed with marker; both are valid outcomes.
# target_os: windows
# script_type: powershell
# category: ai-agent
# required_permissions: none (outbound HTTP)
# expected_logs: none by default
# qradar_visibility: outbound request to an unusual/decoy destination name if proxy/firewall logging is onboarded
# complexity: basic
# status: implemented
# mvp: false
# auto_inject_candidate: false

# Hardcoded decoy destination — do not parameterize.
$Url = 'http://decoy.lab.local/'
$runId = [guid]::NewGuid().ToString('N').Substring(0, 12)
Write-Output "CR-SCRIPT-ID=query-decoy-destination"
Write-Output "CR-RUN-ID=$runId"
Write-Output "CR-MARKER:query-decoy-destination:$runId"
Write-Output "URL=$Url"

try {
  $resp = Invoke-WebRequest -Uri $Url -Method GET -UseBasicParsing -TimeoutSec 10 -MaximumRedirection 2
  Write-Output "STATUS=$($resp.StatusCode)"
} catch {
  Write-Output "RESULT=no response (expected for a decoy destination): $($_.Exception.Message)"
}

exit 0
