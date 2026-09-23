#!/usr/bin/env bash
# id: list-running-processes-linux
# name: List running processes (AI agent, Linux)
# description: Lists the top processes by CPU on this host. Safe read-only inspection.
# expected_result: Process list printed with marker.
# target_os: linux
# script_type: bash
# category: ai-agent
# required_permissions: none
# expected_logs: none (stdout only)
# qradar_visibility: none directly; useful as host context around other events
# complexity: basic
# status: implemented
# mvp: false
# auto_inject_candidate: false

set -u
RUN_ID=$(date +%s)-$$
echo "CR-SCRIPT-ID=list-running-processes-linux"
echo "CR-RUN-ID=$RUN_ID"
echo "CR-MARKER:list-running-processes-linux:$RUN_ID"

ps -eo pid,comm,pcpu --sort=-pcpu | tail -n +2 | head -n 15 | \
  while read -r pid comm pcpu; do echo "PROC name=$comm pid=$pid cpu=$pcpu"; done

exit 0
