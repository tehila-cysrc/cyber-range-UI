# id: health-dns-resolve
# name: Verify DNS resolution
# description: Resolves one or more hostnames and prints results. Safe read-only check.
# expected_result: Exit 0 if all names resolve; prints CR-MARKER and resolution lines.
# target_os: windows
# script_type: powershell
# category: basic-health
# required_permissions: none (network DNS)
# expected_logs: typically none (stdout only); optional Application marker if -WriteEvent
# qradar_visibility: usually none unless instructor also runs a logging marker; use for infra health not SIEM proof
# complexity: basic
# status: implemented
# mvp: true

param(
  [string[]]$Names = @('www.microsoft.com', 'login.microsoftonline.com')
)

$ErrorActionPreference = 'Continue'
$runId = [guid]::NewGuid().ToString('N').Substring(0, 12)
Write-Output "CR-SCRIPT-ID=health-dns-resolve"
Write-Output "CR-RUN-ID=$runId"
Write-Output "CR-MARKER:health-dns-resolve:$runId"

$failed = $false
foreach ($n in $Names) {
  try {
    $r = Resolve-DnsName -Name $n -ErrorAction Stop | Select-Object -First 3
    Write-Output "OK resolve $n -> $($r | ForEach-Object { $_.IPAddress -join ',' } | Select-Object -First 1)"
  } catch {
    Write-Output "FAIL resolve $n : $($_.Exception.Message)"
    $failed = $true
  }
}

if ($failed) { exit 1 }
exit 0
