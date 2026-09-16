# id: cloud-az-vm-metadata
# name: Read Azure IMDS (safe)
# description: Queries Azure Instance Metadata Service (local only) — proves Azure VM identity without changing state.
# expected_result: JSON snippet with vmId / name / resourceGroupName.
# target_os: windows
# script_type: powershell
# category: cloud
# required_permissions: none (localhost IMDS)
# expected_logs: none
# qradar_visibility: none (inventory/health for Azure pack)
# complexity: basic
# status: implemented
# mvp: true

$runId = [guid]::NewGuid().ToString('N').Substring(0, 12)
Write-Output "CR-SCRIPT-ID=cloud-az-vm-metadata"
Write-Output "CR-RUN-ID=$runId"
Write-Output "CR-MARKER:cloud-az-vm-metadata:$runId"

try {
  $h = @{ Metadata = 'true' }
  $compute = Invoke-RestMethod -Headers $h -Uri 'http://169.254.169.254/metadata/instance/compute?api-version=2021-02-01' -TimeoutSec 5
  Write-Output "name=$($compute.name)"
  Write-Output "resourceGroupName=$($compute.resourceGroupName)"
  Write-Output "vmId=$($compute.vmId)"
  Write-Output "location=$($compute.location)"
  exit 0
} catch {
  Write-Output "RESULT=fail_not_azure_or_imds_blocked $($_.Exception.Message)"
  exit 1
}
