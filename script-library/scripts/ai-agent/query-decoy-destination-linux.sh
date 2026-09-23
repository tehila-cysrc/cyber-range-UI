#!/usr/bin/env bash
# id: query-decoy-destination-linux
# name: Query decoy destination (AI agent, Linux, suspicious)
# description: HTTP GET against a single fixed, hardcoded internal lab decoy hostname. Not parameterized; failure to connect is a normal/expected outcome.
# expected_result: HTTP status or connection failure printed with marker; both are valid outcomes.
# target_os: linux
# script_type: bash
# category: ai-agent
# required_permissions: none (outbound HTTP)
# expected_logs: none by default
# qradar_visibility: outbound request to an unusual/decoy destination name if proxy/firewall logging is onboarded
# complexity: basic
# status: implemented
# mvp: false
# auto_inject_candidate: false

set -u
# Hardcoded decoy destination — do not parameterize.
URL="http://decoy.lab.local/"
RUN_ID=$(date +%s)-$$
echo "CR-SCRIPT-ID=query-decoy-destination-linux"
echo "CR-RUN-ID=$RUN_ID"
echo "CR-MARKER:query-decoy-destination-linux:$RUN_ID"
echo "URL=$URL"

code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$URL" 2>/dev/null || echo "000")
echo "STATUS=$code"

exit 0
