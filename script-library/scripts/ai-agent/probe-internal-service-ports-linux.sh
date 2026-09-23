#!/usr/bin/env bash
# id: probe-internal-service-ports-linux
# name: Probe internal service ports (AI agent, Linux, suspicious)
# description: TCP-connects to a small fixed set of ports on loopback only (445 1433 3389 8080). Target and ports are hardcoded, not parameterized.
# expected_result: Per-port connect result printed with marker.
# target_os: linux
# script_type: bash
# category: ai-agent
# required_permissions: none
# expected_logs: none (stdout only)
# qradar_visibility: none directly; a burst of local port probes can itself be a detection signal
# complexity: basic
# status: implemented
# mvp: false
# auto_inject_candidate: false

set -u
# Hardcoded, bounded target — do not parameterize. 127.0.0.1 only, fixed port list only.
TARGET_HOST=127.0.0.1
PORTS="445 1433 3389 8080"

RUN_ID=$(date +%s)-$$
echo "CR-SCRIPT-ID=probe-internal-service-ports-linux"
echo "CR-RUN-ID=$RUN_ID"
echo "CR-MARKER:probe-internal-service-ports-linux:$RUN_ID"
echo "TARGET=$TARGET_HOST"

for p in $PORTS; do
  if (echo >"/dev/tcp/$TARGET_HOST/$p") >/dev/null 2>&1; then
    echo "PORT $p TcpTestSucceeded=True"
  else
    echo "PORT $p TcpTestSucceeded=False"
  fi
done

exit 0
