# csm-lab — architecture

> Monorepo of testing & emulation utilities for Lido CSM (Community Staking Module).
> This document is the design of record. Decisions are logged in [`decisions/`](./decisions).

## What this is (and isn't)

`csm-lab` houses the **tooling you use to test CSM**, not CSM itself. The contracts
(`community-staking-module`), the SDK (`lido-csm-sdk`), and the widget (`csm-widget`) are
**consumers**, never members — they depend on what this repo publishes (mocks + fixtures),
which keeps their release cycles decoupled from ours.

Scope is deliberately **lean**: testing/emulation utilities and the fixtures they need.
Broader CSM dev/ops tooling stays in its own repos.

## The core idea: four buckets by lifecycle

A flat `packages/` would force every package to be treated identically. But this repo holds
**three kinds of artifact with three different lifecycles**, so the top level splits by that:

| Bucket | Lifecycle | Artifacts | Members |
| --- | --- | --- | --- |
| `apps/*` | **deployed** (long-running service) | npm `bin` **+** Docker image **+** helm | `cl-mock`, `ipfs-mock` |
| `tools/*` | **invoked** (run-and-exit CLI) | npm `bin` | `merkle` |
| `fixtures/*` | **data** (refreshed, zero runtime) | published typed JSON | `receipts` |
| `packages/*` | **internal** (consumed by the above) | bundled in, not published | `core`, `config` |

The payoff: Turbo filters, Dockerfiles, and release rules target a whole bucket
(`turbo run build --filter=./apps/*`) instead of special-casing each package.

```
csm-lab/
├── apps/
│   ├── cl-mock/      @csm-lab/cl-mock     Beacon API mock (Hono)        ← csm-test-cl
│   └── ipfs-mock/    @csm-lab/ipfs-mock   Pinata/IPFS emulator (Hono)   ← NEW
├── tools/
│   └── merkle/       @csm-lab/merkle      ICS + strikes tree builder    ← csm-test-tree
├── fixtures/
│   └── receipts/     @csm-lab/receipts    typed anvil/deploy snapshots  ← contracts repo
├── packages/
│   ├── core/         @csm-lab/core        harvested shared internals
│   └── config/       @csm-lab/config      tsconfig + tsdown + oxlint presets
└── docker/compose.yaml   cl-mock + ipfs-mock + anvil = offline test bed
```

## Toolchain

| Concern | Choice | Rationale |
| --- | --- | --- |
| Package manager | **pnpm** workspaces | strict `node_modules` (no phantom deps) suits mixed service/CLI/data packages; `catalog:` pins shared versions |
| Task runner | **Turborepo** | task graph + caching; bucket-level `--filter` |
| Build | **tsdown** (Rolldown + Oxc) | tsup's successor; frictionless migration from `tsc`/`ts-node`; auto `.d.ts`; ESM+CJS |
| Lint | **oxlint** (Oxc) | all-Rust stack with tsdown; one fast binary |
| Format | **prettier** | mature; swap to `oxfmt` once stable |
| Tests | **Vitest** | neither seed repo had tests — added here |
| Versioning | **Changesets** | curated public releases of `@csm-lab/*` |
| Runtime | **Node ≥ 20** | keeps `@hono/node-server` and existing Docker/helm; no re-platform |

All tooling config lives in **`@csm-lab/config`** — change the build/type/lint strategy in
one package and every other inherits it. See its README for the `extends` / import pattern.

## Two patterns worth calling out

**One source, two artifacts.** Every `apps/*` service publishes a `bin` for `npx` *and*
ships a Docker image. The Dockerfile is a ~6-line wrapper whose `CMD` runs that same `bin` —
not a parallel build. `cl-mock` → `npx @csm-lab/cl-mock` (binary stays `csm-cl-mock`) for
local/SDK use; the image is what test-infra/helm runs.

**Harvest, don't pre-build, `@csm-lab/core`.** The shared lib is extracted from the
duplication migration *exposes* (pubkey normalization, the `cast` wrapper, the Hono +
commander scaffold cl-mock already perfected), not designed speculatively up front. It's
bundled into consumers (`noExternal`), so it never ships as its own package.

## Data flow — the offline test bed

```
                      ┌─────────────────────────────────────────────┐
                      │  pnpm stack:up  (docker/compose.yaml)         │
                      │                                               │
  merkle (make) ──────┼──► ipfs-mock  ──(deterministic CID)──┐        │
       │              │                                      │        │
       │ cast         │   cl-mock (beacon state)             │        │
       ▼              │       ▲                              ▼        │
  merkle (set) ───────┼──► anvil (EL) ◄──── widget / SDK / contracts  │
                      └─────────────────────────────────────────────┘
        addresses come from @csm-lab/receipts (no DEPLOY_JSON_PATH)
```

`docker compose up` yields a complete offline CSM environment; consumer repos pull
`@csm-lab/receipts` + the mocks as ordinary dependencies.

## Conventions every package follows

- Same scripts: `build` · `dev` · `test` · `types` (`lint`/`format` run repo-wide).
- `extends: @csm-lab/config/tsconfig.lib.json`; `export default libConfig()` (or `binConfig()`).
- Services mirror cl-mock's CLI shape: `serve` / `config` / `status` / `stop` / `help`,
  in-memory store + HTTP admin, version read from `package.json`. The `help` command is a
  self-contained, agent-facing cheat sheet — the first thing an AI agent runs.
- Conventional commits; a Changeset per user-facing change.
