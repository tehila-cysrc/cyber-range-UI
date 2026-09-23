#!/usr/bin/env bash
# id: read-local-log-tail-linux
# name: Read local log tail (AI agent, Linux)
# description: Prints the most recent 20 lines of the system journal/syslog. Safe read-only check.
# expected_result: Up to 20 recent log lines printed with marker.
# target_os: linux
# script_type: bash
# category: ai-agent
# required_permissions: none (read access to journal/syslog)
# expected_logs: none produced (read-only)
# qradar_visibility: none directly
# complexity: basic
# status: implemented
# mvp: false
# auto_inject_candidate: false

set -u
RUN_ID=$(date +%s)-$$
echo "CR-SCRIPT-ID=read-local-log-tail-linux"
echo "CR-RUN-ID=$RUN_ID"
echo "CR-MARKER:read-local-log-tail-linux:$RUN_ID"

if command -v journalctl >/dev/null 2>&1 && journalctl -n 20 --no-pager >/tmp/.cr-log-tail-check 2>/dev/null; then
  cat /tmp/.cr-log-tail-check
  rm -f /tmp/.cr-log-tail-check
elif [ -r /var/log/syslog ]; then
  tail -n 20 /var/log/syslog
elif [ -r /var/log/messages ]; then
  tail -n 20 /var/log/messages
else
  echo "RESULT=no readable local log found"
fi

exit 0
