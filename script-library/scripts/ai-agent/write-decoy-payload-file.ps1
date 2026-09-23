# id: write-decoy-payload-file
# name: Write decoy payload file (AI agent, adversarial-simulated)
# description: Writes a harmless marker file to a FIXED, overwritten filename under the lab scratch directory. Not timestamped — repeated calls never accumulate files.
# expected_result: File exists at the fixed path; path printed with marker.
# target_os: windows
# script_type: powershell
# category: ai-agent
# required_permissions: local write to C:\CyberRange\Lab (created if missing; Run Command is elevated)
# expected_logs: File System / Sysmon FileCreate-or-Modify if enabled
# qradar_visibility: if FIM/Sysmon onboarded — File Create/Modify with path containing CyberRange\Lab\agent-activity
# complexity: basic
# status: implemented
# mvp: false
# auto_inject_candidate: false

# Fixed, overwritten filename — do not timestamp. Bounded disk usage regardless of call count.
$dir = 'C:\CyberRange\Lab\agent-activity\scratch'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$path = Join-Path $dir 'decoy-payload.txt'

$runId = [guid]::NewGuid().ToString('N').Substring(0, 12)
@(
  "CR-MARKER:write-decoy-payload-file:$runId"
  "note=harmless decoy marker file, no real payload"
  "written=$(Get-Date -Format o)"
  "host=$env:COMPUTERNAME"
) | Set-Content -Path $path -Encoding UTF8

Write-Output "CR-SCRIPT-ID=write-decoy-payload-file"
Write-Output "CR-RUN-ID=$runId"
Write-Output "CR-MARKER:write-decoy-payload-file:$runId"
Write-Output "PATH=$path"
exit 0
