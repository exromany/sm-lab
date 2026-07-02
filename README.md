# sm-lab

Monorepo of testing & emulation utilities for **Lido SM** (Staking Modules).

It gives you the pieces to stand up a Lido staking module in a controlled environment — a Beacon API mock,
an IPFS/Pinata emulator, a merkle-tree builder, a BLS deposit-key generator, anvil
state recipes, and versioned deploy fixtures — and publishes them so the contracts, SDK,
and widget repos can consume them as dependencies.

```bash
pnpm install
pnpm build          # turbo, all packages
pnpm stack:up       # cl-mock + ipfs-mock + anvil — a full offline SM test bed
```

## Layout

| Path                | Package            | What                                                            | From            |
| ------------------- | ------------------ | --------------------------------------------------------------- | --------------- |
| `apps/cl`           | `@sm-lab/cl`       | Consensus Layer (Beacon API) mock                               | `csm-test-cl`   |
| `apps/ipfs`         | `@sm-lab/ipfs`     | Pinata/IPFS emulator, deterministic CIDs                        | new             |
| `tools/merkle`      | `@sm-lab/merkle`   | addresses (vetted gate) + strikes + rewards merkle tree builder | `csm-test-tree` |
| `tools/keys`        | `@sm-lab/keys`     | BLS validator deposit-data generator                            | new             |
| `tools/recipes`     | `@sm-lab/recipes`  | anvil SM-state recipes + `sm-recipes` CLI                       | `fork.just`     |
| `fixtures/receipts` | `@sm-lab/receipts` | typed anvil/deploy snapshots                                    | contracts repo  |
| `packages/core`     | `@sm-lab/core`     | shared internals (bundled, not published)                       | —               |
| `packages/config`   | `@sm-lab/config`   | tsconfig + tsdown + oxlint presets                              | —               |

The four-bucket split (`apps` / `tools` / `fixtures` / `packages`) is by **lifecycle**, not
topic — see [`docs/architecture.md`](./docs/architecture.md).

## Stack

pnpm · Turborepo · tsdown (Rolldown+Oxc) · oxlint · Vitest · Changesets · TS-strict ESM.
All tooling config is centralized in `@sm-lab/config`.

## Docs

- [`docs/architecture.md`](./docs/architecture.md) — design of record
- [`docs/decisions/`](./docs/decisions) — ADRs (why each choice was made)
