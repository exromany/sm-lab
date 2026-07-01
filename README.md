# csm-lab

Monorepo of testing & emulation utilities for **Lido CSM** (Community Staking Module).

It gives you the pieces to stand up CSM in a controlled environment — a Beacon API mock,
an IPFS/Pinata emulator, a merkle-tree builder, a BLS deposit-key generator, anvil
state recipes, and versioned deploy fixtures — and publishes them so the contracts, SDK,
and widget repos can consume them as dependencies.

```bash
pnpm install
pnpm build          # turbo, all packages
pnpm stack:up       # cl-mock + ipfs-mock + anvil — a full offline CSM test bed
```

## Layout

| Path                | Package              | What                                        | From            |
| ------------------- | -------------------- | ------------------------------------------- | --------------- |
| `apps/cl-mock`      | `@sm-lab/cl-mock`   | Consensus Layer (Beacon API) mock           | `csm-test-cl`   |
| `apps/ipfs-mock`    | `@sm-lab/ipfs-mock` | Pinata/IPFS emulator, deterministic CIDs    | new             |
| `tools/merkle`      | `@sm-lab/merkle`    | ICS + strikes merkle tree builder           | `csm-test-tree` |
| `tools/keys`        | `@sm-lab/keys`      | BLS validator deposit-data generator        | new             |
| `tools/recipes`     | `@sm-lab/recipes`   | anvil CSM-state recipes + `csm-recipes` CLI | `fork.just`     |
| `fixtures/receipts` | `@sm-lab/receipts`  | typed anvil/deploy snapshots                | contracts repo  |
| `packages/core`     | `@sm-lab/core`      | shared internals (bundled, not published)   | —               |
| `packages/config`   | `@sm-lab/config`    | tsconfig + tsdown + oxlint presets          | —               |

The four-bucket split (`apps` / `tools` / `fixtures` / `packages`) is by **lifecycle**, not
topic — see [`docs/architecture.md`](./docs/architecture.md).

## Stack

pnpm · Turborepo · tsdown (Rolldown+Oxc) · oxlint · Vitest · Changesets · TS-strict ESM.
All tooling config is centralized in `@sm-lab/config`.

## Docs

- [`docs/architecture.md`](./docs/architecture.md) — design of record
- [`docs/decisions/`](./docs/decisions) — ADRs (why each choice was made)
- [`docs/migration.md`](./docs/migration.md) — how the seed repos fold in

## Status

Migration steps 1–6 are done: `cl-mock`, `ipfs-mock`, `merkle`, `keys`, `recipes` (+ the
`csm-recipes` CLI), `receipts`, and the shared `core`/`config` packages are built, tested,
and green. CI runs turbo checks + Changesets releases; the coordinated first npm publish of
`recipes`/`merkle`/`receipts` is the remaining release action. See
[`docs/migration.md`](./docs/migration.md) for per-step detail.
