# CLAUDE.md

Guidance for Claude Code working in this repo. See `docs/architecture.md` for the full design and
`docs/decisions/` for ADRs.

## What this is

`sm-lab` — monorepo of **testing & emulation utilities** for Lido SM (Staking Modules) — CSM is one module. Not the modules themselves: the
contracts (`community-staking-module`), SDK (`lido-csm-sdk`), and widget (`csm-widget`) are
_consumers_, not members.

Top level splits by **lifecycle**, not topic:

- `apps/*` — long-running services (npm `bin` + Docker image): `cl`, `ipfs`
- `tools/*` — run-and-exit CLIs / libraries: `merkle`, `recipes`
- `fixtures/*` — versioned data, zero runtime: `receipts`
- `packages/*` — shared internals, bundled into consumers (not published): `core`, `config`

## Repo rename note

Fully renamed to `sm-lab` — codebase name-clean, local working dir renamed, GitHub repo renamed
(`exromany/sm-lab`), and `origin` repointed. Old GitHub URLs redirect.

## Commands

```bash
pnpm install                              # never run two installs concurrently (lockfile race)
pnpm --filter @sm-lab/<pkg> build        # tsdown
pnpm --filter @sm-lab/<pkg> types        # tsc --noEmit
pnpm --filter @sm-lab/<pkg> test         # vitest run
pnpm lint                                 # oxlint . (repo-wide)
pnpm format / pnpm format:check           # prettier
pnpm stack:up                             # docker compose: cl + ipfs + anvil
pnpm changeset                            # add a changeset per user-facing change
```

Per-package gates before declaring done: `build` · `types` · `test` · `oxlint <dir>` ·
`prettier --check "<dir>/**/*.{ts,json}"`. Repo-wide `pnpm turbo run build` now works (every
package has a build entry); per-package gates above are still the fastest done-check loop.

## Toolchain gotchas (learned the hard way — don't rediscover)

- **ESM + extensionless imports.** `moduleResolution: Bundler`; write `from './x'`, NOT `'./x.js'`
  (the `.js` form breaks Vitest resolution). Use `import type` for type-only imports.
- **tsdown pinned `^0.22.3`.** The scaffold's `^0.6` is incompatible with the installed rolldown.
  Output is `.mjs` / `.d.mts` (not `.js`) — `bin`/`exports`/`types` in package.json must match.
- **Package `tsconfig.json` uses a RELATIVE `extends`** (`../../packages/config/tsconfig.lib.json`),
  NOT the `@sm-lab/config` subpath — tsdown's Rust tsconfig loader can't follow package-exports extends.
- **Shared `tsconfig.lib.json` holds only path-INDEPENDENT options.** `rootDir`/`outDir`/`include`
  resolve relative to the file that declares them, so they live per-package.
- **No DOM lib** (`lib: ["ES2023"]`): `fetch`/`Response.json()` are `unknown` — type them explicitly,
  don't add DOM. `noUncheckedIndexedAccess` is on (guard array access / default destructures).
