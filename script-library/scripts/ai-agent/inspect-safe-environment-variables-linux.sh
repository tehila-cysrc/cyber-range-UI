#!/usr/bin/env bash
# id: inspect-safe-environment-variables-linux
# name: Inspect safe environment variables (AI agent, Linux, suspicious)
# description: Reads a tight allowlist of non-sensitive environment/system values. Never touches anything containing secrets/keys/tokens.
# expected_result: Allowlisted values printed with marker.
# target_os: linux
# script_type: bash
# category: ai-agent
# required_permissions: none
# expected_logs: none (stdout only)
# qradar_visibility: none directly
# complexity: basic
# status: implemented
# mvp: false
# auto_inject_candidate: false

set -u
RUN_ID=$(date +%s)-$$
echo "CR-SCRIPT-ID=inspect-safe-environment-variables-linux"
echo "CR-RUN-ID=$RUN_ID"
echo "CR-MARKER:inspect-safe-environment-variables-linux:$RUN_ID"

# Hardcoded allowlist — never add variables that could contain secrets/keys/tokens/passwords.
echo "ENV HOSTNAME=$(hostname 2>/dev/null || echo unknown)"
echo "ENV OSTYPE=${OSTYPE:-unknown}"
echo "ENV NPROC=$(nproc 2>/dev/null || echo unknown)"
echo "ENV USER=${USER:-unknown}"
echo "ENV MACHTYPE=${MACHTYPE:-unknown}"

exit 0
