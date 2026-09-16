#!/usr/bin/env bash
# id: logging-write-custom-applog-linux
# name: Write custom application log line (Linux)
# description: Appends to /var/tmp/cyber-range/logs/app.log.
# expected_result: File contains marker.
# target_os: linux
# script_type: bash
# category: logging
# required_permissions: write /var/tmp
# expected_logs: custom app.log
# qradar_visibility: after custom log source — CR-MARKER:logging-write-custom-applog-linux
# complexity: basic
# status: implemented
# mvp: true

set -euo pipefail
RUN_ID=$(date +%s)-$$
DIR=/var/tmp/cyber-range/logs
mkdir -p "$DIR"
PATH_OUT="$DIR/app.log"
LINE="$(date -Iseconds) CR-MARKER:logging-write-custom-applog-linux:$RUN_ID host=$(hostname)"
echo "$LINE" >>"$PATH_OUT"
echo "CR-SCRIPT-ID=logging-write-custom-applog-linux"
echo "CR-RUN-ID=$RUN_ID"
echo "CR-MARKER:logging-write-custom-applog-linux:$RUN_ID"
echo "PATH=$PATH_OUT"
