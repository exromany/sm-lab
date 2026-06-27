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
  `snapshot`, `revert`, `clActivate`.
- `@csm-lab/recipes/cm` — `createCuratedOperator` (cm gates `po/pto/pgo/do/eeo/iodc/iodcp` →
  `CuratedGates[0..6]`), MetaRegistry group/curve recipes `createOperatorGroup`,
  `resetOperatorGroup`, `setBondCurveWeight`, and `seedCm` — seed a realistic cm fork in one call
  (3 gate operators, a 34/33/33 operator group, keyed/deposited/topped-up across rounds; pass `seed`
  to make the operator addresses + keys deterministic).
- `@csm-lab/recipes/csm` — `setGateAddrs` (selector `ics` → `VettedGate`). `idvtc` →
  `IdentifiedDVTClusterGate` (v3-only, hoodi; resolves the address only — throws on
  mainnet/v2 snapshots that lack it).

`setGateAddrs` pins the tree to IPFS (set `IPFS_API_URL` to a local `@csm-lab/ipfs-mock`,
or `PINATA_*`), or pass `cid` to skip pinning.

## Top-up (`allocateDeposits` as the StakingRouter)

- `increaseAllocatedBalance(ctx, { noId, keyIndex, amountWei })` — top up one deposited key's
  allocated balance (validates the key exists and is not withdrawn). Returns `{ amountWei }`.
- `topUpActiveKeys(ctx, { noId })` — top up every not-yet-allocated, not-withdrawn deposited key,
  one at a time in ascending key-index order (FIFO `TopUpQueueOps`, capped at 2016 ETH per key).
  Returns `{ toppedUp }` (a no-op `{ toppedUp: 0 }` when nothing needs it).

## Rewards (`makeRewards` → `submitRewards`)

`makeRewards(ctx, opts?)` builds the cumulative FeeDistributor rewards tree off on-chain
operator state and a seeded mock reward per active key, pins the tree + report log to IPFS,
and returns a typed in-memory `RewardsReport` (`treeRoot`, `treeCid`, `logCid`, `distributed`,
`rebate`, `treeDump`, `cumulatives`). It builds the data half of an oracle report.

`submitRewards(ctx, report)` consumes that report and submits it on-chain: it funds the
FeeDistributor (if `pendingSharesToDistribute` can't cover the frame), warps to the next valid
consensus frame, builds the `ReportData` tuple, reaches consensus across the fast-lane members
(falling back to `getMembers` when the fast-lane set is empty), and submits the report data as
`members[0]`. A zero-root report is a graceful no-op (`{ submitted: false }`), so
`submitRewards(ctx, await makeRewards(ctx))` composes on an empty fork.

    import { makeRewards, submitRewards } from '@csm-lab/recipes';
    const report = await makeRewards(ctx, { seed: '0x…', treeCid: 'cid-t', logCid: 'cid-l' });
    const { submitted, refSlot, reportHash } = await submitRewards(ctx, report);

- `seed` — deterministic per-key reward draw (keccak hash-chain, like `randomKeys`). Omit for
  fresh randomness; pass a fixed `Hex` to pin `treeRoot`/`distributed` in tests.
- `previousCumulatives` — carry-forward input (`Map<bigint,bigint>` or `[bigint,bigint][]`).
  Every prior leaf is carried forward (the `uint64`-max pad excluded) before this frame's deltas
  are added. Chain frames by feeding a prior result's `cumulatives` back in.
- IPFS pin — same env switch as `setGateAddrs` (`IPFS_API_URL` → local mock, or `PINATA_*`).
  The guard fails fast (before any network) when pinning is needed but unconfigured.
- Escape hatches — pass `treeCid` and/or `logCid` to skip that pin (hermetic tests do this).
  An empty report (no active keys, no carry-forward) returns a zero root and pins nothing.
- `submitRewards` is fork-only in practice (it WRITES + warps over RPC). IPFS only matters via
  `makeRewards` — `submitRewards` itself consumes the report's `treeCid`/`logCid` verbatim. The
  consensus-frame wait uses `warpTo` (`setNextBlockTimestamp` + `mine`), the absolute counterpart
  of `warpBy`.

## CL bridge (cl-mock)

`clActivate(ctx, { noId, keyIndex })` is the only chain-aware `@csm-lab/cl-mock` bridge in
recipes. It requires `ctx.clMockUrl` (pass it via `connect({ module, rpcUrl, clMockUrl })`),
reads the key's pubkey + allocated balance on-chain, then marks the validator `active_ongoing`
on the running cl-mock with effective balance = `32 ETH + allocated`, in gwei (full precision,
flooring sub-gwei dust — diverging from the source's integer-ETH truncation). Raw `cl-set` /
`cl-list` stay in cl-mock's own CLI.

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
