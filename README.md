# csm-lab

Monorepo of testing & emulation utilities for **Lido CSM** (Community Staking Module).

It gives you the pieces to stand up CSM in a controlled environment — a Beacon API mock,
an IPFS/Pinata emulator, a merkle-tree builder, and versioned deploy fixtures — and
publishes them so the contracts, SDK, and widget repos can consume them as dependencies.

```bash
pnpm install
pnpm build          # turbo, all packages
pnpm stack:up       # cl-mock + ipfs-mock + anvil — a full offline CSM test bed
```

## Layout

| Path                | Package              | What                                      | From            |
| ------------------- | -------------------- | ----------------------------------------- | --------------- |
| `apps/cl-mock`      | `@csm-lab/cl-mock`   | Consensus Layer (Beacon API) mock         | `csm-test-cl`   |
| `apps/ipfs-mock`    | `@csm-lab/ipfs-mock` | Pinata/IPFS emulator, deterministic CIDs  | new             |
| `tools/merkle`      | `@csm-lab/merkle`    | ICS + strikes merkle tree builder         | `csm-test-tree` |
| `fixtures/receipts` | `@csm-lab/receipts`  | typed anvil/deploy snapshots              | contracts repo  |
| `packages/core`     | `@csm-lab/core`      | shared internals (bundled, not published) | —               |
| `packages/config`   | `@csm-lab/config`    | tsconfig + tsdown + oxlint presets        | —               |

The four-bucket split (`apps` / `tools` / `fixtures` / `packages`) is by **lifecycle**, not
topic — see [`docs/architecture.md`](./docs/architecture.md).

## Stack

pnpm · Turborepo · tsdown (Rolldown+Oxc) · oxlint · Vitest · Changesets · TS-strict ESM.
All tooling config is centralized in `@csm-lab/config`.

## Docs

- [`docs/architecture.md`](./docs/architecture.md) — design of record
- [`docs/decisions/`](./docs/decisions) — ADRs (why each choice was made)
- [`docs/migration.md`](./docs/migration.md) — how the seed repos fold in

## Status

Scaffold complete. Packages are stubs with per-package migration notes; see the migration
plan. This tree is not yet a git repo — `git init` from here to start.
