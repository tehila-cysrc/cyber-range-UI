#!/usr/bin/env bash
# id: cloud-az-vm-metadata-linux
# name: Read Azure IMDS (Linux, safe)
# description: curl Azure IMDS compute metadata — no state change.
# expected_result: prints name / resourceGroupName / vmId
# target_os: linux
# script_type: bash
# category: cloud
# required_permissions: none
# expected_logs: none
# qradar_visibility: none
# complexity: basic
# status: implemented
# mvp: true

set -u
RUN_ID=$(date +%s)-$$
echo "CR-SCRIPT-ID=cloud-az-vm-metadata-linux"
echo "CR-RUN-ID=$RUN_ID"
echo "CR-MARKER:cloud-az-vm-metadata-linux:$RUN_ID"

BODY=$(curl -sS -H Metadata:true --max-time 5 \
  'http://169.254.169.254/metadata/instance/compute?api-version=2021-02-01' || true)
if [ -z "$BODY" ]; then
  echo "RESULT=fail_not_azure_or_imds_blocked"
  exit 1
fi
echo "$BODY" | head -c 2000
echo
exit 0
