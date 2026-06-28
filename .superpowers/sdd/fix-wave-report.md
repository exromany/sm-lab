# fix-wave report

## Changes per file

### `tools/recipes/README.md`
- Fix 1: Changed `npx @csm-lab/recipes seed-cm` → `npx @csm-lab/recipes cm seed` in CLI headline example.

### `tools/recipes/src/cli/commands/shared.ts`
- Fix 2: Replaced 5 curly apostrophes (U+2019) with ASCII `'` in summary strings. Because the
  summary strings used single-quote delimiters, the apostrophes were switched to double-quote
  outer delimiters (`"..."`) to avoid breaking the string literal.
- Fix 3: Removed line-1 path banner `// tools/recipes/src/cli/commands/shared.ts`.

### `tools/recipes/src/cli/commands/cm.ts`
- Fix 2: Replaced 1 curly apostrophe in `reset-operator-group` summary; outer delimiter switched
  to double quotes as above.

### `tools/recipes/src/cli/define.ts`
- Fix 3: Removed line-1 path banner `// tools/recipes/src/cli/define.ts`.

### `tools/recipes/src/cli/program.ts`
- Fix 3: Removed line-1 path banner `// tools/recipes/src/cli/program.ts`.

### Untouched (as instructed)
- `tools/recipes/src/cli/index.ts` — line 1 is `#!/usr/bin/env node` (shebang); not a path banner.
- `tools/recipes/src/cli/commands/csm.ts` — no path banner, no curly apostrophes.

## Gate outputs

| Gate | Result |
|------|--------|
| `pnpm --filter @csm-lab/recipes types` | 0 errors |
| `pnpm --filter @csm-lab/recipes exec vitest run` | 117 passed / 2 skipped |
| `pnpm exec oxlint tools/recipes` | clean |
| `pnpm exec prettier --check "tools/recipes/**/*.{ts,json}"` | clean (no --write needed) |
| `pnpm --filter @csm-lab/recipes build` | success |

## Shebang confirmation

`dist/cli.mjs` line 1 after rebuild: `#!/usr/bin/env node` ✓
