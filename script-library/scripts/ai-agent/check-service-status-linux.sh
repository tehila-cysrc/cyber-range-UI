#!/usr/bin/env bash
# id: check-service-status-linux
# name: Check service status (AI agent, Linux)
# description: Reports the status of the allowlisted default service (nginx), read-only. Same default as infra-restart-service-linux.
# expected_result: Service status printed with marker.
# target_os: linux
# script_type: bash
# category: ai-agent
# required_permissions: none (read-only status)
# expected_logs: none (stdout only)
# qradar_visibility: none directly
# complexity: basic
# status: implemented
# mvp: false
# auto_inject_candidate: false

set -u
SERVICE_NAME=nginx
RUN_ID=$(date +%s)-$$
echo "CR-SCRIPT-ID=check-service-status-linux"
echo "CR-RUN-ID=$RUN_ID"
echo "CR-MARKER:check-service-status-linux:$RUN_ID"
echo "SERVICE=$SERVICE_NAME"

if command -v systemctl >/dev/null 2>&1; then
  STATUS=$(systemctl is-active "$SERVICE_NAME" 2>/dev/null || echo "unknown")
else
  STATUS="systemctl not available"
fi
echo "STATUS=$STATUS"

exit 0
