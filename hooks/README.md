# hooks/

These scripts live here in the repo for version control, but Claude Code runs
hooks from a path defined in `settings.json` — not automatically from a repo
folder.

## Install

1. Requires `jq` (`block-destructive-docker.sh` parses hook JSON with it).
2. Copy both scripts to `~/.claude/hooks/`:
   ```bash
   mkdir -p ~/.claude/hooks
   cp block-destructive-docker.sh plan-to-backlog.sh ~/.claude/hooks/
   chmod +x ~/.claude/hooks/*.sh
   ```
3. Merge `settings-snippet.json`'s `hooks` block into `~/.claude/settings.json`.

Installed this way, the hooks apply globally — `block-destructive-docker.sh`
guards Bash calls in every project; `plan-to-backlog.sh` writes to
`$PWD/BACKLOG.md` in whichever repo you're working in when a plan is approved.
