# CLAUDE.md

Guidance for Claude Code working in this repo. See `docs/architecture.md` for the full design,
`docs/decisions/` for ADRs, and `docs/migration.md` for the (in-progress) migration plan.

## What this is

`csm-lab` — monorepo of **testing & emulation utilities** for Lido CSM. Not CSM itself: the
contracts (`community-staking-module`), SDK (`lido-csm-sdk`), and widget (`csm-widget`) are
*consumers*, not members.

Top level splits by **lifecycle**, not topic:
- `apps/*` — long-running services (npm `bin` + Docker image): `cl-mock`, `ipfs-mock`
- `tools/*` — run-and-exit CLIs: `merkle`
- `fixtures/*` — versioned data, zero runtime: `receipts` (WIP)
- `packages/*` — shared internals, bundled into consumers (not published): `core`, `config`

## Commands

```bash
pnpm install                              # never run two installs concurrently (lockfile race)
pnpm --filter @csm-lab/<pkg> build        # tsdown
pnpm --filter @csm-lab/<pkg> types        # tsc --noEmit
pnpm --filter @csm-lab/<pkg> test         # vitest run
pnpm lint                                 # oxlint . (repo-wide)
pnpm format / pnpm format:check           # prettier
pnpm stack:up                             # docker compose: cl-mock + ipfs-mock + anvil
pnpm changeset                            # add a changeset per user-facing change
```

Per-package gates before declaring done: `build` · `types` · `test` · `oxlint <dir>` ·
`prettier --check "<dir>/**/*.{ts,json}"`. Don't run repo-wide `turbo run build` — the WIP
`receipts` stub has no entry and fails it.

## Toolchain gotchas (learned the hard way — don't rediscover)

- **ESM + extensionless imports.** `moduleResolution: Bundler`; write `from './x'`, NOT `'./x.js'`
  (the `.js` form breaks Vitest resolution). Use `import type` for type-only imports.
- **tsdown pinned `^0.22.3`.** The scaffold's `^0.6` is incompatible with the installed rolldown.
  Output is `.mjs` / `.d.mts` (not `.js`) — `bin`/`exports`/`types` in package.json must match.
- **Package `tsconfig.json` uses a RELATIVE `extends`** (`../../packages/config/tsconfig.lib.json`),
  NOT the `@csm-lab/config` subpath — tsdown's Rust tsconfig loader can't follow package-exports extends.
- **Shared `tsconfig.lib.json` holds only path-INDEPENDENT options.** `rootDir`/`outDir`/`include`
  resolve relative to the file that declares them, so they live per-package.
- **No DOM lib** (`lib: ["ES2023"]`): `fetch`/`Response.json()` are `unknown` — type them explicitly,
  don't add DOM. `noUncheckedIndexedAccess` is on (guard array access / default destructures).
- **`@csm-lab/core` is bundled into consumers**, never published — via `deps.alwaysBundle` +
  `dts: { eager: true }` in `packages/config/tsdown.base.ts` (eager is required to inline a
  source-only dep's declarations). Verify after build: no runtime `import '@csm-lab/core'` in `dist/`.
- **Runtime version read:** call `readPackageVersion(import.meta.url)` (from core) at the *consumer's*
  call site. It resolves `../package.json` because bundled output is flat in `dist/`.

## Conventions

- **Deps** are version-pinned via pnpm `catalog:` in `pnpm-workspace.yaml`. New shared dep → add to
  the catalog + reference `catalog:`. After changing any deps, run `pnpm install` (CI is `--frozen-lockfile`).
- **Lint/format:** oxlint (`.oxlintrc.json`) + prettier (single quotes, width 100, trailing commas).
  Prefer `Array#toSorted()` over `.sort()`.
- **Releases:** Changesets (`access: public`; `core`/`config` are ignored/private).
- **Services** mirror the `cl-mock` shape: Hono + commander, `serve`/`status`/`stop`/`help`, in-memory
  store, and core's `registerAdminRoutes` for `/admin/status` + `/admin/shutdown`. Each app ships a
  thin Dockerfile whose `CMD` runs the same published `bin`.
- **Don't over-extract into `core` (YAGNI).** Domain validators and single-consumer helpers stay
  local; promote to core only when a *second* consumer needs them.
- **Tests are hermetic** — no network, no chain. Test Hono handlers via `app.request(...)`; inject
  upstream fetchers / stores; pin deterministic outputs (e.g. merkle tree roots, CIDs).

## Status

Migration steps 1–5 done (`cl-mock`, `ipfs-mock`, `merkle`, `core`). Next: `@csm-lab/receipts`
(typed deploy fixtures + the on-chain "set" work trimmed out of merkle). `docs/migration.md` tracks it.
