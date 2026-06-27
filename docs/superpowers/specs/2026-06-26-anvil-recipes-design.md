# Anvil recipes — design

Status: **approved (design), revised after parallel review** · Date: 2026-06-26 · Owner: exromany

Reshapes migration step 6 (`docs/migration.md`) into a sequence of independently-shippable
increments. Brings the **non-deploy `fork.just` recipe surface** out of
`community-staking-module` and into csm-lab, rewritten to drop the Foundry toolchain.

> **Review note.** This revision incorporates a four-lens parallel design review (feasibility,
> contracts-domain correctness, maintainability/drift, scope). Material corrections: the address
> model (protocol addresses are locator-resolved, not snapshot data), the ABI source map
> (interface-only ABIs), drift detection (manifest + CI parity), several "don't transcribe
> verbatim" hazards, a simpler abstraction (no `read`/`write` DSL), and decomposition into
> increments 6a–6g.

## Goal

Today the local-fork test bed lives in the contracts repo as `just` recipes that wrap
`forge script` against `script/fork-helpers/*.s.sol`. They prepare on-chain state on an anvil
fork (operators, keys, deposits, penalties, gate trees, rewards). We want that capability in
csm-lab as **non-interactive scenario-setup commands** — used by csm-lab's own integration
flows and by consumer test suites — so the contracts repo's `fork.just` can be retired.

Recipes **prepare state**; they do not assert. The post-condition `assertEq`s in the Solidity
helpers are dropped; instead recipes **return what they did** and **throw on no-op / bad input**.
Verification is the calling test's job.

## Constraints (decided)

| # | Decision | Notes |
| --- | --- | --- |
| 1 | **No Foundry in csm-lab** | No `forge`/`cast`/`solc` at build or runtime. `anvil` is the *target* chain only, reached over RPC. |
| 2 | **Surface = TS API; CLI deferred** | Importable typed functions are the core. A thin CLI is a *later* increment (6g), only if a human consumer materializes — no named user today. |
| 3 | **Module × recipe = context + flat functions** | `ctx = { client, module, addresses, abis, clMockUrl? }`; shared recipes resolve the module via `ctx.module`; module-specific recipes live in subpaths and guard on `ctx.module`. |
| 4 | **Addresses: snapshot + locator-resolved** | Module-suite addresses come from an injectable snapshot (consumer-overridable). **Protocol addresses (`StakingRouter`, `VEBO`, `Lido`, …) are NOT in the snapshot — `connect()` resolves them from `LidoLocator` on-chain.** The snapshot must be sourced from the **latest per-chain upgrade config** (CSM has been upgraded twice; proxy addresses are stable across v2/v3, but `*Impl` addresses and added contracts — `VerifierV3`, `CircuitBreaker`, `IdentifiedDVTClusterGate` — are only present in the latest config). |
| 5 | **ABIs vendored, not imported from the SDK** | Avoids the consumer→provider cycle (`architecture.md`: SDK/contracts are consumers of csm-lab). A cross-repo ABI parity check warns on divergence (see SDK boundary). |
| 6 | **anvil `state.json` deferred** | Out of scope now. Recipes take an `rpcUrl`, so the fork source (`--fork-url` now, `--load-state` later) is a launch detail, not a recipe change. |

## Scope

**In** — state manipulation against an *already-deployed* fork: operator lifecycle, gate-tree
set, `warp`/`snapshot`/`revert`/`topup`, cl-mock wiring, `createCuratedOperator`, cm's
`createOperatorGroup`/bond-curve, the `seedCm` composite, and rewards (deferred to increment 6e).

**Out** — `deploy-*`/scratch deploy (irreducibly `forge script` + bytecode); the `test-*`
orchestration flows; governance/upgrade sims (`vote-add-module`, `vote-upgrade` →
`SimulateVote.s.sol`, moot on a fork where the module is already live); `make-fork`/`kill-fork`
(need the anvil binary → documented prerequisite); `stuck-keys` (dead in source — `fork.just`
calls a `stuck()` that no longer exists in `NodeOperators.s.sol`); and the post-condition
assertions.

## Architecture — two packages

