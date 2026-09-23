#!/usr/bin/env bash
# id: write-decoy-payload-file-linux
# name: Write decoy payload file (AI agent, Linux, adversarial-simulated)
# description: Writes a harmless marker file to a FIXED, overwritten filename under the lab scratch directory. Not timestamped — repeated calls never accumulate files.
# expected_result: File exists at the fixed path; path printed with marker.
# target_os: linux
# script_type: bash
# category: ai-agent
# required_permissions: write to /var/tmp
# expected_logs: auditd/FIM if enabled
# qradar_visibility: file create/modify only if FIM onboarded
# complexity: basic
# status: implemented
# mvp: false
# auto_inject_candidate: false

set -euo pipefail
# Fixed, overwritten filename — do not timestamp. Bounded disk usage regardless of call count.
DIR=/var/tmp/cyber-range/agent-activity/scratch
mkdir -p "$DIR"
PATH_OUT="$DIR/decoy-payload.txt"

RUN_ID=$(date +%s)-$$
{
  echo "CR-MARKER:write-decoy-payload-file-linux:$RUN_ID"
  echo "note=harmless decoy marker file, no real payload"
  echo "written=$(date -Iseconds)"
  echo "host=$(hostname)"
} >"$PATH_OUT"

echo "CR-SCRIPT-ID=write-decoy-payload-file-linux"
echo "CR-RUN-ID=$RUN_ID"
echo "CR-MARKER:write-decoy-payload-file-linux:$RUN_ID"
echo "PATH=$PATH_OUT"
