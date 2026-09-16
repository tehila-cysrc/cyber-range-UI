#!/usr/bin/env bash
# id: qradar-linux-pipeline-probe
# name: QRadar Linux pipeline probe
# description: Dual-write marker via logger AND /var/tmp/cyber-range/logs/qradar-probe.log.
# expected_result: syslog/journal + probe file contain marker.
# target_os: linux
# script_type: bash
# category: qradar
# required_permissions: root typical
# expected_logs: syslog + qradar-probe.log
# qradar_visibility: search CR-MARKER:qradar-linux-pipeline-probe — Linux OS Syslog and/or custom file log source
# complexity: basic
# status: implemented
# mvp: true
# auto_inject_candidate: true

set -euo pipefail
RUN_ID=$(date +%s)-$$
MARKER="CR-MARKER:qradar-linux-pipeline-probe:$RUN_ID"
logger -t CyberRangeLab "QRadar pipeline probe $MARKER"
DIR=/var/tmp/cyber-range/logs
mkdir -p "$DIR"
PROBE="$DIR/qradar-probe.log"
echo "$(date -Iseconds) $MARKER" >>"$PROBE"
echo "CR-SCRIPT-ID=qradar-linux-pipeline-probe"
echo "CR-RUN-ID=$RUN_ID"
echo "$MARKER"
echo "SEARCH_IN_QRADAR=$MARKER"
echo "PRODUCED=syslog/journal TAG=CyberRangeLab; FILE=$PROBE"
echo "LOG_SOURCE_EXPECTATION=Linux OS / Syslog agent and/or custom Log File Protocol"
