# id: logging-write-custom-applog
# name: Write custom application log line
# description: Appends a UTF-8 line to C:\CyberRange\Lab\logs\app.log for custom log-source onboarding tests.
# expected_result: File contains marker line.
# target_os: windows
# script_type: powershell
# category: logging
# required_permissions: write C:\CyberRange\Lab\logs
# expected_logs: custom file app.log
# qradar_visibility: only after a custom log source / Log File Protocol points at this path — search CR-MARKER:logging-write-custom-applog
# complexity: basic
# status: implemented
# mvp: true

$runId = [guid]::NewGuid().ToString('N').Substring(0, 12)
$dir = 'C:\CyberRange\Lab\logs'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$path = Join-Path $dir 'app.log'
$line = "$(Get-Date -Format o) CR-MARKER:logging-write-custom-applog:$runId host=$env:COMPUTERNAME"
Add-Content -Path $path -Value $line -Encoding UTF8

Write-Output "CR-SCRIPT-ID=logging-write-custom-applog"
Write-Output "CR-RUN-ID=$runId"
Write-Output "CR-MARKER:logging-write-custom-applog:$runId"
Write-Output "PATH=$path"
exit 0
