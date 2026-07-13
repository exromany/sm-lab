# `@sm-lab/anvil` — npx-runnable mainnet-upgraded anvil launcher

**Date:** 2026-07-13
**Status:** approved (design), pending implementation

## Problem

`state1.json` (from `staking-modules`) is an anvil dump of mainnet with the SM upgrade
applied. Sharing it currently means "clone `staking-modules`, find the file, know the right
`anvil` incantation." We want a one-liner anyone can run:

```bash
npx @sm-lab/anvil
```

### What this is (and isn't)

The dump is a **lazy fork dump**: it captures only the 53 accounts the upgrade touched
(CSModule, StakingRouter, … — but **not** LidoLocator, stETH, or the withdrawal queue), and
its declared tip block `25523407` has no header in the file. Therefore:

- A bare `anvil --load-state` **cannot** boot it (`Best hash not found for best number 25523407`).
- It **must** fork mainnet behind the overlay; un-captured reads fall through to the RPC.

`npx` removes the "clone the repo" step only. It cannot remove the two real prerequisites:

1. The **`anvil` binary** (Foundry) — npx ships JS, not a native build.
2. A **mainnet archive RPC** able to serve block `25523407` — the user's own secret.

So this package is a thin **launcher** over `anvil`, with the state baked in as versioned data.

## Identity & home

- Directory `apps/anvil/` (long-running service + bin, like `apps/cl`).
- Published `@sm-lab/anvil`, starting `v0.1.0` (`access: public`).
- Bin `sm-anvil` → `dist/cli.mjs` (consistent with `sm-cl` / `sm-ipfs` / `sm-recipes`).
- **Bin-only:** no `main` / `exports`; zero runtime dependencies (Node builtins only).

## Layout

```
apps/anvil/
  src/launch.ts   # pure, testable helpers (no side effects, no spawn)
  src/cli.ts      # thin bootstrap: load env → resolve → spawn anvil → propagate exit code
  state/mainnet-upgraded.state.json   # the 1.1 MB dump (moved from scripts/, single source of truth)
  package.json    # bin sm-anvil→dist/cli.mjs; files ["dist","state","README.md"]; scripts build/test/types
  README.md
  tsconfig.json   # relative extends ../../packages/config/tsconfig.lib.json (per repo gotcha)
```

## Components

### `src/launch.ts` (pure)

- `resolveRpc(env): string | undefined` — precedence `MAINNET_RPC_URL → ANVIL_FORK_URL → ETH_RPC_URL`.
- `resolveForkBlock(env): string` — `env.ANVIL_FORK_BLOCK ?? '25523407'`.
- `findStatePath(env): string` — `env.ANVIL_STATE_FILE ?? new URL('../state/mainnet-upgraded.state.json', import.meta.url)` (filesystem path). Resolves from flat `dist/` post-bundle, matching the repo's `readPackageVersion(import.meta.url)` pattern.
- `buildAnvilArgs({ rpc, forkBlock, statePath, passthrough }): string[]` — returns
  `['--fork-url', rpc, '--fork-block-number', forkBlock, '--load-state', statePath, ...passthrough]`.

Keeping these side-effect-free is the test seam — the spawn is never exercised in tests.

### `src/cli.ts` (bootstrap)

1. **`-h` / `--help` as the first arg** → print short usage (usage line + the three RPC env
   vars + "all other flags pass through to anvil; see `anvil --help`") and exit 0.
2. **Load `.env` from cwd** via Node 24 `process.loadEnvFile()` (guarded try/catch; absence is
   fine). Capture caller RPC **before** loading so an explicit env var wins over the file
   (same precedence fix as the retired script).
3. `resolveRpc`; if missing → stderr error naming the three vars + "must be a mainnet *archive*
   node able to serve block `25523407`", exit 1.
4. Check `anvil` on PATH (spawn failure with `ENOENT`) → stderr "install Foundry:
   https://getfoundry.sh", exit 1.
5. `spawn('anvil', buildAnvilArgs(...), { stdio: 'inherit' })`; on exit, propagate anvil's exit
   code (and forward `SIGINT`/`SIGTERM` so Ctrl-C stops anvil cleanly).

## Data flow

```
env (+ cwd/.env) ──▶ resolveRpc / resolveForkBlock / findStatePath ──▶ buildAnvilArgs
                                                                          │
                                              spawn anvil (stdio inherit) ▼
                        mainnet fork @25523407  +  53-account overlay  =  local RPC :8545
```

## CLI surface

`sm-anvil [anvil flags…]` — everything after the command name passes straight through to
`anvil`, so `--port`, `--host 0.0.0.0`, `--steps-tracing`, etc. work unchanged. No `commander`
(it would try to parse anvil's own flags). No `--json` (this launches a long-running process;
it emits no data — consistent with how `serve` commands are exempt from the `--json` contract).

## Error handling

| Condition | Behavior |
|-----------|----------|
| No RPC in env/.env | stderr: names the 3 vars + archive/block-25523407 requirement; exit 1 |
| `anvil` not on PATH | stderr: install Foundry link; exit 1 |
| State file missing | stderr: resolved path; exit 1 |
| anvil exits non-zero | propagate anvil's exit code |
| Ctrl-C | forward signal; anvil shuts down; propagate |

## Testing (hermetic — no anvil, no chain, no network)

Vitest over `src/launch.ts`:

- `resolveRpc` precedence: MAINNET wins over ANVIL_FORK over ETH; undefined when all unset.
- `resolveForkBlock`: default `25523407`; `ANVIL_FORK_BLOCK` override.
- `buildAnvilArgs`: exact arg vector incl. passthrough order preserved.
- `findStatePath`: honors `ANVIL_STATE_FILE`; else resolves under the package.

`cli.ts` is a thin bootstrap; the spawn is not invoked under test.

## Per-package done gates

`build` (tsdown → `.mjs`/`.d.mts`) · `types` (`tsc --noEmit`) · `test` (vitest) ·
`oxlint apps/anvil` · `prettier --check "apps/anvil/**/*.{ts,json}"`. Plus `pnpm turbo run build`
still green (new package has a build entry).

## Repo changes outside the package

- **Delete** `scripts/anvil-with-state.sh` and `scripts/mainnet-upgraded.state.json` (state
  moves into the package; `scripts/` dir removed if empty).
- **Remove** the root `package.json` `"anvil:state"` script (dropped per decision).
- **README:** replace the "Anvil with the upgraded mainnet state" section to lead with
  `npx @sm-lab/anvil`; keep the fork-dump caveat + archive-RPC/block note. Add the package to
  the "Use the published CLIs" list and the Layout table.
- **`.env.sample`:** retarget the `anvil` note from the script to `@sm-lab/anvil` (same vars).
- **Changeset:** add one (new public package at `0.1.0`).

## Out of scope (YAGNI)

- Docker image / wiring the compose `anvil` service to fork+state (deferred; noted only).
- Re-dumping a fuller / self-contained state.
- Any library/programmatic API surface.
