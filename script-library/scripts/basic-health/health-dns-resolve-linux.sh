#!/usr/bin/env bash
# id: health-dns-resolve-linux
# name: Verify DNS resolution (Linux)
# description: Resolves hostnames with getent/host. Safe read-only check.
# expected_result: Exit 0 if all names resolve.
# target_os: linux
# script_type: bash
# category: basic-health
# required_permissions: none
# expected_logs: none (stdout)
# qradar_visibility: none (health only)
# complexity: basic
# status: implemented
# mvp: true

set -u
RUN_ID=$(date +%s)-$$
echo "CR-SCRIPT-ID=health-dns-resolve-linux"
echo "CR-RUN-ID=$RUN_ID"
echo "CR-MARKER:health-dns-resolve-linux:$RUN_ID"

NAMES=("${REPO_DNS_NAMES:-www.microsoft.com login.microsoftonline.com}")
# shellcheck disable=SC2206
NAMES_ARR=($NAMES)
failed=0
for n in "${NAMES_ARR[@]}"; do
  if getent hosts "$n" >/dev/null 2>&1 || host "$n" >/dev/null 2>&1; then
    echo "OK resolve $n"
  else
    echo "FAIL resolve $n"
    failed=1
  fi
done
exit $failed
