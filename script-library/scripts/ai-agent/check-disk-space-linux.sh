#!/usr/bin/env bash
# id: check-disk-space-linux
# name: Check disk space (AI agent, Linux)
# description: Reports free/used space on the root filesystem. Safe read-only check.
# expected_result: Free/used space printed with marker.
# target_os: linux
# script_type: bash
# category: ai-agent
# required_permissions: none
# expected_logs: none (stdout only)
# qradar_visibility: none (health-style check)
# complexity: basic
# status: implemented
# mvp: false
# auto_inject_candidate: false

set -u
RUN_ID=$(date +%s)-$$
echo "CR-SCRIPT-ID=check-disk-space-linux"
echo "CR-RUN-ID=$RUN_ID"
echo "CR-MARKER:check-disk-space-linux:$RUN_ID"

df -h / | tail -n +2 | while read -r fs size used avail pct mount; do
  echo "VOLUME fs=$fs size=$size used=$used avail=$avail pct=$pct mount=$mount"
done

exit 0
