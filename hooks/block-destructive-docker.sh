#!/usr/bin/env bash
# PreToolUse hook for Bash. Blocks destructive docker volume operations.
# Volumes hold persistent data and must not be deleted by mistake.
#
# Wired in settings.json as:
#   PreToolUse → matcher: "Bash" → command: this script
#
# Exit 2 = block + send stderr back to the model.

set -euo pipefail

INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

if echo "$CMD" | grep -qE '(docker[[:space:]]+volume[[:space:]]+(rm|prune))|(docker(-|[[:space:]]+)compose[[:space:]]+down[[:space:]].*(-v([[:space:]]|$)|--volumes))|(docker[[:space:]]+system[[:space:]]+prune.*--volumes)'; then
  echo "BLOCKED: destructive docker volume operation detected (\"$CMD\"). Volumes hold persistent data and must not be deleted by mistake. Ask the user to run it manually if truly intended." >&2
  exit 2
fi

exit 0
