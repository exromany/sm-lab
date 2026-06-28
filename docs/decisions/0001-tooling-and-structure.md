# ADR-0001 — Tooling and structure

Status: **accepted** · Date: 2026-06-24

Decisions made while bootstrapping `csm-lab`, with the alternatives that were weighed.

| #   | Decision                 | Chosen                                        | Rejected alternatives                     | Why                                                                                                                                                                                                                                                   |
| --- | ------------------------ | --------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Scope boundary           | **Lean test-utils** (+ fixtures)              | broad CSM dev tooling                     | keep blast radius small; contracts/sdk/widget stay consumers                                                                                                                                                                                          |
| 2   | npm scope                | **`@csm-lab/*`** (org scope, not lidofinance) | unscoped; `@lidofinance/*`                | own namespace; `csm-cl-mock` keeps its `bin`, old package deprecated                                                                                                                                                                                  |
| 3   | Package manager          | **pnpm**                                      | Yarn Berry (org default); npm             | strict deps for mixed package kinds; `catalog:` version pinning                                                                                                                                                                                       |
| 4   | Task runner              | **Turborepo**                                 | Nx; none                                  | matches org muscle memory; PM-agnostic cache                                                                                                                                                                                                          |
| 5   | Bundler                  | **tsdown** (Rolldown+Oxc)                     | Bun/Bunup; unbuild; tsup (deprecated)     | tsup successor; frictionless `tsc`/`ts-node` migration; auto dts; no runtime re-platform                                                                                                                                                              |
| 6   | Linter                   | **oxlint**                                    | Biome; eslint+prettier (org default)      | all-Rust pairing with tsdown; single fast binary                                                                                                                                                                                                      |
| 7   | Distribution             | **npm + Docker/helm**                         | npm-only; internal-only                   | preserves `npx` UX **and** test-infra deploys, from one source                                                                                                                                                                                        |
| 8   | Receipts source of truth | **committed snapshots + refresh script**      | generated from vendored contracts; hybrid | no Solidity toolchain in this repo; reproducible reads. Snapshots are extracted from a local contracts checkout's `out/` (ABIs) + `artifacts/` (addresses) and recorded with a provenance manifest (`data/manifest.json`: git-refs + per-ABI sha256). |
| 9   | Shared internals         | **harvested into `@csm-lab/core`, bundled**   | design upfront; publish separately        | extract only proven duplication; self-contained consumers                                                                                                                                                                                             |

## Open / revisit later

- **Formatter:** prettier now; move to `oxfmt` when it stabilises (completes the Oxc stack).
- **`isolatedDeclarations`:** off initially (needs explicit return types) — turning it on
  later makes Oxc dts generation faster; revisit post-migration.
- **Bun runtime:** parked. Would speed services but re-platforms `@hono/node-server` and the
  Docker base — out of scope for the initial migration.
