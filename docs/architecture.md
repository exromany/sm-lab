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

| Bucket       | Lifecycle                            | Artifacts                               | Members                     |
| ------------ | ------------------------------------ | --------------------------------------- | --------------------------- |
| `apps/*`     | **deployed** (long-running service)  | npm `bin` **+** Docker image **+** helm | `cl-mock`, `ipfs-mock`      |
| `tools/*`    | **invoked** (run-and-exit CLI)       | npm `bin`                               | `merkle`, `keys`, `recipes` |
| `fixtures/*` | **data** (refreshed, zero runtime)   | published typed JSON                    | `receipts`                  |
| `packages/*` | **internal** (consumed by the above) | bundled in, not published               | `core`, `config`            |

The payoff: Turbo filters, Dockerfiles, and release rules target a whole bucket
(`turbo run build --filter=./apps/*`) instead of special-casing each package.

```
csm-lab/
├── apps/
│   ├── cl-mock/      @sm-lab/cl-mock     Beacon API mock (Hono)        ← csm-test-cl
│   └── ipfs-mock/    @sm-lab/ipfs-mock   Pinata/IPFS emulator (Hono)   ← NEW
├── tools/
│   ├── merkle/       @sm-lab/merkle      ICS + strikes tree builder    ← csm-test-tree
│   ├── keys/         @sm-lab/keys        BLS deposit-data generator    ← NEW
│   └── recipes/      @sm-lab/recipes     anvil CSM-state recipes + CLI ← fork.just
├── fixtures/
│   └── receipts/     @sm-lab/receipts    typed anvil/deploy snapshots  ← contracts repo
├── packages/
│   ├── core/         @sm-lab/core        harvested shared internals
│   └── config/       @sm-lab/config      tsconfig + tsdown + oxlint presets
└── docker/compose.yaml   cl-mock + ipfs-mock + anvil = offline test bed
```

## Toolchain

| Concern         | Choice                      | Rationale                                                                                                      |
| --------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Package manager | **pnpm** workspaces         | strict `node_modules` (no phantom deps) suits mixed service/CLI/data packages; `catalog:` pins shared versions |
| Task runner     | **Turborepo**               | task graph + caching; bucket-level `--filter`                                                                  |
| Build           | **tsdown** (Rolldown + Oxc) | tsup's successor; frictionless migration from `tsc`/`ts-node`; auto `.d.ts`; ESM+CJS                           |
| Lint            | **oxlint** (Oxc)            | all-Rust stack with tsdown; one fast binary                                                                    |
| Format          | **prettier**                | mature; swap to `oxfmt` once stable                                                                            |
| Tests           | **Vitest**                  | neither seed repo had tests — added here                                                                       |
| Versioning      | **Changesets**              | curated public releases of `@sm-lab/*`                                                                        |
| Runtime         | **Node ≥ 20**               | keeps `@hono/node-server` and existing Docker/helm; no re-platform                                             |

All tooling config lives in **`@sm-lab/config`** — change the build/type/lint strategy in
one package and every other inherits it. See its README for the `extends` / import pattern.

## Two patterns worth calling out

**One source, two artifacts.** Every `apps/*` service publishes a `bin` for `npx` _and_
ships a Docker image. The Dockerfile is a ~6-line wrapper whose `CMD` runs that same `bin` —
not a parallel build. `cl-mock` → `npx @sm-lab/cl-mock` (binary stays `csm-cl-mock`) for
local/SDK use; the image is what test-infra/helm runs.

**Harvest, don't pre-build, `@sm-lab/core`.** The shared lib is extracted from the
duplication migration _exposes_ (pubkey normalization, the `cast` wrapper, the Hono +
commander scaffold cl-mock already perfected), not designed speculatively up front. It's
bundled into consumers (`noExternal`), so it never ships as its own package.

## Data flow — the offline test bed

```
  merkle   ──build + pin──►  ipfs-mock      (deterministic CIDs: ICS / gate / rewards trees)

  recipes  ──impersonate──►  anvil (EL)         ┐
           ──clActivate───►  cl-mock (beacon)   ├──►  widget / SDK / contracts read the
                                                ┘     prepared offline CSM environment

        addresses come from @sm-lab/receipts (no DEPLOY_JSON_PATH)
```

`docker compose up` yields a complete offline CSM environment; consumer repos pull
`@sm-lab/receipts` + the mocks as ordinary dependencies.

## Conventions every package follows

- Same scripts: `build` · `dev` · `test` · `types` (`lint`/`format` run repo-wide).
- `extends: @sm-lab/config/tsconfig.lib.json`; `export default libConfig()` (or `binConfig()`).
- Services mirror cl-mock's CLI shape: `serve` / `config` / `status` / `stop` / `help`,
  in-memory store + HTTP admin, version read from `package.json`. The `help` command is a
  self-contained, agent-facing cheat sheet — the first thing an AI agent runs.
- Both mocks enable permissive CORS (`app.use('*', cors())`) so browser consumers
  (csm-widget / SDK) can call them cross-origin.
- CLIs share an injectable `buildProgram(deps)` seam (`src/cli/program.ts` + a thin
  `index.ts` bootstrap) so command parsing is tested hermetically with fake implementations.
- Conventional commits; a Changeset per user-facing change.
