# @csm-lab/receipts

Versioned, typed snapshots of CSM contract ABIs and deploy addresses. Replaces ad-hoc `deploy.json`
files copied between repos and the `DEPLOY_JSON_PATH` env-var dance.

```ts
import { addresses, csModuleAbi, manifest } from '@csm-lab/receipts';

addresses.hoodi.csm; // typed address string, autocompleted, compile-checked
addresses.mainnet.csm;
```

## What's inside

| Path                         | Contents                                                                    |
| ---------------------------- | --------------------------------------------------------------------------- |
| `src/abi/*.ts`               | One `as const` TypeScript module per contract (`csModuleAbi`, `vEBOAbi`, …) |
| `src/index.ts`               | Re-exports `addresses`, all ABI consts, and `manifest`                      |
| `data/<chain>/<module>.json` | Per-(chain, module) address book                                            |
| `data/manifest.json`         | Contracts `git-ref`(s) + per-ABI sha256 hashes (provenance record)          |
| `scripts/refresh.ts`         | CLI that populates the above from a local contracts checkout                |

Public surface:

```ts
import { addresses, csModuleAbi, vEBOAbi, manifest } from '@csm-lab/receipts';
//       ^^^^^^^^^ { hoodi: { csm, cm }, mainnet: { csm } }
```

Available chains/modules: `hoodi.csm`, `hoodi.cm`, `mainnet.csm`.
`mainnet/cm` is intentionally absent — no curated mainnet deployment exists yet.

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

## Refreshing snapshots

Run per-target when a deployment or contract changes:

```bash
pnpm --filter @csm-lab/receipts refresh -- \
  --chain <hoodi|mainnet> \
  --module <csm|cm> \
  [--contracts <path-to-community-staking-module>] \
  [--config <relative-path-inside-contracts-repo>] \
  [--force]
```

`--contracts` defaults to `../../../community-staking-module` — a sibling of the csm-lab repo root
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
import { libConfig } from '@csm-lab/config/tsdown';
export default libConfig();
```
