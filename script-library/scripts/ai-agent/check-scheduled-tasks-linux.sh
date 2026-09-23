#!/usr/bin/env bash
# id: check-scheduled-tasks-linux
# name: Check scheduled tasks (AI agent, Linux)
# description: Lists the current user crontab entries and /etc/cron.d file names. Read-only, creates nothing.
# expected_result: Cron entries/names printed with marker.
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
echo "CR-SCRIPT-ID=check-scheduled-tasks-linux"
echo "CR-RUN-ID=$RUN_ID"
echo "CR-MARKER:check-scheduled-tasks-linux:$RUN_ID"

echo "CRONTAB:"
crontab -l 2>/dev/null || echo "(none for current user)"
echo "CRON_D_FILES:"
ls -1 /etc/cron.d 2>/dev/null || echo "(none)"

exit 0
