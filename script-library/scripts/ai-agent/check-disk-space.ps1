# id: check-disk-space
# name: Check disk space (AI agent)
# description: Reports free/used space on local filesystem volumes. Safe read-only check.
# expected_result: Per-volume free/used space printed with marker.
# target_os: windows
# script_type: powershell
# category: ai-agent
# required_permissions: none
# expected_logs: none (stdout only)
# qradar_visibility: none (health-style check)
# complexity: basic
# status: implemented
# mvp: false
# auto_inject_candidate: false

$runId = [guid]::NewGuid().ToString('N').Substring(0, 12)
Write-Output "CR-SCRIPT-ID=check-disk-space"
Write-Output "CR-RUN-ID=$runId"
Write-Output "CR-MARKER:check-disk-space:$runId"

Get-PSDrive -PSProvider FileSystem | ForEach-Object {
  Write-Output "VOLUME name=$($_.Name) usedGB=$([math]::Round($_.Used/1GB,2)) freeGB=$([math]::Round($_.Free/1GB,2))"
}

exit 0
