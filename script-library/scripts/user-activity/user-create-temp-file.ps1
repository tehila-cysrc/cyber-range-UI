# id: user-create-temp-file
# name: Create lab file (user activity)
# description: Creates a timestamped file under C:\CyberRange\Lab\activity for file-audit practice.
# expected_result: File exists; path printed with marker.
# target_os: windows
# script_type: powershell
# category: user-activity
# required_permissions: local write to C:\CyberRange\Lab (created if missing; Run Command is elevated)
# expected_logs: File System / Sysmon FileCreate if enabled; otherwise file on disk for forensics
# qradar_visibility: if File Integrity / Sysmon onboarded — File Create with path containing CyberRange\Lab; else verify on host
# complexity: basic
# status: implemented
# mvp: true
# auto_inject_candidate: true

$runId = [guid]::NewGuid().ToString('N').Substring(0, 12)
$dir = 'C:\CyberRange\Lab\activity'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$path = Join-Path $dir "user-create-$runId.txt"
@(
  "CR-MARKER:user-create-temp-file:$runId"
  "created=$(Get-Date -Format o)"
  "host=$env:COMPUTERNAME"
) | Set-Content -Path $path -Encoding UTF8

Write-Output "CR-SCRIPT-ID=user-create-temp-file"
Write-Output "CR-RUN-ID=$runId"
Write-Output "CR-MARKER:user-create-temp-file:$runId"
Write-Output "PATH=$path"
exit 0
