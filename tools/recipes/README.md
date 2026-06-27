# @csm-lab/recipes

TypeScript recipes that prepare CSM on-chain state on an **anvil fork** — the rewritten,
Foundry-free successor to the contracts repo's `fork.just`. Recipes **prepare state and
return what they did**; they do not assert (verification is the calling test's job).

## Install

    pnpm add @csm-lab/recipes

Peer runtime: a running anvil fork with CSM already deployed (`anvil --fork-url <RPC>`).

## Quick start

    import { connect, addKeys, operatorInfo } from '@csm-lab/recipes';

    const ctx = await connect({ module: 'csm', rpcUrl: 'http://127.0.0.1:8545' });
    const { publicKeys } = await addKeys(ctx, { noId: 0n, count: 3 });
    const info = await operatorInfo(ctx, { noId: 0n });

`connect()` reads protocol addresses (`stakingRouter`, `vebo`, `lido`, `withdrawalQueue`,
`burner`) from `LidoLocator` on-chain and merges them onto a module-suite snapshot from
`@csm-lab/receipts`. Override the snapshot per call: `connect({ module, rpcUrl, addresses })`.

## The `actAs` model

Every privileged write runs through `actAs(ctx, who, fn)` — it funds `who`
(`anvil_setBalance`), impersonates it (`anvil_impersonateAccount`), runs the body, and stops.
This replaces the Solidity `broadcast*` modifiers.

## Subpaths & gate selectors

- `@csm-lab/recipes` — shared: `connect`, `actAs`, `addKeys`, `operatorInfo`, `warpBy`,
  `snapshot`, `revert`.
- `@csm-lab/recipes/cm` — `createCuratedOperator` (cm gates `po/pto/pgo/do/eeo/iodc/iodcp` →
  `CuratedGates[0..6]`).
- `@csm-lab/recipes/csm` — `setGateAddrs` (selector `ics` → `VettedGate`). `idvtc` is 6f.

`setGateAddrs` pins the tree to IPFS (set `IPFS_API_URL` to a local `@csm-lab/ipfs-mock`,
or `PINATA_*`), or pass `cid` to skip pinning.

## Testing

Unit tests are **hermetic** — they inject a fake viem client (no network, no chain). One
opt-in integration smoke runs against a real fork:

    anvil --fork-url <hoodi RPC>            # in another shell
    ANVIL_FORK_URL=http://127.0.0.1:8545 pnpm --filter @csm-lab/recipes test

Without `ANVIL_FORK_URL` the smoke is skipped and the suite stays offline-green.

## Keeping ABIs/addresses fresh

ABIs + addresses are vendored via `@csm-lab/receipts` (`pnpm --filter @csm-lab/receipts
refresh`). The SDK maintains a parallel set via its `/update-abis`; a cross-repo parity
check is a planned follow-up (not yet wired). Recipes never import ABIs from the SDK.
