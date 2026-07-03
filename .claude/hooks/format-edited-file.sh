#!/usr/bin/env bash
# PostToolUse (Write|Edit) — formats the just-edited file with the repo's
# pinned prettier (single-quote, width 100, trailing-all). Keeps every edit
# passing the `prettier --check` per-package done-gate. Respects .prettierignore.
set -uo pipefail

file=$(jq -r '.tool_input.file_path // empty')

# Match the files the format gate covers; skip the rest silently.
case "$file" in
  *.ts|*.tsx|*.json) ;;
  *) exit 0 ;;
esac
[ -f "$file" ] || exit 0

# Use the workspace's pinned prettier; never fail the tool call on a format hiccup.
pnpm exec prettier --write --ignore-unknown "$file" >/dev/null 2>&1 || true
exit 0
