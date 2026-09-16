#!/usr/bin/env bash
# id: health-http-probe-linux
# name: Verify HTTP(S) endpoint reachable (Linux)
# description: curl -sI against a URL; reports HTTP status.
# expected_result: Exit 0 for 2xx/3xx.
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
URL="${HEALTH_HTTP_URL:-https://www.microsoft.com}"
RUN_ID=$(date +%s)-$$
echo "CR-SCRIPT-ID=health-http-probe-linux"
echo "CR-RUN-ID=$RUN_ID"
echo "CR-MARKER:health-http-probe-linux:$RUN_ID"
echo "URL=$URL"

code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 -L "$URL" || echo "000")
echo "STATUS=$code"
case "$code" in
  2*|3*) exit 0 ;;
  *) exit 1 ;;
esac
