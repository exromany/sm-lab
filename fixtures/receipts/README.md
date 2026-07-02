# @sm-lab/receipts

Versioned, typed snapshots of Lido SM contract ABIs and deploy addresses. Replaces ad-hoc `deploy.json`
files copied between repos and the `DEPLOY_JSON_PATH` env-var dance.

```ts
import { addresses, csModuleAbi, manifest } from '@sm-lab/receipts';

addresses.hoodi.csm; // typed address string, autocompleted, compile-checked
addresses.mainnet.csm;
```

## What's inside

| Path                         | Contents                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `src/abi/*.ts`               | One `as const` TypeScript module per contract (`csModuleAbi`, `vEBOAbi`, …)   |
| `src/index.ts`               | Re-exports `addresses`, all ABI consts, and `manifest`                        |
| `data/<chain>/<module>.json` | Per-(chain, module) address book                                              |
| `data/manifest.json`         | Contracts `git-ref`(s) + per-ABI sha256 hashes + optional protocol provenance |
| `scripts/refresh.ts`         | CLI that populates the above from a local contracts checkout                  |

Public surface:

```ts
import { addresses, csModuleAbi, vEBOAbi, manifest } from '@sm-lab/receipts';
//       ^^^^^^^^^ { hoodi: { csm, cm }, mainnet: { csm } }
```

Available chains/modules: `hoodi.csm`, `hoodi.cm`, `mainnet.csm`.
`mainnet/cm` is intentionally absent — no curated mainnet deployment exists yet.

## Address book shape

Each `data/<chain>/<module>.json` is an **allowlist-curated, strictly-typed** set of addresses.
Only proxy and gate contracts that SM recipes actually use are included. `DeployParams`, `*Impl`
addresses, and linked library entries present in the upstream deploy config are intentionally
dropped — committing them here would add noise without value and they change on every upgrade.

> **Warning:** if you copy addresses from the raw upstream deploy config and notice extra keys
> (`*Impl`, `DeployParams`, `libraries`, …), those are not in `@sm-lab/receipts` by design.

