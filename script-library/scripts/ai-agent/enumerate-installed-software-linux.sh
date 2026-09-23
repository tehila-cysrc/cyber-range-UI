#!/usr/bin/env bash
# id: enumerate-installed-software-linux
# name: Enumerate installed software (AI agent, Linux)
# description: Lists up to 25 installed packages via dpkg or rpm. Read-only.
# expected_result: Package list printed with marker.
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
echo "CR-SCRIPT-ID=enumerate-installed-software-linux"
echo "CR-RUN-ID=$RUN_ID"
echo "CR-MARKER:enumerate-installed-software-linux:$RUN_ID"

if command -v dpkg >/dev/null 2>&1; then
  dpkg -l 2>/dev/null | awk '/^ii/ {print "SOFTWARE name="$2" version="$3}' | head -n 25
elif command -v rpm >/dev/null 2>&1; then
  rpm -qa | head -n 25 | while read -r pkg; do echo "SOFTWARE name=$pkg"; done
else
  echo "RESULT=no package manager available"
fi

exit 0
