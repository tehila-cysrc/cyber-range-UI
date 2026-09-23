#!/usr/bin/env bash
# id: check-local-time-sync-linux
# name: Check local time sync (AI agent, Linux)
# description: Queries system time sync status via timedatectl or chronyc. Safe read-only check.
# expected_result: Time sync status printed with marker.
# target_os: linux
# script_type: bash
# category: ai-agent
# required_permissions: none
# expected_logs: none (stdout only)
# qradar_visibility: none directly
# complexity: basic
# status: implemented
# mvp: false
# auto_inject_candidate: false

set -u
RUN_ID=$(date +%s)-$$
echo "CR-SCRIPT-ID=check-local-time-sync-linux"
echo "CR-RUN-ID=$RUN_ID"
echo "CR-MARKER:check-local-time-sync-linux:$RUN_ID"

if command -v timedatectl >/dev/null 2>&1; then
  timedatectl status
elif command -v chronyc >/dev/null 2>&1; then
  chronyc tracking
else
  echo "RESULT=no time sync tool available"
fi

exit 0
