#!/usr/bin/env bash
# id: simulate-privilege-check-linux
# name: Simulate privilege check (AI agent, Linux, adversarial-simulated)
# description: Checks whether the current process is running as root. Read-only, no elevation attempted.
# expected_result: IsRoot=True/False printed with marker.
# target_os: linux
# script_type: bash
# category: ai-agent
# required_permissions: none (read-only identity check)
# expected_logs: none (stdout only)
# qradar_visibility: none directly; a privilege check following recon tools is the suspicious signal, not this script alone
# complexity: basic
# status: implemented
# mvp: false
# auto_inject_candidate: false

set -u
RUN_ID=$(date +%s)-$$
echo "CR-SCRIPT-ID=simulate-privilege-check-linux"
echo "CR-RUN-ID=$RUN_ID"
echo "CR-MARKER:simulate-privilege-check-linux:$RUN_ID"

echo "USER=$(id -un 2>/dev/null || echo unknown)"
if [ "$(id -u)" = "0" ]; then
  echo "IsRoot=True"
else
  echo "IsRoot=False"
fi

exit 0
