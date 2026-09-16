# id: admin-disable-local-user
# name: Disable newest cr-lab local user
# description: Disables the most recently created local user matching cr-lab-*. Safe lab-only.
# expected_result: User Disabled; Security 4725.
# target_os: windows
# script_type: powershell
# category: administrative
# required_permissions: local administrators
# expected_logs: Security 4725 account disabled
# qradar_visibility: EventID 4725, Account Name cr-lab-
# complexity: basic
# status: implemented
# mvp: true
# auto_inject_candidate: true

$runId = [guid]::NewGuid().ToString('N').Substring(0, 12)
Write-Output "CR-SCRIPT-ID=admin-disable-local-user"
Write-Output "CR-RUN-ID=$runId"
Write-Output "CR-MARKER:admin-disable-local-user:$runId"

$u = Get-LocalUser | Where-Object { $_.Name -like 'cr-lab-*' -and $_.Enabled } | Sort-Object Name -Descending | Select-Object -First 1
if (-not $u) {
  Write-Output "RESULT=no_enabled_cr-lab_user (run admin-create-local-user first)"
  exit 1
}

Disable-LocalUser -Name $u.Name
Write-Output "USERNAME=$($u.Name)"
Write-Output "RESULT=disabled"
exit 0
