# id: enumerate-installed-software
# name: Enumerate installed software (AI agent)
# description: Lists up to 25 installed programs from the registry Uninstall keys. Read-only.
# expected_result: Software list printed with marker.
# target_os: windows
# script_type: powershell
# category: ai-agent
# required_permissions: none (local read)
# expected_logs: none (stdout only)
# qradar_visibility: none directly
# complexity: basic
# status: implemented
# mvp: false
# auto_inject_candidate: false

$runId = [guid]::NewGuid().ToString('N').Substring(0, 12)
Write-Output "CR-SCRIPT-ID=enumerate-installed-software"
Write-Output "CR-RUN-ID=$runId"
Write-Output "CR-MARKER:enumerate-installed-software:$runId"

try {
  Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction Stop |
    Where-Object { $_.DisplayName } |
    Select-Object -First 25 DisplayName, DisplayVersion |
    ForEach-Object { Write-Output "SOFTWARE name=$($_.DisplayName) version=$($_.DisplayVersion)" }
  exit 0
} catch {
  Write-Output "RESULT=unable to enumerate: $($_.Exception.Message)"
  exit 0
}
