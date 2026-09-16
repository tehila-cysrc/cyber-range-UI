#!/usr/bin/env bash
# id: user-create-temp-file-linux
# name: Create lab file (Linux user activity)
# description: Creates a file under /var/tmp/cyber-range/activity.
# expected_result: File exists with marker line.
# target_os: linux
# script_type: bash
# category: user-activity
# required_permissions: write to /var/tmp
# expected_logs: auditd/sysmon-linux if enabled; else file on disk
# qradar_visibility: file create only if FIM onboarded
# complexity: basic
# status: implemented
# mvp: true
# auto_inject_candidate: true

set -euo pipefail
RUN_ID=$(date +%s)-$$
DIR=/var/tmp/cyber-range/activity
mkdir -p "$DIR"
PATH_OUT="$DIR/user-create-$RUN_ID.txt"
{
  echo "CR-MARKER:user-create-temp-file-linux:$RUN_ID"
  echo "created=$(date -Iseconds)"
  echo "host=$(hostname)"
} >"$PATH_OUT"
echo "CR-SCRIPT-ID=user-create-temp-file-linux"
echo "CR-RUN-ID=$RUN_ID"
echo "CR-MARKER:user-create-temp-file-linux:$RUN_ID"
echo "PATH=$PATH_OUT"
