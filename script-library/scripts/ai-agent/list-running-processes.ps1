# id: list-running-processes
# name: List running processes (AI agent)
# description: Lists the top processes by CPU on this host. Safe read-only inspection.
# expected_result: Process list printed with marker.
# target_os: windows
# script_type: powershell
# category: ai-agent
# required_permissions: none
# expected_logs: none (stdout only)
# qradar_visibility: none directly; useful as host context around other events
# complexity: basic
# status: implemented
# mvp: false
# auto_inject_candidate: false

$runId = [guid]::NewGuid().ToString('N').Substring(0, 12)
Write-Output "CR-SCRIPT-ID=list-running-processes"
Write-Output "CR-RUN-ID=$runId"
Write-Output "CR-MARKER:list-running-processes:$runId"

Get-Process | Sort-Object -Property CPU -Descending | Select-Object -First 15 Name, Id, CPU |
  ForEach-Object { Write-Output "PROC name=$($_.Name) pid=$($_.Id) cpu=$($_.CPU)" }

exit 0
