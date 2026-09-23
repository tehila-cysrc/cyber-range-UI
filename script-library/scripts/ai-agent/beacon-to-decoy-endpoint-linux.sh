#!/usr/bin/env bash
# id: beacon-to-decoy-endpoint-linux
# name: Beacon to decoy endpoint (AI agent, Linux, adversarial-simulated, dry-run only)
# description: Prints a synthetic narrative describing a beacon/check-in attempt. Performs NO real network call — the library has no default external decoy destination, per this library's "never phones home to non-lab infra" rule.
# expected_result: SIMULATED narrative line printed with marker; no real network traffic of any kind.
# target_os: linux
# script_type: bash
# category: ai-agent
# required_permissions: none
# expected_logs: none (stdout only; nothing real happens)
# qradar_visibility: none — this script never sends network traffic
# complexity: basic
# status: implemented
# mvp: false
# auto_inject_candidate: false

set -u
RUN_ID=$(date +%s)-$$
echo "CR-SCRIPT-ID=beacon-to-decoy-endpoint-linux"
echo "CR-RUN-ID=$RUN_ID"
echo "CR-MARKER:beacon-to-decoy-endpoint-linux:$RUN_ID"
echo "SIMULATED: would send a small fixed check-in payload to a lab decoy endpoint. No real network traffic was sent (no default external destination is configured in this library)."

exit 0
