# sm-lab

Monorepo of testing & emulation utilities for **Lido SM** (Staking Modules).

It gives you the pieces to stand up a Lido staking module in a controlled environment — a Beacon API mock,
an IPFS/Pinata emulator, a merkle-tree builder, a BLS deposit-key generator, anvil
state recipes, and versioned deploy fixtures — and publishes them so the contracts, SDK,
and widget repos can consume them as dependencies.

## Use the published CLIs

All seven runtime packages are on [npm](https://www.npmjs.com/org/sm-lab) — run any CLI with `npx`
(no install), or `npm i -g @sm-lab/<pkg>`:

```bash
npx @sm-lab/cl serve            # sm-cl      — Consensus Layer (Beacon API) mock
npx @sm-lab/ipfs serve          # sm-ipfs    — Pinata/IPFS emulator
npx @sm-lab/merkle --help       # sm-merkle  — addresses/strikes/rewards tree builder
npx @sm-lab/keys 5              # sm-keys    — BLS validator deposit-data generator
npx @sm-lab/recipes --help      # sm-recipes — anvil SM-state recipes
npx @sm-lab/anvil               # sm-anvil   — anvil forking mainnet + baked SM upgrade
```

`@sm-lab/receipts` is a library (no CLI) — `pnpm add @sm-lab/receipts`.

## Local development

```bash
pnpm install
pnpm build          # turbo, all packages
pnpm stack:up       # cl-mock + ipfs-mock + anvil — a full offline SM test bed
```

### Anvil with the upgraded mainnet state

[`@sm-lab/anvil`](https://www.npmjs.com/package/@sm-lab/anvil) boots anvil forking mainnet with
the SM upgrade state (`apps/anvil/state/mainnet-upgraded.state.json`) overlaid — in one command:

```bash
npx @sm-lab/anvil                     # anvil on :8545 with the upgrade overlaid
npx @sm-lab/anvil --host 0.0.0.0      # flags pass straight through to anvil
```

Prerequisites `npx` can't supply: **Foundry** (the `anvil` binary) on PATH, and a **mainnet
archive** RPC via `MAINNET_RPC_URL` (or `ANVIL_FORK_URL` / `ETH_RPC_URL`) in the environment or
a `.env` in the current directory — it must serve block `25523407`.

It's a **fork dump** — only the contracts the upgrade touched are captured, so anvil forks
mainnet behind the overlay and un-captured reads (LidoLocator, stETH, …) fall through to the RPC.
See [`apps/anvil`](./apps/anvil) for details.

## Layout

| Path                | Package                                                              | What                                                            | From              |
| ------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------- |
| `apps/cl`           | [`@sm-lab/cl`](https://www.npmjs.com/package/@sm-lab/cl)             | Consensus Layer (Beacon API) mock                               | `csm-test-cl`     |
| `apps/ipfs`         | [`@sm-lab/ipfs`](https://www.npmjs.com/package/@sm-lab/ipfs)         | Pinata/IPFS emulator, deterministic CIDs                        | new               |
| `apps/anvil`        | [`@sm-lab/anvil`](https://www.npmjs.com/package/@sm-lab/anvil)       | anvil forking mainnet + baked SM upgrade state                  | `staking-modules` |
| `tools/merkle`      | [`@sm-lab/merkle`](https://www.npmjs.com/package/@sm-lab/merkle)     | addresses (vetted gate) + strikes + rewards merkle tree builder | `csm-test-tree`   |
| `tools/keys`        | [`@sm-lab/keys`](https://www.npmjs.com/package/@sm-lab/keys)         | BLS validator deposit-data generator                            | new               |
| `tools/recipes`     | [`@sm-lab/recipes`](https://www.npmjs.com/package/@sm-lab/recipes)   | anvil SM-state recipes + `sm-recipes` CLI                       | `fork.just`       |
| `fixtures/receipts` | [`@sm-lab/receipts`](https://www.npmjs.com/package/@sm-lab/receipts) | typed anvil/deploy snapshots                                    | contracts repo    |
| `packages/core`     | `@sm-lab/core`                                                       | shared internals (bundled, not published)                       | —                 |
| `packages/config`   | `@sm-lab/config`                                                     | tsconfig + tsdown + oxlint presets                              | —                 |

The four-bucket split (`apps` / `tools` / `fixtures` / `packages`) is by **lifecycle**, not
topic — see [`docs/architecture.md`](./docs/architecture.md).

## Stack

pnpm · Turborepo · tsdown (Rolldown+Oxc) · oxlint · Vitest · Changesets · TS-strict ESM.
All tooling config is centralized in `@sm-lab/config`.

## Docs

- [`docs/architecture.md`](./docs/architecture.md) — design of record
- [`docs/decisions/`](./docs/decisions) — ADRs (why each choice was made)
