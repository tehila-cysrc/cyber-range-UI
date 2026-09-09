#!/usr/bin/env bash
# PostToolUse hook for ExitPlanMode.
# Reads the most-recently-modified plan file in ~/.claude/plans/, extracts the
# "## Out of scope" section, and appends each bullet to <REPO>/BACKLOG.md
# (deduped by exact-line match). No-op if section missing or empty.
#
# Hook receives tool-event JSON on stdin; we only need the trigger, not its
# payload — plan path comes from filesystem mtime.

set -euo pipefail

PLANS_DIR="${CLAUDE_PLANS_DIR:-$HOME/.claude/plans}"
BACKLOG="${CLAUDE_BACKLOG_FILE:-$PWD/BACKLOG.md}"
LOG="${CLAUDE_HOOKS_LOG:-$HOME/.claude/hooks/plan-to-backlog.log}"

# Drain stdin so the calling tool doesn't block on a closed pipe.
cat >/dev/null 2>&1 || true

[ -d "$PLANS_DIR" ] || exit 0
[ -f "$BACKLOG" ] || exit 0

# Latest plan file (mtime). Plans approved within seconds of this hook fire.
PLAN=$(ls -1t "$PLANS_DIR"/*.md 2>/dev/null | head -n1 || true)
[ -n "$PLAN" ] || exit 0

PLAN_NAME=$(basename "$PLAN" .md)
TODAY=$(date +%Y-%m-%d)

# Extract "## Out of scope" block (until next "## " or EOF).
SECTION=$(awk '
  /^## Out of scope[[:space:]]*$/ { in_block=1; next }
  in_block && /^## / { exit }
  in_block { print }
' "$PLAN")

if [ -z "$(printf "%s" "$SECTION" | tr -d "[:space:]")" ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') plan=$PLAN_NAME no-out-of-scope-section" >> "$LOG"
  exit 0
fi

APPENDED=0
NEW_LINES=""

while IFS= read -r line; do
  case "$line" in
    "- "*)
      bullet="${line#- }"
      bullet="${bullet#\[ \] }"
      bullet="${bullet#\[x\] }"
      [ -n "$bullet" ] || continue

      new_entry="- [ ] $TODAY | from-plan:$PLAN_NAME | $bullet"

      if ! grep -Fxq -e "$new_entry" "$BACKLOG" 2>/dev/null; then
        NEW_LINES="${NEW_LINES}${new_entry}"$'\n'
        APPENDED=$((APPENDED + 1))
      fi
      ;;
  esac
done <<< "$SECTION"

if [ "$APPENDED" -gt 0 ]; then
  if grep -q "^## Done" "$BACKLOG"; then
    awk -v new="$NEW_LINES" '
      /^## Done/ && !inserted { printf "%s", new; inserted=1 }
      { print }
    ' "$BACKLOG" > "$BACKLOG.tmp" && mv "$BACKLOG.tmp" "$BACKLOG"
  else
    printf "%s" "$NEW_LINES" >> "$BACKLOG"
  fi
fi

echo "$(date '+%Y-%m-%d %H:%M:%S') plan=$PLAN_NAME appended=$APPENDED" >> "$LOG"
