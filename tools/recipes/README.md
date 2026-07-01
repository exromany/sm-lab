# @sm-lab/recipes

TypeScript recipes that prepare CSM on-chain state on an **anvil fork** — the rewritten,
Foundry-free successor to the contracts repo's `fork.just`. Recipes **prepare state and
return what they did**; they do not assert (verification is the calling test's job).

## Install

    pnpm add @sm-lab/recipes

Peer runtime: a running anvil fork with CSM already deployed (`anvil --fork-url <RPC>`).

## Quick start

```js
import { connect, addKeys, operatorInfo } from '@sm-lab/recipes';

const ctx = await connect({ module: 'csm', rpcUrl: 'http://127.0.0.1:8545' });
const { publicKeys } = await addKeys(ctx, { noId: 0n, count: 3 });
const info = await operatorInfo(ctx, { noId: 0n });
```

`connect()` reads protocol addresses (`stakingRouter`, `vebo`, `lido`, `withdrawalQueue`,
`burner`) from `LidoLocator` on-chain and merges them onto a module-suite snapshot from
`@sm-lab/receipts`. Override the snapshot per call: `connect({ module, rpcUrl, addresses })`.

## CLI (`sm-recipes`)

A run-and-exit CLI over the recipe surface. Same `bin` underpins every route:

```bash
npx @sm-lab/recipes cm seed --rpc-url http://127.0.0.1:8545   # published
npm i -g @sm-lab/recipes && sm-recipes --help                # global install
node tools/recipes/dist/cli.mjs --help                         # built dist (repo dev)
```

Global flags: `--rpc-url` (or `RPC_URL`, defaulting to anvil's `http://127.0.0.1:8545`),
`--module <csm|cm>`, `--cl-mock-url` (or `CL_MOCK_URL`), `--json`. Amounts (`--amount`,
`--exit-balance`, …) are in **ETH** (`0.000000000000000001` = 1 wei). `sm-recipes help [command]`
mirrors `--help`.

The `cm`/`csm` groups host their own recipes **and** mirror every shared recipe with the
module pre-bound — so a shared command works two ways: top-level with `--module`, or under
the group (no `--module` needed):

```bash
sm-recipes --module csm operator-info --operator-id 0   # shared, module via flag
sm-recipes csm operator-info --operator-id 0            # same, module from the group
sm-recipes --module csm make-rewards --json
sm-recipes cm seed --seed 0x01                          # cm-only recipe
sm-recipes csm set-gate --address 0xabc... --address 0xdef...   # csm-only recipe
```

Every **required, non-repeatable** option is also accepted **positionally**, in declaration
order — so the common case needs no flags. Flags still work and can be mixed with positionals;
optional flags (e.g. `--seed`, `--pair`) stay flag-only by default.

```bash
sm-recipes csm operator-info 0          # == --operator-id 0
sm-recipes csm withdraw 0 1 32          # == --operator-id 0 --key-index 1 --exit-balance 32
sm-recipes csm add-keys 0 5 --seed 0x01 # positional id+count, optional seed via flag
```

`set-gate` opts its `<selector>` (optional) and `<address...>` (repeatable, **variadic** —
must come last) into the positional form, so the selector leads and the addresses follow:

```bash
sm-recipes csm set-gate idvtc 0xabc... 0xdef...   # == --selector idvtc --address 0xabc... --address 0xdef...
```

## The `actAs` model

Every privileged write runs through `actAs(ctx, who, fn)` — it funds `who`
(`anvil_setBalance`), impersonates it (`anvil_impersonateAccount`), runs the body, and stops.
This replaces the Solidity `broadcast*` modifiers.

## Subpaths & gate selectors

- `@sm-lab/recipes` — shared: `connect`, `actAs`, `addKeys`, `operatorInfo`, `warpBy`,
  `snapshot`, `revert`, `clActivate`.
- `@sm-lab/recipes/cm` — `createCuratedOperator` (cm gates `po/pto/pgo/do/eeo/iodc/iodcp` →
  `CuratedGates[0..6]`), MetaRegistry group/curve recipes `createOperatorGroup`,
  `resetOperatorGroup`, `setBondCurveWeight`, and `seedCm` — seed a realistic cm fork in one call
  (3 gate operators, a 34/33/33 operator group, keyed/deposited/topped-up across rounds; pass `seed`
  to make the operator addresses + keys deterministic).
- `@sm-lab/recipes/csm` — `setGateAddrs` (selector `ics` → `VettedGate`). `idvtc` →
  `IdentifiedDVTClusterGate` (v3-only, hoodi; resolves the address only — throws on
  mainnet/v2 snapshots that lack it).

`setGateAddrs` pins the tree to IPFS (set `IPFS_API_URL` to a local `@sm-lab/ipfs`,
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

    import { makeRewards, submitRewards } from '@sm-lab/recipes';
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

`clActivate(ctx, { noId, keyIndex })` is the only chain-aware `@sm-lab/cl` bridge in
recipes. It requires `ctx.clMockUrl` (pass it via `connect({ module, rpcUrl, clMockUrl })`),
reads the key's pubkey + allocated balance on-chain, then marks the validator `active_ongoing`
on the running cl-mock with effective balance = `32 ETH + allocated`, in gwei (full precision,
flooring sub-gwei dust — diverging from the source's integer-ETH truncation). Raw `cl-set` /
`cl-list` stay in cl-mock's own CLI.

## Testing

Unit tests are **hermetic** — they inject a fake viem client (no network, no chain). One
opt-in integration smoke runs against a real fork:

    anvil --fork-url <hoodi RPC>            # in another shell
    ANVIL_FORK_URL=http://127.0.0.1:8545 pnpm --filter @sm-lab/recipes test

Without `ANVIL_FORK_URL` the smoke is skipped and the suite stays offline-green.

## Keeping ABIs/addresses fresh

ABIs + addresses are vendored via `@sm-lab/receipts` (`pnpm --filter @sm-lab/receipts
refresh`). The SDK maintains a parallel set via its `/update-abis`; a cross-repo parity
check is a planned follow-up (not yet wired). Recipes never import ABIs from the SDK.
