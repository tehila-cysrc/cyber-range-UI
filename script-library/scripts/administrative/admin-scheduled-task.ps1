# id: admin-scheduled-task
# name: Create lab scheduled task
# description: Creates a harmless scheduled task that writes a marker file once. Strong persistence signal for SOC.
# expected_result: Task CR-Lab-Marker-* exists; Operational scheduled-task events.
# target_os: windows
# script_type: powershell
# category: administrative
# required_permissions: local administrators
# expected_logs: Task Scheduler Operational 106/140; Security if audited
# qradar_visibility: Task Scheduler events; task name CR-Lab-Marker-
# complexity: intermediate
# status: implemented
# mvp: false
# auto_inject_candidate: true

$runId = [guid]::NewGuid().ToString('N').Substring(0, 8)
$taskName = "CR-Lab-Marker-$runId"
$dir = 'C:\CyberRange\Lab\activity'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$out = Join-Path $dir "scheduled-task-$runId.txt"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -Command `"Set-Content -Path '$out' -Value 'CR-MARKER:admin-scheduled-task:$runId'`""
$trigger = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(2))
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Description "CR-MARKER:admin-scheduled-task:$runId" -Force | Out-Null

Write-Output "CR-SCRIPT-ID=admin-scheduled-task"
Write-Output "CR-RUN-ID=$runId"
Write-Output "CR-MARKER:admin-scheduled-task:$runId"
Write-Output "TASK=$taskName"
Write-Output "CLEANUP=Unregister-ScheduledTask -TaskName $taskName -Confirm:`$false"
exit 0
