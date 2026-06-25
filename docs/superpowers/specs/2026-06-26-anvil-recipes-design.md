# Anvil recipes — design

Status: **approved (design)** · Date: 2026-06-26 · Owner: exromany

Reshapes migration step 6 (`docs/migration.md`). Brings the **non-deploy `fork.just` recipe
surface** out of `community-staking-module` and into csm-lab, rewritten to drop the Foundry
toolchain.

## Goal

Today the local-fork test bed lives in the contracts repo as `just` recipes that wrap
`forge script` against `script/fork-helpers/*.s.sol`. They prepare on-chain state on an anvil
fork (operators, keys, deposits, penalties, gate trees, rewards). We want that capability in
csm-lab as **non-interactive scenario-setup commands** — used by csm-lab's own integration
flows and by consumer test suites — so the contracts repo's `fork.just` can be retired.

Recipes **prepare state**; they do not assert. The post-condition `assertEq`s in the Solidity
helpers are dropped. Verification is the calling test's job.

## Constraints (decided)

| # | Decision | Notes |
| --- | --- | --- |
| 1 | **No Foundry in csm-lab** | No `forge`/`cast`/`solc` at build or runtime. `anvil` is the *target* chain only, reached over RPC. |
| 2 | **Surface = TS API + thin CLI** | Importable typed functions are the core; a thin CLI wraps them (one source, two entry points — mirrors the repo's services). |
| 3 | **Module × recipe = context + flat functions** | `ctx = { client, module, addresses, abis }`; shared recipes read `ctx`; module-specific recipes live in subpaths and guard on `ctx.module`. |
| 4 | **Addresses are injectable** | Consumers pass their own address book; bundled default snapshots per `(chain, module)` are a convenience. Chain = which default to load. |
| 5 | **ABIs vendored, not imported from the SDK** | Avoids the consumer→provider dependency cycle (`architecture.md`: SDK/contracts are consumers of csm-lab). |
| 6 | **anvil `state.json` deferred** | Out of scope now. Recipes take an `rpcUrl`, so the fork source (`--fork-url` now, `--load-state` later) is a launch detail, not a recipe change. |

## Scope

**In** — state manipulation against an *already-deployed* fork:
operator lifecycle, gate-tree set, rewards, `warp`/`snapshot`/`revert`/`topup`, cl-mock
wiring, `createCuratedOperator`, cm's `createOperatorGroup`/bond-curve, the `seedCm` composite.

**Out** — `deploy-*`/scratch deploy (irreducibly `forge script` + bytecode); the `test-*`
orchestration flows; governance/upgrade sims (`vote-add-module`, `vote-upgrade` →
`SimulateVote.s.sol`, moot on a fork where the module is already live); `make-fork`/`kill-fork`
(need the anvil binary → documented prerequisite); the post-condition assertions.

## Architecture — two packages

The "receipts vs recipes" naming names two real things, split by lifecycle per the repo's
bucket model. The existing `fixtures/receipts` stub is *already* scoped for the data half
(its `package.json`: "typed, importable contract addresses & ABIs").

```
csm-lab/
├── fixtures/
│   └── receipts/    @csm-lab/receipts   DATA: ABIs + addresses per (chain, module)   ← fulfills existing stub
└── tools/
    └── recipes/     @csm-lab/recipes    TOOL: TS API + thin CLI (rewritten fork.just)   ← NEW

    @csm-lab/recipes ──depends on──▶ @csm-lab/receipts
    (no runtime dep on lido-csm-sdk, contracts, forge, or cast; anvil = target over RPC only)
```

- **`@csm-lab/receipts`** (`fixtures/*`, zero runtime): committed ABI + address JSON, a typed
  `src/index.ts`, and a human-run `refresh.ts`. The only thing that touches the contracts repo,
  and only at refresh time.
- **`@csm-lab/recipes`** (`tools/*`, like `merkle`): the commands. Imports ABIs + default
  addresses from receipts; every recipe's `ctx` can override addresses.

Recipes is also the **integration capstone**: `setGateAddrs` uses `@csm-lab/merkle`;
`makeRewards` uses `merkle` + `ipfs-mock`; `clActivate` uses `cl-mock`. What `fork.just` glues
via three separate `npx` tools becomes typed in-repo imports.

## Context model & the impersonation engine

`connect()` is the only place chain/addresses/module resolve. One privilege-escalation helper
replaces all the `broadcast*` modifiers in `script/fork-helpers/NodeOperators.s.sol`.

```ts
const ctx = connect({
  rpcUrl,                 // a RUNNING anvil fork (impersonation needs anvil, not a real node)
  module: 'cm',           // 'csm' | 'cm' | 'csm0x02'
  addresses?,             // optional override; else default snapshot for (detected chainId, module)
  clMockUrl?,             // optional; only clActivate needs it
})
// ctx = { client, module, addresses, abis, clMockUrl? }  — client is a viem client with anvil actions

// resolve a privileged account on-chain, fund it, act as it, stop. Every write recipe uses it.
async function actAs<T>(ctx, who: Address, fn: (from: Address) => Promise<T>): Promise<T> {
  await ctx.client.setBalance({ address: who, value: parseEther('100') })  // anvil_setBalance
  await ctx.client.impersonateAccount({ address: who })                    // anvil_impersonateAccount
  try { return await fn(who) }
  finally { await ctx.client.stopImpersonatingAccount({ address: who }) }
}
const roleMember = (ctx, c, role) => read(ctx, c, 'getRoleMember', [role, 0n])
```

A recipe is a near-mechanical transcription of its `.s.sol` twin:

```ts
export async function addKeys(ctx, { noId, count }) {                 // was broadcastManager(noId)
  const { managerAddress } = await read(ctx, 'CSModule', 'getNodeOperator', [noId])
  const value = await read(ctx, 'Accounting', 'getRequiredBondForNextKeys', [noId, count])
  const keys = randomBytes(48 * count), signatures = randomBytes(96 * count)
  return actAs(ctx, managerAddress, (from) =>
    write(ctx, 'CSModule', 'addValidatorKeysETH', [managerAddress, noId, count, keys, signatures],
          { from, value }))
}
```

Which privileged account each write needs (`stakingRouter` for deposit/unvet/exit, `verifier`
for slash/withdraw, resolved role-members for penalties) transcribes verbatim from the Solidity
modifiers into `actAs(ctx, …)`. Nothing is invented — that is why this is a rewrite, not a
reimplementation.

### Conventions

- **No post-assertions.** A revert throws naturally via viem. *Input* guards (e.g.
  `reportBalance`'s "key index out of bounds") stay as thrown `Error`s — API hygiene, not a test
  assert.
- **Reads return structured, typed data.** The console-table readers (`operatorInfo`,
  `bondInfo`, `operatorKeys`) return objects; only the **CLI** formats them as tables.
- **Writes return what they mint** (`createCuratedOperator` → `noId`, `addKeys` → pubkeys) so
  test setup can chain.

## Recipe inventory & module matrix

**Shared core** — `@csm-lab/recipes` (work on any module via `ctx`):

| Group | Recipes | Source |
| --- | --- | --- |
| Operator lifecycle | propose/confirm manager+reward (×4), `addKeys`, `removeKey`, `deposit`, `unvet`, `exit`, `slash`, `withdraw`, `targetLimit` (+forced/off), penalty report/cancel/settle/compensate (×4), `addBond`, `createBondDebt`, `exitRequest` (VEBO 2-step), `activateKeys`, `reportBalance`, `increaseAllocatedBalance`, `topUpActiveKeys` | `NodeOperators.s.sol` |
| Reads (typed; CLI tabulates) | `operatorsCount`, `operatorKey(s)`, `operatorInfo`, `bondInfo`, `keyAllocatedBalance(s)`, `getCurveInfo` | `NodeOperators.s.sol`, `fork.just` |
| Chain ops (pure anvil RPC) | `warp`, `snapshot`, `revert`, `topup` | `fork.just`, `Common.sol` |
| Gate tree (→ `@csm-lab/merkle`) | `setGateTree` (root+cid), `setGateAddrs` (build then set), `getGateTree` | `fork.just` (`update-gate-tree`/`set-gate-addrs`) |
| Rewards (→ `merkle` + `ipfs-mock`) | `makeRewards` + `submitRewards` | `mock-rewards.mjs`, `OracleReport.s.sol` |
| CL bridge (→ `@csm-lab/cl-mock`) | `clActivate` (read pubkey+balance on-chain → set CL status) | `cl-mock.just` |

**Module-specific** — subpaths, guard on `ctx.module`:

| Subpath | Recipes | Source |
| --- | --- | --- |
| `@csm-lab/recipes/cm` | `createOperatorGroup`, `resetOperatorGroup`, `setBondCurveWeight`, `createCuratedOperator`, `seedCm`; curated gate selectors `po/pto/pgo/do/eeo/iodc/iodcp` | `curated.just`, `MetaRegistryHelpers.s.sol`, `NodeOperators.s.sol` |
| `@csm-lab/recipes/csm` | gate selectors `ics`(VettedGate), `idvtc`; thin — lifecycle is shared | `fork.just` `_resolve-gate-addr` |
| `@csm-lab/recipes/csm0x02` | placeholder; inherits shared, add specifics when it lands | — |

Gate selector resolution (`_resolve-gate-addr` in `fork.just`) is module-aware and the exact
per-module gate/creation split is pinned during planning from that recipe.

Estimated ~40 recipes total.

### `makeRewards` note

`script/mock-rewards.mjs` is *already* Node + `@openzeppelin/merkle-tree` (what `tools/merkle`
wraps). De-Foundry edits: swap its `cast call` shell-outs for viem reads; its Pinata pinning can
point at `ipfs-mock`. `submitRewards` (fund FeeDistributor, warp to next consensus frame,
impersonate fast-lane consensus members → `submitReport` → `submitReportData`) is the same
`actAs` pattern as everything else.

## Data: the receipts package & refresh

```
fixtures/receipts/
├── data/
│   ├── abi/<Contract>.json          # CSModule, Accounting, FeeOracle, FeeDistributor, VEBO,
│   │                                 #   StakingRouter, HashConsensus, Lido, VettedGate,
│   │                                 #   CuratedGate, ParametersRegistry, Verifier, …
│   └── <chain>/deploy-<chain>.json  # + <chain>/curated/ for cm
├── src/index.ts                      # re-exports JSON `as const` → abitype-typed for viem
└── scripts/refresh.ts                # human-run, NO solc
```

`refresh.ts` takes a contracts-checkout path (flag/env) and extracts **ABIs** from the `.abi`
field of `out/<C>.sol/<C>.json` (copying forge's *existing* build output, not compiling) and
**addresses** from `artifacts/<chain>/`. Writes committed JSON, regenerates the typed index. The
only precondition is the checkout has been built once (`forge build` happens *there*). Mirrors
ADR-0001 #8.

## Fork prerequisite, cl-mock, testing

- **Prerequisite:** recipes target a running anvil fork with CSM already deployed — today
  `anvil --fork-url <hoodi|mainnet RPC>`. `ctx` takes `rpcUrl`. The compose `anvil` service is
  currently bare; driving recipes against it needs a `--fork-url` (env-supplied) — a small
  related compose tweak. `state.json` later → `--load-state`, same recipes.
- **cl-mock:** `ctx.clMockUrl` is optional; only `clActivate` (the chain-aware bridge) lives in
  recipes — raw `cl-set`/`cl-list` stay in cl-mock's own CLI.
- **Testing (hermetic, per CLAUDE.md):** unit tests inject a **fake viem client** — assert the
  right calls, encodings, and `impersonate → send → stop` sequence; pin deterministic merkle
  roots/CIDs as the merkle tests do. A single opt-in integration smoke (against compose anvil
  forked off hoodi) stays *out* of the default `test` run. Determinism hook: `addKeys`' random
  keys and `makeRewards`' `Math.random`/`Date.now` take an injectable seed/clock.

## Open questions / deferred

- **`state.json` snapshot** — deferred; revisit for a fully offline (no upstream RPC) test bed.
- **Governance/upgrade sims** — out now; revisit if scratch-deploy scenarios are ever needed
  here (would require a deploy story that doesn't pull Foundry).
- **Exact per-module gate/creation split** — pinned during planning from `_resolve-gate-addr`.
- **csm0x02** — module entry + specifics added when the module lands.

## Source references (contracts repo)

`Justfile`, `fork.just`, `cl-mock.just`, `csm.just`, `curated.just`, `csm0x02.just`;
`script/fork-helpers/{Common,NodeOperators,OracleReport,MetaRegistryHelpers,Roles,SimulateVote}.s.sol`;
`script/mock-rewards.mjs`; `artifacts/<chain>/deploy-<chain>.json`; `out/<C>.sol/<C>.json`.
