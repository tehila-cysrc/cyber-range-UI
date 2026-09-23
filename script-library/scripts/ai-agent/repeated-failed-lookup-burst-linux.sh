#!/usr/bin/env bash
# id: repeated-failed-lookup-burst-linux
# name: Repeated failed lookup burst (AI agent, Linux, suspicious)
# description: Resolves a small fixed set of deliberately nonexistent lab-style hostnames, twice each (6 lookups total, bounded). All failures are expected.
# expected_result: A burst of FAIL resolve lines printed with marker; this is the intended, successful outcome.
# target_os: linux
# script_type: bash
# category: ai-agent
# required_permissions: none (DNS query only)
# expected_logs: none (stdout only)
# qradar_visibility: repeated NXDOMAIN / failed-resolution telemetry if DNS logging is onboarded
# complexity: basic
# status: implemented
# mvp: false
# auto_inject_candidate: false

set -u
# Hardcoded, bounded list of deliberately-nonexistent names — do not parameterize or expand unbounded.
NAMES="nx1.lab.invalid nx2.lab.invalid nx3.lab.invalid"
RUN_ID=$(date +%s)-$$
echo "CR-SCRIPT-ID=repeated-failed-lookup-burst-linux"
echo "CR-RUN-ID=$RUN_ID"
echo "CR-MARKER:repeated-failed-lookup-burst-linux:$RUN_ID"

for round in 1 2; do
  for n in $NAMES; do
    if getent hosts "$n" >/dev/null 2>&1; then
      echo "UNEXPECTED-OK resolve $n (round $round)"
    else
      echo "FAIL resolve $n (round $round)"
    fi
  done
done

exit 0
