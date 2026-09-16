# id: qradar-win-pipeline-probe
# name: QRadar Windows pipeline probe
# description: Dual-write marker to Windows Application Event Log AND a dedicated probe log file for end-to-end QRadar validation.
# expected_result: Marker in Application log + C:\CyberRange\Lab\logs\qradar-probe.log
# target_os: windows
# script_type: powershell
# category: qradar
# required_permissions: elevated (event log + file write)
# expected_logs: Application CyberRangeLab; file qradar-probe.log
# qradar_visibility: MUST appear in QRadar within collection SLA — search CR-MARKER:qradar-win-pipeline-probe. Log sources: Windows Event Log and/or custom file.
# complexity: basic
# status: implemented
# mvp: true
# auto_inject_candidate: true

$runId = [guid]::NewGuid().ToString('N').Substring(0, 12)
$marker = "CR-MARKER:qradar-win-pipeline-probe:$runId"
$source = 'CyberRangeLab'

if (-not [System.Diagnostics.EventLog]::SourceExists($source)) {
  New-EventLog -LogName Application -Source $source
}
Write-EventLog -LogName Application -Source $source -EventId 1001 -EntryType Information -Message "QRadar pipeline probe. $marker"

$dir = 'C:\CyberRange\Lab\logs'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$probe = Join-Path $dir 'qradar-probe.log'
Add-Content -Path $probe -Value "$(Get-Date -Format o) $marker" -Encoding UTF8

Write-Output "CR-SCRIPT-ID=qradar-win-pipeline-probe"
Write-Output "CR-RUN-ID=$runId"
Write-Output $marker
Write-Output "SEARCH_IN_QRADAR=$marker"
Write-Output "PRODUCED=Application/EventId=1001; FILE=$probe"
Write-Output "LOG_SOURCE_EXPECTATION=Windows Event Log (WinCollect/Agent) and/or custom Log File Protocol on qradar-probe.log"
exit 0
