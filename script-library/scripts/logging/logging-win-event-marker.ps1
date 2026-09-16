# id: logging-win-event-marker
# name: Write Windows Event Log marker
# description: Writes an Application Information event with CR-MARKER for pipeline validation.
# expected_result: Event visible in Application log; stdout prints marker.
# target_os: windows
# script_type: powershell
# category: logging
# required_permissions: ability to write Application log (elevated Run Command OK); creates source CyberRangeLab if missing
# expected_logs: Application log, Source CyberRangeLab, includes CR-MARKER
# qradar_visibility: Windows Event Log / WinCollect — Message contains CR-MARKER:logging-win-event-marker
# complexity: basic
# status: implemented
# mvp: true
# auto_inject_candidate: true

$runId = [guid]::NewGuid().ToString('N').Substring(0, 12)
$source = 'CyberRangeLab'
$marker = "CR-MARKER:logging-win-event-marker:$runId"

if (-not [System.Diagnostics.EventLog]::SourceExists($source)) {
  New-EventLog -LogName Application -Source $source
}

Write-EventLog -LogName Application -Source $source -EventId 1000 -EntryType Information -Message "Cyber Range lab marker. $marker script=logging-win-event-marker"

Write-Output "CR-SCRIPT-ID=logging-win-event-marker"
Write-Output "CR-RUN-ID=$runId"
Write-Output $marker
Write-Output "LOG=Application SOURCE=$source EVENTID=1000"
exit 0