Each book may also contain an optional `protocol` block with 6 addresses sourced directly
from the on-chain `LidoLocator` contract (see [Protocol block](#protocol-block) below).

## Protocol block

The `protocol` field in each address book holds addresses resolved by calling the canonical
getter methods on the deployed `LidoLocator` contract:

| Key                       | LidoLocator getter          |
| ------------------------- | --------------------------- |
| `lido`                    | `lido()`                    |
| `withdrawalVault`         | `withdrawalVault()`         |
| `validatorsExitBusOracle` | `validatorsExitBusOracle()` |
| `stakingRouter`           | `stakingRouter()`           |
| `burner`                  | `burner()`                  |
| `withdrawalQueue`         | `withdrawalQueue()`         |

These are the addresses that `@sm-lab/recipes`'s `connect()` and the `@sm-lab/keys` tool
need at runtime. When a `protocol` block is present in the committed data, both consumers
prefer it over resolving the addresses at runtime; they fall back to their previous runtime
resolution when it is absent.

`manifest.protocolResolvedAt` records provenance for the last enrichment:

```json
{
  "protocolResolvedAt": {
    "hoodi/csm": { "chainId": 560048, "block": 1234567 },
    "mainnet/csm": { "chainId": 1, "block": 654321 }
  }
}
```

**The `protocol` blocks are not populated in the initial committed data** — they require a live
RPC. Run enrichment once an RPC is available (see [Enriching protocol addresses](#enriching-protocol-addresses)).

## How ABIs and addresses are sourced

No Solidity toolchain runs here. The `refresh` script only reads Forge's existing build output
from a local checkout of `community-staking-module`:

- **ABIs** — read from `out/<Contract>.sol/<Contract>.json` (`.abi` field). Several contracts are
  interface-mapped so the ABI matches the actual public surface:

  | Upstream contract | Artifact read    |
  | ----------------- | ---------------- |
  | `VEBO`            | `IVEBO`          |
  | `StakingRouter`   | `IStakingRouter` |
  | `Lido`            | `ILido`          |
  | `LidoLocator`     | `ILidoLocator`   |
  | all others        | same name        |

- **Addresses** — read from `artifacts/<chain>[/curated]/deploy-<chain>.json`.

The extracted snapshots are committed here. Consumers get reproducible, offline reads with no
Forge dependency.

## Enriching protocol addresses

To populate (or refresh) the `protocol` block in the committed address data, pass `--rpc` (or
set the matching env var) when running `refresh`:

```bash
# hoodi csm — explicit flag
pnpm --filter @sm-lab/receipts refresh --chain hoodi --module csm --rpc <url>

# hoodi csm — via env var
HOODI_RPC_URL=<url> pnpm --filter @sm-lab/receipts refresh --chain hoodi --module csm

# mainnet csm — via generic fallback
ETH_RPC_URL=<url> pnpm --filter @sm-lab/receipts refresh --chain mainnet --module csm
```

RPC URL resolution order: `--rpc` flag → `<CHAIN>_RPC_URL` (uppercased chain name) → `ETH_RPC_URL`.

**Without an RPC** the enrichment step is skipped entirely and any existing `protocol` block
already in `data/<chain>/<module>.json` is carried forward unchanged (no data loss). This
means you can run a plain ABI/address refresh without a live node and the protocol provenance
remains intact.

After enriching, commit the updated `data/` files together with the updated `manifest.json`
(`protocolResolvedAt` is written there).

## Refreshing snapshots

Run per-target when a deployment or contract changes:

```bash
pnpm --filter @sm-lab/receipts refresh -- \
  --chain <hoodi|mainnet> \
  --module <csm|cm> \
  [--contracts <path-to-community-staking-module>] \
  [--config <relative-path-inside-contracts-repo>] \
  [--force]
```

`--contracts` defaults to `../../../community-staking-module` — a sibling of the sm-lab repo root
(relative paths resolve from the package root, `fixtures/receipts/`). `--force` bypasses
the git-ref guard (see below).

`--config` overrides which JSON file inside the contracts repo to read addresses from. Use it to
point at the **latest** upgrade config per the contracts repo's `.env` `DEPLOY_CONFIG` value —
CSM has been upgraded twice (v2, v3); proxy addresses are stable across upgrades but `*Impl`
addresses change and new contracts are added. Current per-(chain, module) configs:

| chain   | module | config path                                 | version |
| ------- | ------ | ------------------------------------------- | ------- |
| hoodi   | csm    | `artifacts/hoodi/upgrade-v3-hoodi.json`     | v3      |
| hoodi   | cm     | `artifacts/hoodi/curated/deploy-hoodi.json` | —       |
| mainnet | csm    | `artifacts/mainnet/deploy-mainnet.json`     | v2      |

If `--config` is omitted, the default is `artifacts/<chain>/deploy-<chain>.json` (or
`artifacts/<chain>/curated/deploy-<chain>.json` for cm). Only override when the authoritative
config for that chain has moved to an upgrade file.

After refreshing, commit the updated `data/` and `src/abi/` files together.

## Drift guard

The manifest records the `git-ref` from the contracts checkout at refresh time. On subsequent
runs, the guard refuses to write addresses from a _different_ deployment's `git-ref` against the
already-committed ABIs unless `--force` is passed. This prevents silently pairing addresses with
ABIs from a mismatched contracts version.

## Sibling SDK note

`lido-csm-sdk` maintains its own ABI copy via its `/update-abis` script. After refreshing here,
check whether the SDK needs a matching update — it applies an `Accounting.deposit*` overload
filter that may need adjustment if the ABI changes.

## Build

```ts
// tsdown.config.ts
import { libConfig } from '@sm-lab/config/tsdown';
export default libConfig();
```
