#!/usr/bin/env bash
# id: infra-restart-service-linux
# name: Restart allowlisted systemd service
# description: Restarts nginx or chronyd only (allowlist). Safe ops event for Linux SOC labs.
# expected_result: service active; journalctl entries
# target_os: linux
# script_type: bash
# category: infrastructure
# required_permissions: root (Run Command)
# expected_logs: journal systemd unit restart
# qradar_visibility: Linux OS / systemd logs mentioning the unit
# complexity: basic
# status: implemented
# mvp: true
# auto_inject_candidate: true

set -u
SERVICE="${INFRA_SERVICE:-chronyd}"
ALLOW="chronyd nginx"
RUN_ID=$(date +%s)-$$
echo "CR-SCRIPT-ID=infra-restart-service-linux"
echo "CR-RUN-ID=$RUN_ID"
echo "CR-MARKER:infra-restart-service-linux:$RUN_ID"
echo "SERVICE=$SERVICE"

ok=0
for a in $ALLOW; do
  [ "$a" = "$SERVICE" ] && ok=1
done
if [ "$ok" -ne 1 ]; then
  echo "RESULT=denied not in allowlist ($ALLOW)"
  exit 1
fi

if systemctl restart "$SERVICE"; then
  systemctl is-active "$SERVICE" || true
  echo "RESULT=restarted"
  exit 0
fi
echo "RESULT=fail"
exit 1
