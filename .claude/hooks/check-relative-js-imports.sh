#!/usr/bin/env bash
# PostToolUse (Write|Edit) — flags relative imports that end in `.js`.
#
# Under this repo's `moduleResolution: Bundler`, relative specifiers MUST be
# extensionless (`from './x'`). A trailing `.js` (`from './x.js'`) type-checks
# but breaks Vitest module resolution — a documented footgun in CLAUDE.md
# ("Toolchain gotchas"). Exit 2 surfaces the offending lines back to Claude.
set -uo pipefail

file=$(jq -r '.tool_input.file_path // empty')

# Only .ts sources (covers .d.ts); skip everything else silently.
case "$file" in
  *.ts) ;;
  *) exit 0 ;;
esac
[ -f "$file" ] || exit 0

# A quoted RELATIVE specifier ('./…' or '../…') ending in `.js` — matches
# import/export-from and dynamic import()/require(). `.json` is NOT matched
# (the quote must sit immediately after `.js`).
matches=$(grep -nE "['\"]\.\.?/[^'\"]*\.js['\"]" "$file")

if [ -n "$matches" ]; then
  {
    echo "✗ Relative import(s) ending in .js in ${file}"
    echo "  Breaks Vitest under moduleResolution: Bundler — write extensionless (from './x', not './x.js')."
    echo "$matches"
  } >&2
  exit 2
fi
exit 0
