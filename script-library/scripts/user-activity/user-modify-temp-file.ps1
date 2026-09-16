# id: user-modify-temp-file
# name: Modify lab file (user activity)
# description: Appends a line to the newest file in the lab activity folder (or creates one).
# expected_result: Append succeeded; marker printed.
# target_os: windows
# script_type: powershell
# category: user-activity
# required_permissions: write C:\CyberRange\Lab
# expected_logs: File modify / Sysmon if enabled
# qradar_visibility: FIM modify events if onboarded
# complexity: basic
# status: implemented
# mvp: true

$runId = [guid]::NewGuid().ToString('N').Substring(0, 12)
$dir = 'C:\CyberRange\Lab\activity'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$latest = Get-ChildItem -Path $dir -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $latest) {
  $path = Join-Path $dir "user-modify-seed-$runId.txt"
  Set-Content -Path $path -Value "seed" -Encoding UTF8
} else {
  $path = $latest.FullName
}
Add-Content -Path $path -Value "CR-MARKER:user-modify-temp-file:$runId modified=$(Get-Date -Format o)"

Write-Output "CR-SCRIPT-ID=user-modify-temp-file"
Write-Output "CR-RUN-ID=$runId"
Write-Output "CR-MARKER:user-modify-temp-file:$runId"
Write-Output "PATH=$path"
exit 0