The "receipts vs recipes" naming names two real things, split by lifecycle per the repo's
bucket model. The existing `fixtures/receipts` stub is *already* scoped for the data half
(its `package.json`: "typed, importable contract addresses & ABIs"); ADR-0001 #8 already ratified
its "committed snapshots + refresh, no solc" design.

```
csm-lab/
├── fixtures/
│   └── receipts/    @csm-lab/receipts   DATA: ABIs + module-suite addresses + manifest   ← fulfills existing stub
└── tools/
    └── recipes/     @csm-lab/recipes    TOOL: TS API (rewritten fork.just)               ← NEW

    @csm-lab/recipes ──depends on──▶ @csm-lab/receipts
    (no runtime dep on lido-csm-sdk, contracts, forge, or cast; anvil = target over RPC only)
```

- **`@csm-lab/receipts`** (`fixtures/*`, zero runtime): committed ABI + address JSON, a typed
  `src/index.ts`, a `data/manifest.json` (contracts git-ref + per-ABI hash), and a human-run
  `refresh.ts`. The only thing that touches the contracts repo, and only at refresh time. It has
  a standalone consumer beyond recipes: merkle's trimmed on-chain "set" work needs the address
  book without the runtime tool.
- **`@csm-lab/recipes`** (`tools/*`, like `merkle`): the commands. Imports ABIs + default
  addresses from receipts; every recipe's `ctx` can override the module-suite addresses.

## Context model & the impersonation engine

`connect()` is the only place chain/addresses/module resolve — including the **on-chain
`LidoLocator` lookups** for protocol addresses. One privilege-escalation helper (`actAs`)
replaces all the `broadcast*` modifiers in `script/fork-helpers/NodeOperators.s.sol`.

```ts
async function connect({ rpcUrl, module, addresses?, clMockUrl? }) {
  const client = makeClient(rpcUrl)                 // viem client + anvil actions
  const book = addresses ?? defaultSnapshot(await client.getChainId(), module)  // module-suite + LidoLocator
  const L = book.LidoLocator
  // Protocol addresses are derived on-chain, NOT vendored (they are absent from deploy-*.json):
  const [stakingRouter, vebo, lido, withdrawalQueue, burner] = await Promise.all([
    read(client, L, 'stakingRouter'), read(client, L, 'validatorsExitBusOracle'),
    read(client, L, 'lido'), read(client, L, 'withdrawalQueue'), read(client, L, 'burner'),
  ])
  return { client, module, abis, addresses: { ...book, stakingRouter, vebo, lido, withdrawalQueue, burner } }
}
// ctx = { client, module, addresses, abis, clMockUrl? }

// resolve a privileged account, fund it, act as it, stop. Accepts a RAW address
// (e.g. address(stakingRouter)/address(verifier)/address(module)) or a role-member lookup.
async function actAs<T>(ctx, who: Address, fn: (from: Address) => Promise<T>): Promise<T> {
  await ctx.client.setBalance({ address: who, value: parseEther('100') })  // anvil_setBalance
  await ctx.client.impersonateAccount({ address: who })                    // anvil_impersonateAccount
  try { return await fn(who) }
  finally { await ctx.client.stopImpersonatingAccount({ address: who }) }
}
const roleMember = (ctx, name, role) =>
  ctx.client.readContract({ ...contract(ctx, name), functionName: 'getRoleMember', args: [role, 0n] })
```

**No `read`/`write` DSL.** A trivial typed resolver keeps abitype inference and reads as plain
viem — no bespoke mini-framework:

```ts
// contract(ctx, 'module') → { address, abi } picked by ctx.module (CSModule | CuratedModule)
const contract = (ctx, name) => ({ address: ctx.addresses[resolveName(ctx, name)], abi: ctx.abis[name] })

export async function addKeys(ctx, { noId, count }) {                 // was broadcastManager(noId)
  const m = contract(ctx, 'module'), acc = contract(ctx, 'Accounting')
  const { managerAddress } = await ctx.client.readContract({ ...m, functionName: 'getNodeOperator', args: [noId] })
  const value = await ctx.client.readContract({ ...acc, functionName: 'getRequiredBondForNextKeys', args: [noId, count] })
  const keys = randomBytes(48 * count), signatures = randomBytes(96 * count)
  return actAs(ctx, managerAddress, (from) =>
    ctx.client.writeContract({ ...m, functionName: 'addValidatorKeysETH',
      args: [managerAddress, noId, count, keys, signatures], account: from, value }))
}
```