- **`@sm-lab/core` is bundled into consumers**, never published — via `deps.alwaysBundle` +
  `dts: { eager: true }` in `packages/config/tsdown.base.ts` (eager is required to inline a
  source-only dep's declarations). Verify after build: no runtime `import '@sm-lab/core'` in `dist/`.
- **Runtime version read:** call `readPackageVersion(import.meta.url)` (from core) at the _consumer's_
  call site. It resolves `../package.json` because bundled output is flat in `dist/`.

## Conventions

- **Deps** are version-pinned via pnpm `catalog:` in `pnpm-workspace.yaml`. New shared dep → add to
  the catalog + reference `catalog:`. After changing any deps, run `pnpm install` (CI is `--frozen-lockfile`).
- **Lint/format:** oxlint (`.oxlintrc.json`) + prettier (single quotes, width 100, trailing commas).
  Prefer `Array#toSorted()` over `.sort()`.
- **Releases:** Changesets (`access: public`; `core`/`config` are private, never published).
- **Services** mirror the `cl` shape: Hono + commander, `serve`/`status`/`stop`/`help`, in-memory
  store, and core's `registerAdminRoutes` for `/admin/status` + `/admin/shutdown`. `serve --state <file>`
  persists the store (load-on-boot, save-on-shutdown) via core's state helpers, plus `/admin/save` +
  `/admin/load` — bound to the configured path only (never a client-supplied path). `cl` also
  proxies-and-caches a real CL API when `serve --upstream <url>` is set. Each app ships a thin
  Dockerfile whose `CMD` runs the same published `bin`. Both mocks enable permissive CORS
  (`app.use('*', cors())`) so browser consumers (csm-widget / SDK) can call them cross-origin.
- **CLIs** (`keys`/`merkle`/`recipes`) share an injectable `buildProgram(deps)` seam — `src/cli/program.ts`
  builds the commander program from injected implementations, `src/cli/index.ts` is a thin bootstrap —
  so command parsing is tested hermetically with fakes. Suppress the built-in help with `.helpCommand(false)`
  (not the deprecated `.addHelpCommand(false)`) when shipping a custom `help` cheat sheet.
- **Machine-readable I/O:** every data-emitting command takes `--json`; with `--json` it prints one
  JSON value to stdout (`JSON.stringify` with 2-space indent, bigints serialised as strings); errors go
  to stderr as `Error: …` with exit 1; exit codes are 0 success / 1 error; help documents `--json`.
- **Don't over-extract into `core` (YAGNI).** Domain validators and single-consumer helpers stay
  local; promote to core only when a _second_ consumer needs them.
- **Tests are hermetic** — no network, no chain. Test Hono handlers via `app.request(...)`; inject
  upstream fetchers / stores; pin deterministic outputs (e.g. merkle tree roots, CIDs).

## Status

Steps 1–5 done (`cl-mock`, `ipfs-mock`, `merkle`, `core`). Step 6 was reshaped into increments 6a–6g
(see `docs/superpowers/specs/2026-06-26-anvil-recipes-design.md`):

- **6a `@sm-lab/receipts`** ✅ — typed ABIs + allowlist-curated strictly-typed address book
  (DeployParams/`*Impl`/libs dropped) + `manifest.json` + human-run `refresh.ts` (git-ref guard,
  `--config`). Optional `--rpc`-gated `protocol` block bakes 6 LidoLocator-resolved addresses;
  skip + carry-forward when RPC absent; `manifest.protocolResolvedAt` records `{ chainId, block }`
  provenance. recipes `connect()` and the keys tool prefer the baked block, fall back otherwise.
- **6b `@sm-lab/recipes`** ✅ — Foundry-free TS rewrite of `fork.just`: `connect` (LidoLocator-resolved
  ctx) + the `actAs` impersonation engine + `addKeys`/`operatorInfo`/`warpBy`·`snapshot`·`revert`/
  cm `createCuratedOperator`/csm `setGateAddrs` (ics). Reuses receipts + merkle; hermetic fake-client
  tests + one `ANVIL_FORK_URL`-gated smoke.
- **6c lifecycle families** ✅ — propose/confirm manager+reward (×4), `deposit`/`unvet`/`exit`,
  `slash`/`withdraw` (Verifier-gated), penalty report/cancel/settle/compensate (×4), `addBond`/
  `createBondDebt`. Mechanical once `actAs` was proven.
- **6d cl-mock bridge** ✅ — `clActivate(ctx, { noId, keyIndex })` reads a key's pubkey
  (`getPubkey`) + allocated balance (`getKeyBalance`) on-chain, then POSTs `active_ongoing` to a
  running `@sm-lab/cl` (`ctx.clMockUrl`) with effective balance = 32 ETH + allocated, in gwei
  (full precision, diverging from the source's integer-ETH truncation). Thin `setClValidator` HTTP
  client mirrors merkle's `ipfs.ts`; hermetic `fetch`-stub tests.

- **6e rewards** ✅ — shipped as two PRs (the spec's "hard one"). **makeRewards** (+ merkle
  `buildRewardsTree`, `['uint256','uint256']` bigint leaves): reads active operators → seeded mock
  reward per active key → cumulative carry-forward tree (pad a lone operator with `type(uint64).max`)
  → pins tree+log to IPFS guarded (with `treeCid`/`logCid` escapes) → typed in-memory `RewardsReport`;
  all-bigint + single JSON-replacer for the bigint-in-log hazard. **submitRewards** (+ internal
  `warpTo`): funds the FeeDistributor (inline impersonation, not an `actAs` change), warps to the next
  consensus frame, builds the `ReportData` tuple, reaches consensus across fast-lane members (with the
  `getMembers` fallback for the empty-fast-lane fork bug), and submits. `reportHash` = `abi.encode` of
  one tuple param (golden-vector verified against viem); empty report → `{ submitted: false }` skip.

- **6f cm/csm specifics** ✅ (core) — csm `idvtc` selector: `resolveGate(ctx,'idvtc')` →
  `IdentifiedDVTClusterGate` (new optional `CsmAddressBook` field; v3-only — throws on mainnet/v2
  snapshots that lack it). cm group/curve recipes (`@sm-lab/recipes/cm`, port of
  `MetaRegistryHelpers.s.sol`): `createOperatorGroup` (bps pairs sum to 10000, dedup-resets prior
  memberships), `resetOperatorGroup`, `setBondCurveWeight` — role read from the MetaRegistry contract.
  `resetOperatorGroup`/`setBondCurveWeight` role read from the MetaRegistry contract.
- **6f-2 top-up + seedCm** ✅ — `increaseAllocatedBalance` + `topUpActiveKeys` (shared,
  StakingRouter-gated `CSModule.allocateDeposits`; `topUpActiveKeys` reads per-key state up front then
  writes sequentially in key-index order for the TopUpQueueOps FIFO head, 2016 ETH cap/key) complete
  the operator-lifecycle family. cm `seedCm(ctx, { selector?, seed? })` composes
  createCuratedOperator/createOperatorGroup/addKeys/deposit/topUpActiveKeys into the `seed-cm`
  scenario — uses the returned noIds (not hardcoded indices) + deterministic operator addresses.

- **6g `sm-recipes` CLI** ✅ — run-and-exit CLI over the recipe surface (merkle's shape, not a
  server). Declarative command registry: each recipe is a `RecipeCommand` data descriptor;
  one `defineCommand(desc, connectImpl)` factory (`src/cli/define.ts`) generates the commander
  wiring (per-field coercion, `connect()` once, `--json` vs human output, `run()` error-exit).
  `buildProgram(connectImpl)` wires ~34 commands — shared at top level (`--module`), cm/csm-only
  under nested `cm`/`csm` groups that force `ctx.module`. ETH amounts via viem `parseEther`
  (1-wei exact); `noId`→`--operator-id` (commander `--no-*` is negation, decoupled via `flagProp`).
  The `cm`/`csm` groups also mirror every shared recipe with the module pre-bound (so
  `sm-recipes csm <shared>` needs no `--module`); `--rpc-url` defaults to anvil's `127.0.0.1:8545`;
  required non-repeatable options are accepted positionally in declaration order (a repeatable one
  becomes the trailing variadic — `set-gate <selector> <address...>`); a `help` command mirrors
  `--help` on root + groups. `bin: sm-recipes → dist/cli.mjs`, v0.1.0, changeset added. Hermetic tests via the `connectImpl`
  seam. **Published-for-npx is wired but the actual coordinated first publish of
  recipes+merkle+receipts is a deferred release action** (none are on npm yet).

Steps 1–6 (cl, ipfs, merkle, keys, core, receipts, recipes + CLI) are complete.

### sm-lab TODO roadmap (Phases 1–4) ✅

(see `docs/superpowers/specs/2026-07-01-todo-roadmap-design.md`)

- **P1 Rename** — repo/scope `csm-lab`/`@csm-lab` → `sm-lab`/`@sm-lab`; apps dropped `-mock`
  (`@sm-lab/cl`, `@sm-lab/ipfs`); bins `sm-*`; docker/compose repointed.
- **P2 Housekeeping + machine-readable I/O (F1)** — node ≥24 (engines + Docker + CI); ipfs default
  port `3000`→`5001`; `addHelpCommand`→`helpCommand`; `docs/migration.md` deleted + migration/CORS
  notes dropped from READMEs; global `.env.sample`; **universal `--json` contract across all 5 CLIs**
  (see the Machine-readable I/O convention above). This satisfies "agentic-first"; the MCP-server idea
  was dropped.
- **P3 Tools** — merkle `addresses`(default)/`strikes`/`rewards` modes + flexible input
  (positional / `--input` / `--source`) + **local-first IPFS** (`IPFS_API_URL` unset → local
  `@sm-lab/ipfs` `127.0.0.1:5001`; Pinata only when `PINATA_*` set); `makeRewards` pipeline returns a
  JSON-safe `treeDump`. recipes uses **real BLS keys** via `@sm-lab/keys` `makeDepositKeys`
  (deterministic) and delegates the rewards tree-build+pin to merkle's `makeRewards`.
- **P4 Mock state** — `@sm-lab/core` state helpers (`saveStateToFile` / `loadStateFromFile` /
  `registerStateRoutes` + `startServer` load-on-boot / save-on-shutdown; atomic writes;
  corrupt-file-tolerant boot); both mocks gain `serve --state`; `cl` gains a cached upstream proxy
  (`serve --upstream`).

**Deferred (non-blocking):** comment-cleanup; `/admin/*` auth-token + loopback-only hardening;
faithful epoch-relay on the `cl` proxy; the **coordinated first npm publish** (changeset bodies are
de-staled / publish-ready).
