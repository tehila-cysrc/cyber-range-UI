# id: inspect-safe-environment-variables
# name: Inspect safe environment variables (AI agent, suspicious)
# description: Reads a tight allowlist of non-sensitive environment variables. Never touches anything containing secrets/keys/tokens.
# expected_result: Allowlisted variable values printed with marker.
# target_os: windows
# script_type: powershell
# category: ai-agent
# required_permissions: none
# expected_logs: none (stdout only)
# qradar_visibility: none directly
# complexity: basic
# status: implemented
# mvp: false
# auto_inject_candidate: false

# Hardcoded allowlist — never add variables that could contain secrets/keys/tokens/passwords.
$Allow = @('COMPUTERNAME', 'OS', 'NUMBER_OF_PROCESSORS', 'USERDOMAIN', 'PROCESSOR_ARCHITECTURE')
$runId = [guid]::NewGuid().ToString('N').Substring(0, 12)
Write-Output "CR-SCRIPT-ID=inspect-safe-environment-variables"
Write-Output "CR-RUN-ID=$runId"
Write-Output "CR-MARKER:inspect-safe-environment-variables:$runId"

foreach ($name in $Allow) {
  $value = [Environment]::GetEnvironmentVariable($name)
  Write-Output "ENV $name=$value"
}

exit 0