Which privileged account each write needs (`stakingRouter` for deposit/unvet/exit, `verifier`
for slash/withdraw, resolved role-members for penalties) transcribes from the Solidity
modifiers into `actAs(ctx, …)`. `verifier`/`stakingRouter`/`module` are impersonated **as the
contract address itself**, not via `getRoleMember` — `actAs` must accept a raw address.

### Conventions

- **`ctx.module` resolves the module address** — `CSModule` for csm/csm0x02, `CuratedModule` for
  cm. Recipes reference `contract(ctx, 'module')`, never a hardcoded `'CSModule'`.
- **No post-assertions; return + throw instead.** A revert throws naturally via viem. Recipes
  return what they did (`createCuratedOperator` → `noId`, `addKeys` → pubkeys, `deposit` →
  deposited count) and throw on no-op or bad input (e.g. `deposit(100)` that deposits 0).
- **Reads return structured, typed data** from the vendored ABI (viem decodes named tuples —
  strictly better than `mock-rewards.mjs`'s positional split-on-newline). A CLI, if ever built,
  is the only layer that tabulates.

## Transcription hazards — do NOT port the `.s.sol` verbatim

The review found the "near-mechanical transcription" framing optimistic in these spots; each
needs a deliberate decision, not a copy:

| Hazard | Source | Decision |
| --- | --- | --- |
| **`warp` is two semantics** | `fork.just:147` `warp days` (relative `evm_increaseTime`) vs `Common.sol:42` `_warp(ts)` (absolute `evm_setNextBlockTimestamp`) | Ship `warpBy(seconds)` (user-facing) + internal `warpTo(ts)` (used by consensus-frame helpers). Drop `vm.warp`'s third effect — automatic over RPC after mining. |
| **`submitRewards` fast-lane bug** | `OracleReport.s.sol:64-73` indexes `getFastLaneMembers()[0]` with no empty-guard; can be empty on a real fork | Port `Fixtures.sol:1030`'s fallback `if (members.length == 0) members = getMembers()` — do not copy the `.s.sol`. |
| **`deposit` silent no-op** | `NodeOperators.s.sol:143` assert disabled; `deposit(100)` on empty state deposits 0, no throw | Return deposited count; throw if `requested > 0 && deposited == 0`. |
| **Rewards bigint JSON** | `mock-rewards.mjs:56-73` hand-rolls a bigint codec; plain `JSON.stringify` corrupts `distributed`/`rebate` | `makeRewards` returns typed `{ treeRoot: Hex, treeCid, logCid, distributed: bigint, rebate: bigint }` in-memory; `submitRewards` consumes it directly — no file, no JSON hazard. |
| **`getSigningKeys` packed bytes** | `IBaseModule.sol:388` returns `48·n` concatenated bytes, not `bytes[]` | Slice per-48 in JS (the Solidity does too). Affects `operatorKeys`/`exitRequest`/`increaseAllocatedBalance`. |
| **`createCuratedOperator` temp-tree** | `NodeOperators.s.sol:387-401` builds a 2-leaf on-chain tree, proves index 0, sets gate, creates, **restores** | Reproducible by `tools/merkle` (`StandardMerkleTree.of([[op],[extra]], ['address'])`) **only** as N=2 + `getProof([op])` by value (OZ sorts leaves). Preserve the `setTreeParams(origRoot, origCid)` restore and the `isPaused()→resume()` dance. |
| **`nextAddress`/`randomBytes` determinism** | `Utilities.sol` is a stateful keccak chain; `addKeys` re-seeds on `block.prevrandao` | Intentionally diverge — keys only need to be unique/well-formed. Generate fresh random keys + addresses and **return** them; do not reproduce the Solidity byte sequence. Take an injectable seed for test reproducibility. |
| **`getRoleMember(role, 0)`** | sound on a *real* deploy (governance at index 0); `SimulateVote.s.sol:296` shows index 0 is occasionally wrong | Fine for in-scope recipes. Keep a lookup-by-membership fallback available if a recipe ever targets a role where index 0 isn't guaranteed. |

## Data: the receipts package, refresh & drift

```
fixtures/receipts/
├── data/
│   ├── abi/<Contract>.json          # impls: CSModule, CuratedModule, Accounting, FeeDistributor,
│   │                                 #   FeeOracle, HashConsensus, VettedGate, CuratedGate,
│   │                                 #   ParametersRegistry, Verifier, MetaRegistry, PermissionlessGate
│   │                                 # interfaces (out/ has only I-prefixed): IVEBO, IStakingRouter,
│   │                                 #   ILido, ILidoLocator
│   ├── <chain>/deploy-<chain>.json  # module-suite + LidoLocator; + <chain>/curated/ for cm
│   └── manifest.json                 # contracts git-ref + per-ABI sha256
├── src/index.ts                      # re-exports JSON `as const` → abitype-typed for viem
└── scripts/refresh.ts                # human-run, NO solc
```

**ABI source map is NOT 1:1.** `out/` compiles upstream Lido contracts as interfaces only
(`out/IVEBO.sol/IVEBO.json`, not `VEBO.sol`). `refresh.ts` maps `VEBO→IVEBO`,
`StakingRouter→IStakingRouter`, `Lido→ILido`, `LidoLocator→ILidoLocator`; module/suite contracts
use their impl ABIs (present in `out/`). It extracts ABIs from the `.abi` field of
`out/<C>.sol/<C>.json` (copying forge's *existing* build output, not compiling) and module-suite
addresses from `artifacts/<chain>/`.

**`refresh --config <path>`** overrides the address source file (relative to the contracts repo
root). Always point it at the **latest** config per the contracts repo's `.env` `DEPLOY_CONFIG`
value. Current per-(chain, module) configs:

| chain   | module | config path                                   |
| ------- | ------ | --------------------------------------------- |
| hoodi   | csm    | `artifacts/hoodi/upgrade-v3-hoodi.json`       |
| hoodi   | cm     | `artifacts/hoodi/curated/deploy-hoodi.json`   |
| mainnet | csm    | `artifacts/mainnet/deploy-mainnet.json` (v2)  |

**Contract upgrades.** CSM has been upgraded twice (v2 → v3 on hoodi; mainnet still at v2). Proxy
addresses are stable across upgrades. `*Impl` addresses change on each upgrade; new contracts
(`VerifierV3`, `CircuitBreaker`, `IdentifiedDVTClusterGate`/`idvtc`) appear only in the latest
config. Always refresh from the latest config to avoid vendoring stale impls or missing v3 contracts.

**Reconcile the stub README.** The committed `fixtures/receipts/README.md` says ABIs come from
`broadcast/*/run-latest.json` — wrong. ABIs come from `out/`; addresses from `artifacts/`. Fix
the README + ADR-0001 #8 wording in the receipts increment so they don't drift.

**Drift detection** (the central maintainability risk — `script/fork-helpers/` changed ~44× and
`artifacts/` ~16× in six months):

- `refresh.ts` writes `manifest.json` = the contracts `git-ref` (read from the deploy JSON's
  top-level `"git-ref"`) + a sha256 per vendored ABI.
- `refresh.ts` **git-ref guard**: refuse to run unless `git -C <contracts> rev-parse HEAD`
  matches the deploy JSON's `"git-ref"` (with `--force` escape) — prevents pairing HEAD's ABIs
  with an older deployment's addresses (silent corruption).
- **CI ABI parity** (non-optional): a job shallow-fetches the contracts commit pinned in
  `manifest.json` and diffs the vendored ABI bytes against `out/`. Drift fails the PR.

## Recipe inventory & the module matrix

**Shared core** — `@csm-lab/recipes`, resolve the module via `ctx.module`:

| Group | Recipes | Source |
| --- | --- | --- |
| Operator lifecycle | propose/confirm manager+reward (×4), `addKeys`, `removeKey`, `deposit`, `unvet`, `exit`, `slash`, `withdraw`, `targetLimit` (+forced/off), penalty report/cancel/settle/compensate (×4), `addBond`, `createBondDebt`, `exitRequest` (VEBO 2-step), `activateKeys`, `reportBalance`, `increaseAllocatedBalance`, `topUpActiveKeys` | `NodeOperators.s.sol` |
| Reads (typed objects) | `operatorsCount`, `operatorKey(s)`, `operatorInfo`, `bondInfo`, `keyAllocatedBalance(s)`, `getCurveInfo` (cast-only in source); thin derivations `getLastOperator`, `getPubkey`, `getKeyBalance` (needed by `clActivate`) | `NodeOperators.s.sol`, `fork.just` |
| Chain ops (pure anvil RPC) | `warpBy` (+ internal `warpTo`), `snapshot`, `revert`, `topup` | `fork.just`, `Common.sol` |
| Gate tree (→ `@csm-lab/merkle`) | `setGateTree` (root+cid), `setGateAddrs` (build then set), `getGateTree` | `fork.just` (`update-gate-tree`/`set-gate-addrs`) |
| Rewards (→ `merkle` + `ipfs-mock`) — **increment 6e** | `makeRewards` + `submitRewards` | `mock-rewards.mjs`, `OracleReport.s.sol` |
| CL bridge (→ `@csm-lab/cl-mock`) — **increment 6d** | `clActivate` (read pubkey+balance on-chain → set CL status) | `cl-mock.just` |

**Module-specific** — subpaths, guard on `ctx.module`:

| Subpath | Recipes | Source |
| --- | --- | --- |
| `@csm-lab/recipes/cm` | `createOperatorGroup`, `resetOperatorGroup`, `setBondCurveWeight`, `createCuratedOperator`, `seedCm`; curated gate selectors `po/pto/pgo/do/eeo/iodc/iodcp` (the `CuratedGates[0..6]` array) | `curated.just`, `MetaRegistryHelpers.s.sol`, `NodeOperators.s.sol` |
| `@csm-lab/recipes/csm` | gate selectors: `ics`→VettedGate, `idvtc`→IdentifiedDVTClusterGate (present in hoodi v3 config; no dedicated ABI in `out/` — reuses an existing gate ABI, VettedGate or CuratedGate-type; available where chain is ≥v3: hoodi yes, mainnet not yet); lifecycle is shared | `fork.just` `_resolve-gate-addr` |

`csm0x02` is **not** a package yet — its `csm0x02.just` has zero portable (non-deploy) recipes;
add a subpath only when the module deploys (it will key off `CSModule`, like csm).

**Per-chain divergence.** hoodi-csm and mainnet-csm share key shape. **cm exists only for hoodi**
(no `artifacts/mainnet/curated/`) — no default cm snapshot can ship for mainnet. `ParametersRegistry`
is reached via `module.PARAMETERS_REGISTRY()` at runtime (vendoring its ABI is harmless).

**Version divergence.** mainnet is at CSM **v2** (no v3 config exists); hoodi is at **v3**. The
"latest" config therefore differs per chain. v3-only contracts (`VerifierV3`, `CircuitBreaker`,
`IdentifiedDVTClusterGate`/`idvtc`) are available on hoodi but not mainnet until mainnet upgrades.

## Increments (each independently shippable, per migration.md)

- **6a — `@csm-lab/receipts`** (the *actual* current step 6). ABIs (impl + interface map) +
  module-suite addresses + `manifest.json` + `refresh.ts` (git-ref guard) + typed `index.ts`.
  Reconcile the README/ADR paths. Absorbs merkle's trimmed on-chain "set" work's address needs.
  No recipes. Ships green alone; unblocks the address-book consumer that isn't recipes.
- **6b — `recipes` MVP (TS API only)** — ~5 recipes exercising *every* seam end-to-end:
  `connect` (chainId→snapshot + locator resolution), `createCuratedOperator` (cm; `actAs` +
  merkle N=2 + returns `noId`), `addKeys` (on-chain role resolve + value write + seed hook),
  `setGateAddrs` (merkle integration + gate-set write, `ics` selector only), `operatorInfo`
  (typed read). Optional `warpBy`/`snapshot` for deterministic smoke. Hermetic unit tests (fake
  viem client asserting impersonate→send→stop + encodings) + one opt-in fork smoke.
- **6c** — operator-lifecycle families (propose/confirm ×4, deposit/unvet/exit/slash/withdraw,
  penalty ×4, bond ops) — mechanical once `actAs` is proven.
- **6d** — `clActivate` + the cl-mock bridge (`ctx.clMockUrl`).
- **6e** — **rewards** (`makeRewards` + `submitRewards`) — the hard one; ported once seams are
  stable. Treat as a careful integration spike (warp-to-frame, fast-lane fallback, bigint,
  merkle, ipfs-mock), not a verbatim transcription.
- **6f** — remaining cm/csm specifics + the other gate selectors, on demand.
- **6g** — thin CLI + table formatters, *only if* a human consumer materializes.

## SDK overlap & boundary

`lido-csm-sdk` is building a parallel anvil/viem test harness (`test-infrastructure` branch:
`@viem/anvil`/`prool`, `useTestClient()` with `setBalance`/`impersonateAccount`) and already
maintains 22 abitype ABIs (`/update-abis`) + a hoodi/mainnet address table. Decision: **vendor
stands** (a standalone ABI package is the SDK team's call; depending on the SDK couples csm-lab's
release cadence and risks the cycle). Mitigations:

- Add a **cross-repo ABI parity check** that warns when receipts' ABIs diverge from the SDK's
  (note the SDK's known `Accounting.deposit*` overload filter as a reconciliation note).
- **Document the boundary in `docs/architecture.md`**: csm-lab/recipes = consumer-facing
  state-setup tool; the SDK harness = its own scaffolding. If the SDK later consumes
  `@csm-lab/recipes`, that needs an API-stability review (avoid a 3-hop sync chain).
- A "sibling refresh" note in the receipts README pointing at the SDK's `/update-abis`.

## Fork prerequisite, cl-mock, testing

- **Prerequisite:** recipes target a running anvil fork with CSM already deployed — today
  `anvil --fork-url <hoodi|mainnet RPC>`. `ctx` takes `rpcUrl`. The compose `anvil` service is
  bare; driving recipes against it needs a `--fork-url` (env `ANVIL_FORK_URL`) — an **explicit
  task** in the increment that first needs a live fork (6b smoke), with the env var named up
  front. `state.json` later → `--load-state`, same recipes.
- **cl-mock:** `ctx.clMockUrl` is optional; only `clActivate` (the chain-aware bridge, which
  consumes `getPubkey` + `getKeyBalance`) lives in recipes — raw `cl-set`/`cl-list` stay in
  cl-mock's own CLI.
- **Testing (hermetic, per CLAUDE.md):** unit tests inject a **fake viem client** — assert calls,
  encodings, and `impersonate → send → stop` per recipe; pin deterministic merkle roots/CIDs.
  A single opt-in integration smoke (compose anvil forked off hoodi) stays *out* of the default
  `test` run. Determinism hook: injectable seed/clock for `addKeys` keys and `makeRewards`.

## Open questions / deferred

- **`state.json` snapshot** — deferred; revisit for a fully offline (no upstream RPC) test bed.
- **Governance/upgrade sims** — out now; revisit only if scratch-deploy scenarios are needed.
- **csm0x02** — subpath added when the module deploys.
- **CLI (6g)** — built only on real demand.

## Source references (contracts repo)

`Justfile`, `fork.just`, `cl-mock.just`, `csm.just`, `curated.just`, `csm0x02.just`;
`script/fork-helpers/{Common,NodeOperators,OracleReport,MetaRegistryHelpers,Roles,SimulateVote}.s.sol`;
`script/mock-rewards.mjs`; `test/helpers/{Fixtures,Utilities,MerkleTree}.sol`;
`src/abstract/MerkleGate.sol`, `src/CuratedGate.sol`, `src/interfaces/{IBaseModule,IAccounting,IBondCurve}.sol`,
`src/lib/base-oracle/HashConsensus.sol`; `artifacts/<chain>/deploy-<chain>.json`;
`out/<C>.sol/<C>.json` (impls) and `out/I<C>.sol/I<C>.json` (upstream interfaces).
