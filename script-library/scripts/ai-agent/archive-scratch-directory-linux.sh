#!/usr/bin/env bash
# id: archive-scratch-directory-linux
# name: Archive scratch directory (AI agent, Linux, adversarial-simulated)
# description: Tars/gzips the lab scratch directory to a FIXED, overwritten archive filename (sibling of the scratch dir, not inside it). Not timestamped — repeated calls never accumulate archive files.
# expected_result: Archive file exists at the fixed path; path printed with marker.
# target_os: linux
# script_type: bash
# category: ai-agent
# required_permissions: write to /var/tmp
# expected_logs: auditd/FIM if enabled
# qradar_visibility: if FIM onboarded — file write for the fixed archive path; a scratch-dir archive following file-write activity is the suspicious signal
# complexity: basic
# status: implemented
# mvp: false
# auto_inject_candidate: false

set -euo pipefail
# Fixed, overwritten archive filename, placed OUTSIDE the directory it archives to avoid self-inclusion.
# Do not timestamp — bounded disk usage (exactly one archive file) regardless of call count.
SCRATCH_DIR=/var/tmp/cyber-range/agent-activity/scratch
ARCHIVE_PATH=/var/tmp/cyber-range/agent-activity/scratch-archive.tar.gz

mkdir -p "$SCRATCH_DIR"

RUN_ID=$(date +%s)-$$
echo "CR-SCRIPT-ID=archive-scratch-directory-linux"
echo "CR-RUN-ID=$RUN_ID"
echo "CR-MARKER:archive-scratch-directory-linux:$RUN_ID"

if [ -z "$(ls -A "$SCRATCH_DIR" 2>/dev/null)" ]; then
  echo "CR-MARKER:archive-scratch-directory-linux:$RUN_ID" > "$SCRATCH_DIR/.archive-marker"
fi

rm -f "$ARCHIVE_PATH"
tar -czf "$ARCHIVE_PATH" -C "$SCRATCH_DIR" .
echo "PATH=$ARCHIVE_PATH"
