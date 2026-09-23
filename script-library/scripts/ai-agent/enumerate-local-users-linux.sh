#!/usr/bin/env bash
# id: enumerate-local-users-linux
# name: Enumerate local users (AI agent, Linux)
# description: Lists local human-range user account names from /etc/passwd (UID 1000-65533). Read-only, no shadow/password data touched.
# expected_result: Local user list printed with marker.
# target_os: linux
# script_type: bash
# category: ai-agent
# required_permissions: none (local read)
# expected_logs: none (stdout only)
# qradar_visibility: none directly
# complexity: basic
# status: implemented
# mvp: false
# auto_inject_candidate: false

set -u
RUN_ID=$(date +%s)-$$
echo "CR-SCRIPT-ID=enumerate-local-users-linux"
echo "CR-RUN-ID=$RUN_ID"
echo "CR-MARKER:enumerate-local-users-linux:$RUN_ID"

awk -F: '($3>=1000 && $3<65534) {print "USER name="$1}' /etc/passwd | head -n 25

exit 0
