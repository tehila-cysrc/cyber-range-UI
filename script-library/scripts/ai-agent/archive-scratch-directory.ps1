# id: archive-scratch-directory
# name: Archive scratch directory (AI agent, adversarial-simulated)
# description: Zips the lab scratch directory to a FIXED, overwritten archive filename (sibling of the scratch dir, not inside it). Not timestamped — repeated calls never accumulate archive files.
# expected_result: Archive file exists at the fixed path; path printed with marker.
# target_os: windows
# script_type: powershell
# category: ai-agent
# required_permissions: local write to C:\CyberRange\Lab (created if missing; Run Command is elevated)
# expected_logs: File System / Sysmon FileCreate-or-Modify if enabled
# qradar_visibility: if FIM/Sysmon onboarded — File Create/Modify for the fixed archive path; a scratch-dir archive following file-write activity is the suspicious signal
# complexity: basic
# status: implemented
# mvp: false
# auto_inject_candidate: false

# Fixed, overwritten archive filename, placed OUTSIDE the directory it archives to avoid self-inclusion.
# Do not timestamp — bounded disk usage (exactly one archive file) regardless of call count.
$scratchDir = 'C:\CyberRange\Lab\agent-activity\scratch'
$archivePath = 'C:\CyberRange\Lab\agent-activity\scratch-archive.zip'

New-Item -ItemType Directory -Force -Path $scratchDir | Out-Null

$runId = [guid]::NewGuid().ToString('N').Substring(0, 12)
Write-Output "CR-SCRIPT-ID=archive-scratch-directory"
Write-Output "CR-RUN-ID=$runId"
Write-Output "CR-MARKER:archive-scratch-directory:$runId"

if (Test-Path $archivePath) { Remove-Item -Path $archivePath -Force }

$items = Get-ChildItem -Path $scratchDir -File -ErrorAction SilentlyContinue
if (-not $items -or $items.Count -eq 0) {
  # Nothing to archive yet — still produce a bounded, valid archive (marker file), never fail silently.
  $marker = Join-Path $scratchDir '.archive-marker'
  "CR-MARKER:archive-scratch-directory:$runId" | Set-Content -Path $marker -Encoding UTF8
}

Compress-Archive -Path (Join-Path $scratchDir '*') -DestinationPath $archivePath -Force
Write-Output "PATH=$archivePath"
exit 0
