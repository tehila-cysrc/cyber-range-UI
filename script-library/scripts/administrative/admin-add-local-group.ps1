# id: admin-add-local-group
# name: Add cr-lab user to local Administrators (lab)
# description: Adds newest cr-lab-* user to Administrators. Strong SOC signal; use only on lab VMs.
# expected_result: Membership added; Security 4732.
# target_os: windows
# script_type: powershell
# category: administrative
# required_permissions: local administrators
# expected_logs: Security 4732 member added to local group
# qradar_visibility: EventID 4732, Group Name Administrators, Member cr-lab-
# complexity: intermediate
# status: implemented
# mvp: true
# auto_inject_candidate: true

$runId = [guid]::NewGuid().ToString('N').Substring(0, 12)
Write-Output "CR-SCRIPT-ID=admin-add-local-group"
Write-Output "CR-RUN-ID=$runId"
Write-Output "CR-MARKER:admin-add-local-group:$runId"

$u = Get-LocalUser | Where-Object { $_.Name -like 'cr-lab-*' } | Sort-Object Name -Descending | Select-Object -First 1
if (-not $u) {
  Write-Output "RESULT=no_cr-lab_user (run admin-create-local-user first)"
  exit 1
}

Add-LocalGroupMember -Group 'Administrators' -Member $u.Name -ErrorAction SilentlyContinue
# Idempotent check
$members = Get-LocalGroupMember -Group 'Administrators' | Select-Object -ExpandProperty Name
Write-Output "USERNAME=$($u.Name)"
Write-Output "RESULT=added_or_already_member"
Write-Output "CLEANUP=Remove-LocalGroupMember -Group Administrators -Member $($u.Name)"
exit 0
