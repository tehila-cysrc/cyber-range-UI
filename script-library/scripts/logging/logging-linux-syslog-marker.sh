#!/usr/bin/env bash
# id: logging-linux-syslog-marker
# name: Write Linux syslog marker
# description: Uses logger to emit CR-MARKER to syslog/journal.
# expected_result: Line in journal/syslog; stdout marker.
# target_os: linux
# script_type: bash
# category: logging
# required_permissions: none for logger (user); root typical under Run Command
# expected_logs: /var/log/syslog or journald
# qradar_visibility: Linux OS / Syslog — payload contains CR-MARKER:logging-linux-syslog-marker
# complexity: basic
# status: implemented
# mvp: true
# auto_inject_candidate: true

set -u
RUN_ID=$(date +%s)-$$
MARKER="CR-MARKER:logging-linux-syslog-marker:$RUN_ID"
logger -t CyberRangeLab "$MARKER script=logging-linux-syslog-marker"
echo "CR-SCRIPT-ID=logging-linux-syslog-marker"
echo "CR-RUN-ID=$RUN_ID"
echo "$MARKER"
echo "LOG=syslog/journal TAG=CyberRangeLab"
