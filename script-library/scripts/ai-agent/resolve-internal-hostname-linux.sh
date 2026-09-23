#!/usr/bin/env bash
# id: resolve-internal-hostname-linux
# name: Resolve internal hostname (AI agent, Linux)
# description: Resolves a small fixed set of predefined internal-looking lab hostnames. Safe read-only DNS check.
# expected_result: Per-name resolution result printed with marker; failures are informational, not fatal.
# target_os: linux
# script_type: bash
# category: ai-agent
# required_permissions: none (DNS query only)
# expected_logs: none (stdout only)
# qradar_visibility: DNS query telemetry if DNS logging is onboarded
# complexity: basic
# status: implemented
# mvp: false
# auto_inject_candidate: false

set -u
RUN_ID=$(date +%s)-$$
echo "CR-SCRIPT-ID=resolve-internal-hostname-linux"
echo "CR-RUN-ID=$RUN_ID"
echo "CR-MARKER:resolve-internal-hostname-linux:$RUN_ID"

NAMES="dc01.lab.local fileserver.lab.local web01.lab.local"
for n in $NAMES; do
  if getent hosts "$n" >/dev/null 2>&1; then
    echo "OK resolve $n"
  elif host "$n" >/dev/null 2>&1; then
    echo "OK resolve $n"
  else
    echo "FAIL resolve $n"
  fi
done

exit 0
