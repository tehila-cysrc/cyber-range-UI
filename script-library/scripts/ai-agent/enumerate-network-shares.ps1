# id: enumerate-network-shares
# name: Enumerate network shares (AI agent, suspicious)
# description: Lists locally visible SMB shares on this host only. Read-only, no remote target.
# expected_result: Local share list printed with marker.
# target_os: windows
# script_type: powershell
# category: ai-agent
# required_permissions: none (local read)
# expected_logs: none (stdout only)
# qradar_visibility: none directly; flag if repeated alongside other recon tools in the same window
# complexity: basic
# status: implemented
# mvp: false
# auto_inject_candidate: false

$runId = [guid]::NewGuid().ToString('N').Substring(0, 12)
Write-Output "CR-SCRIPT-ID=enumerate-network-shares"
Write-Output "CR-RUN-ID=$runId"
Write-Output "CR-MARKER:enumerate-network-shares:$runId"

try {
  Get-SmbShare -ErrorAction Stop | ForEach-Object {
    Write-Output "SHARE name=$($_.Name) path=$($_.Path)"
  }
  exit 0
} catch {
  Write-Output "RESULT=unable to enumerate: $($_.Exception.Message)"
  exit 0
}
