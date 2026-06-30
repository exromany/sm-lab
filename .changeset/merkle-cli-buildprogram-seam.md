---
'@csm-lab/merkle': patch
---

refactor(cli): extract an injectable `buildProgram(deps)` test seam from the `csm-merkle` CLI.
The single-file `src/cli.ts` is restructured into `src/cli/` (a `program.ts` that builds the
program from injected `makeIcs`/`makeStrikes` implementations + a thin `index.ts` bootstrap that
loads `.env` and parses), so CLI parsing is now hermetically testable — matching the `csm-keys`
and `csm-recipes` CLIs. Also de-deprecates the help-command API (`.addHelpCommand(false)` →
`.helpCommand(false)`), which keeps the built-in help command suppressed so the tool's own custom
`help` cheat-sheet command stays the only `help`. No user-facing behavior change: the same
commands, flags, and output as before.
