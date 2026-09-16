#!/usr/bin/env bash
# id: health-tcp-port-probe-linux
# name: Verify TCP port reachable (Linux)
# description: Uses bash /dev/tcp or nc to probe host:port.
# expected_result: Exit 0 if connect succeeds.
# target_os: linux
# script_type: bash
# category: basic-health
# required_permissions: none
# expected_logs: none
# qradar_visibility: none
# complexity: basic
# status: implemented
# mvp: true

set -u
HOST="${HEALTH_TCP_HOST:-127.0.0.1}"
PORT="${HEALTH_TCP_PORT:-22}"
RUN_ID=$(date +%s)-$$
echo "CR-SCRIPT-ID=health-tcp-port-probe-linux"
echo "CR-RUN-ID=$RUN_ID"
echo "CR-MARKER:health-tcp-port-probe-linux:$RUN_ID"
echo "TARGET=${HOST}:${PORT}"

if (echo >/dev/tcp/"$HOST"/"$PORT") >/dev/null 2>&1; then
  echo "TcpTestSucceeded=True"
  exit 0
fi
echo "TcpTestSucceeded=False"
exit 1
