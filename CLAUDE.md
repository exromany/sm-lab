# CLAUDE.md

Guidance for Claude Code working in this repo. See `docs/architecture.md` for the full design,
`docs/decisions/` for ADRs, and `docs/migration.md` for the (in-progress) migration plan.

## What this is

`csm-lab` — monorepo of **testing & emulation utilities** for Lido CSM. Not CSM itself: the
contracts (`community-staking-module`), SDK (`lido-csm-sdk`), and widget (`csm-widget`) are
_consumers_, not members.

Top level splits by **lifecycle**, not topic:

- `apps/*` — long-running services (npm `bin` + Docker image): `cl-mock`, `ipfs-mock`
- `tools/*` — run-and-exit CLIs / libraries: `merkle`, `recipes`
- `fixtures/*` — versioned data, zero runtime: `receipts`
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
`prettier --check "<dir>/**/*.{ts,json}"`. Repo-wide `pnpm turbo run build` now works (every
package has a build entry); per-package gates above are still the fastest done-check loop.

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
- **Runtime version read:** call `readPackageVersion(import.meta.url)` (from core) at the _consumer's_
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
  local; promote to core only when a _second_ consumer needs them.
- **Tests are hermetic** — no network, no chain. Test Hono handlers via `app.request(...)`; inject
  upstream fetchers / stores; pin deterministic outputs (e.g. merkle tree roots, CIDs).

## Status

Steps 1–5 done (`cl-mock`, `ipfs-mock`, `merkle`, `core`). Step 6 was reshaped into increments 6a–6g
(see `docs/superpowers/specs/2026-06-26-anvil-recipes-design.md`):

- **6a `@csm-lab/receipts`** ✅ — typed ABIs + module-suite addresses (from the _latest_ per-chain
  upgrade config) + `manifest.json` + human-run `refresh.ts` (git-ref guard, `--config`).
- **6b `@csm-lab/recipes`** ✅ — Foundry-free TS rewrite of `fork.just`: `connect` (LidoLocator-resolved
  ctx) + the `actAs` impersonation engine + `addKeys`/`operatorInfo`/`warpBy`·`snapshot`·`revert`/
  cm `createCuratedOperator`/csm `setGateAddrs` (ics). Reuses receipts + merkle; hermetic fake-client
  tests + one `ANVIL_FORK_URL`-gated smoke.
- **6c lifecycle families** ✅ — propose/confirm manager+reward (×4), `deposit`/`unvet`/`exit`,
  `slash`/`withdraw` (Verifier-gated), penalty report/cancel/settle/compensate (×4), `addBond`/
  `createBondDebt`. Mechanical once `actAs` was proven.
- **6d cl-mock bridge** ✅ — `clActivate(ctx, { noId, keyIndex })` reads a key's pubkey
  (`getPubkey`) + allocated balance (`getKeyBalance`) on-chain, then POSTs `active_ongoing` to a
  running `@csm-lab/cl-mock` (`ctx.clMockUrl`) with effective balance = 32 ETH + allocated, in gwei
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
  snapshots that lack it). cm group/curve recipes (`@csm-lab/recipes/cm`, port of
  `MetaRegistryHelpers.s.sol`): `createOperatorGroup` (bps pairs sum to 10000, dedup-resets prior
  memberships), `resetOperatorGroup`, `setBondCurveWeight` — role read from the MetaRegistry contract.
  `resetOperatorGroup`/`setBondCurveWeight` role read from the MetaRegistry contract.
- **6f-2 top-up + seedCm** ✅ — `increaseAllocatedBalance` + `topUpActiveKeys` (shared,
  StakingRouter-gated `CSModule.allocateDeposits`; `topUpActiveKeys` reads per-key state up front then
  writes sequentially in key-index order for the TopUpQueueOps FIFO head, 2016 ETH cap/key) complete
  the operator-lifecycle family. cm `seedCm(ctx, { selector?, seed? })` composes
  createCuratedOperator/createOperatorGroup/addKeys/deposit/topUpActiveKeys into the `seed-cm`
  scenario — uses the returned noIds (not hardcoded indices) + deterministic operator addresses.

Next: **6g** (thin CLI, only if a human consumer materializes) — on demand. The full importable
recipe surface (6a–6f-2) is now complete. `docs/migration.md` tracks the increments.
