# id: admin-create-local-user
# name: Create lab local user
# description: Creates local user cr-lab-<runId> with a random password (not printed in full). Reversible lab account.
# expected_result: User exists; Security log 4720 (or equivalent).
# target_os: windows
# script_type: powershell
# category: administrative
# required_permissions: local administrators (Azure Run Command typically elevated)
# expected_logs: Security 4720 user created; 4738 if properties set
# qradar_visibility: Windows Security Authentication / Account Management — search EventID 4720 and username cr-lab-
# complexity: basic
# status: implemented
# mvp: true
# auto_inject_candidate: true

$runId = [guid]::NewGuid().ToString('N').Substring(0, 8)
$user = "cr-lab-$runId"
# Password meets complexity; not echoed fully
$plain = 'Cr!' + [guid]::NewGuid().ToString('N').Substring(0, 12) + '9a'
$secure = ConvertTo-SecureString $plain -AsPlainText -Force

Write-Output "CR-SCRIPT-ID=admin-create-local-user"
Write-Output "CR-RUN-ID=$runId"
Write-Output "CR-MARKER:admin-create-local-user:$runId"
Write-Output "USERNAME=$user"

try {
  New-LocalUser -Name $user -Password $secure -FullName "Cyber Range Lab User" -Description "CR-MARKER:admin-create-local-user:$runId" -PasswordNeverExpires:$false -ErrorAction Stop | Out-Null
  Write-Output "RESULT=created"
  Write-Output "CLEANUP=Remove-LocalUser -Name $user"
  exit 0
} catch {
  Write-Output "RESULT=fail $($_.Exception.Message)"
  exit 1
}
