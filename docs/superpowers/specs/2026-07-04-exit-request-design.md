# exit-request recipe — VEBO exit-report port

**Date:** 2026-07-04
**Status:** design (pending user review)
**Type:** feature — port the deferred `exit-request` recipe from `community-staking-module/fork.just`
into `@sm-lab/recipes`: submit a single validator-exit request to the Validators Exit Bus Oracle
(VEBO) by impersonating its consensus contract + a `SUBMIT_DATA_ROLE` holder.

## Context

The missing-recipes batch (`docs/superpowers/specs/2026-07-04-missing-recipes-design.md`) deferred
`exit-request` to its own spec because it "reaches outside the module into the Validators Exit Bus
Oracle: a multi-impersonation VEBO consensus-report + submit dance." Tracing the source
(`script/fork-helpers/NodeOperators.s.sol:235-286`) shows it is **lighter than feared**: it does not
run a real HashConsensus quorum and does not warp time. It fakes consensus by impersonating the VEBO
consensus contract *itself* and calling `submitConsensusReport` directly, then impersonates a
`SUBMIT_DATA_ROLE` holder to call `submitReportData`.

### Source mechanics (verbatim shape)

`fork.just:199-200`:

```just
exit-request noId keyIndex validatorIndex="900000":
    just _impersonate-script NodeOperators --sig="exitRequest(uint256,uint256,uint256)" -vvv -- {{noId}} {{keyIndex}} {{validatorIndex}}
```

`NodeOperators.s.sol` — `exitRequest` (235-239) reads the pubkey then calls `_exitRequest`
(241-275):

1. `vebo = IVEBO(locator.validatorsExitBusOracle())`.
2. `moduleId` = scan `stakingRouter.getStakingModuleIds()` for the id whose
   `getStakingModule(id).stakingModuleAddress == address(module)` (`_getModuleId`, 512-519).
3. Pack `data = abi.encodePacked(bytes3 moduleId, bytes5 nodeOpId, bytes8 validatorIndex, bytes pubkey)`.
4. `reportRefSlot = getConsensusReport().refSlot + 1` (one slot past the last consensus report — NOT
   a computed frame boundary; no time-warp).
5. Build `ReportData { consensusVersion: getConsensusVersion(), refSlot: reportRefSlot,
   requestsCount: 1, dataFormat: 1, data }`.
6. Impersonate `getConsensusContract()` → `submitConsensusReport(keccak256(abi.encode(report)),
   reportRefSlot, block.timestamp + 1 days)`.
7. `_prepareVEBOSubmitter` (277-286): impersonate the VEBO `DEFAULT_ADMIN_ROLE` member 0, grant
   `SUBMIT_DATA_ROLE` to a fresh funded address.
8. Impersonate that submitter → `submitReportData(report, getContractVersion())`.

The exit-request `data` is **64 bytes**: `3 (moduleId) + 5 (nodeOpId) + 8 (validatorIndex) +
48 (pubkey)`, `requestsCount = 1`, `dataFormat = 1`.

## Scope

**In:** one shared recipe `exitRequest(ctx, { noId, keyIndex, validatorIndex? })` (csm + cm via
`ctx.module`), a new `exit-request` CLI command auto-mirrored under the `csm`/`cm` groups, hermetic
fake-client tests, and one `ANVIL_FORK_URL`-gated smoke.

**Out:** any CL-mock reflection of the exit (see Open decision below — chosen out for this batch);
batch/multi-key exits (`requestsCount = 1` matches the source); a real HashConsensus quorum
(the source deliberately bypasses it).

## Feasibility — no `@sm-lab/receipts` changes

Everything the port needs already ships (verified against the current package):

- **VEBO address:** `ctx.addresses.vebo` — already resolved by `connect()` from the baked
  `protocol` block or the LidoLocator fallback (`context.ts:88-120`). No new address.
- **VEBO ABI:** `vEBOAbi` exports every function used — `getConsensusReport`, `getConsensusVersion`,
  `getContractVersion`, `getConsensusContract`, `submitConsensusReport`, `submitReportData`,
  `SUBMIT_DATA_ROLE`, `grantRole`, `getRoleMember`. The `DEFAULT_ADMIN_ROLE()` getter is *not*
  needed — we pass the all-zero constant already in `roles.ts`.
- **StakingRouter ABI:** `stakingRouterAbi` exports `getStakingModuleIds` +
  `getStakingModule` (whose returned struct carries `stakingModuleAddress`).
- **Module pubkey read:** `getSigningKeys(nodeOperatorId, startIndex, keysCount)` is on the shared
  `csModuleAbi` surface (`contract(ctx, 'module')`), byte-identical for CSModule/CuratedModule.
- **Impersonation + roles:** `actAs` (fund + impersonate + auto-stop) and `roleMember` (read
  `getRoleMember(role, 0)`) already exist (`act-as.ts`); `DEFAULT_ADMIN_ROLE` is in `roles.ts`.

## Design — the recipe

`exitRequest` is module-agnostic. `contract(ctx, 'module')` gives the right module address+ABI by
`ctx.module`; the `moduleId` scan then matches that same address in the StakingRouter, so the recipe
works for csm and cm without branching.

### Signature

```ts
export interface ExitRequestOptions {
  noId: bigint;
  keyIndex: bigint;
  /** CL validator index packed into the report. Defaults to 900000n (matches the just recipe). */
  validatorIndex?: bigint;
}

export interface ExitRequestResult {
  noId: bigint;
  keyIndex: bigint;
  validatorIndex: bigint;
  /** module id discovered in the StakingRouter. */
  moduleId: bigint;
  /** the report ref slot (= last consensus report refSlot + 1). */
  refSlot: bigint;
  /** keccak256(abi.encode(report)) submitted to VEBO. */
  reportHash: Hex;
  /** the 48-byte BLS pubkey exited. */
  pubkey: Hex;
}

export async function exitRequest(ctx: Ctx, opts: ExitRequestOptions): Promise<ExitRequestResult>;
```

### On-chain sequence (the port)

Given `vebo = { address: ctx.addresses.vebo, abi: vEBOAbi }` and
`m = contract(ctx, 'module')`:

1. `pubkey = getSigningKeys(noId, keyIndex, 1n)` on `m` (48-byte hex).
2. `moduleId = resolveModuleId(ctx, m.address)` — read `stakingRouter.getStakingModuleIds()`, then
   find the id whose `getStakingModule(id).stakingModuleAddress` equals `m.address`
   (case-insensitive compare). **Robustness note:** iterate *all* ids ascending rather than the
   source's `for (i = len-1; i > 0; i--)` (which skips index 0); throw
   `@sm-lab/recipes: module <addr> not registered in the StakingRouter` if none match. Checking all
   ids is a deliberate, documented fix for the source's off-by-one skip and is correct for both
   modules regardless of registration order.
3. `validatorIndex = opts.validatorIndex ?? 900000n`.
4. `data = encodePacked(['bytes3','bytes5','bytes8','bytes'], [numberToHex(moduleId,{size:3}),
   numberToHex(noId,{size:5}), numberToHex(validatorIndex,{size:8}), pubkey])` — 64 bytes,
   big-endian, matching `bytes3(uint24(..))` / `bytes5(uint40(..))` / `bytes8(uint64(..))`.
5. `refSlot = getConsensusReport()[1] + 1n` (the second return value).
6. `report = { consensusVersion: getConsensusVersion(), refSlot, requestsCount: 1n, dataFormat: 1n,
   data }`.
7. `reportHash = keccak256(encodeAbiParameters(REPORT_DATA_PARAMS, [report]))` — see hash trap below.
8. `consensus = getConsensusContract()`; `actAs(ctx, consensus, from =>
   submitConsensusReport(reportHash, refSlot, deadline))` where
   `deadline = (await client.getBlock()).timestamp + 86400n` (`block.timestamp + 1 days`).
9. `admin = roleMember(ctx, vebo, DEFAULT_ADMIN_ROLE)`;
   `role = SUBMIT_DATA_ROLE()` (read on-chain);
   `contractVersion = getContractVersion()`.
10. `actAs(ctx, admin, from => { grantRole(role, admin); submitReportData(report, contractVersion) })`.
11. Return `{ noId, keyIndex, validatorIndex, moduleId, refSlot, reportHash, pubkey }`.

### Hash trap — encode the struct as ONE tuple param

Identical to the trap `submitRewards` documents (`rewards.ts`):

```ts
const REPORT_DATA_PARAMS = parseAbiParameters(
  '(uint256 consensusVersion, uint256 refSlot, uint256 requestsCount, uint256 dataFormat, bytes data)',
);
// keccak256(abi.encode(report)) for a single struct == ABI-encoding ONE tuple parameter.
// Do NOT flatten into 5 top-level params — that drops the tuple offset and changes the hash.
```

The test pins `reportHash` as a golden vector so any drift is caught.

### Submitter — documented divergence from the source

The source grants `SUBMIT_DATA_ROLE` to a *fresh* deterministic address (`nextAddress()`) and submits
as it. The port instead **reuses the VEBO admin as the submitter**: within one `actAs(admin, …)`
block, `grantRole(SUBMIT_DATA_ROLE, admin)` (idempotent) then `submitReportData(...)`. This produces
an identical on-chain effect (the exit request is recorded), needs one fewer impersonated account,
and mirrors how `rewards.ts` documents deliberate, effect-preserving simplifications. `grantRole` is a
no-op if the admin already holds the role, so it never reverts.

## CLI surface

One `RecipeCommand` descriptor added to `tools/recipes/src/cli/commands/shared.ts`, reusing the
existing shared `operatorId` and `keyIndex` option objects (same ones `remove-key` uses), plus an
optional `--validator-index`:

```ts
{
  name: 'exit-request',
  summary: 'request a validator exit via VEBO (impersonates the consensus contract + a submitter)',
  options: [
    operatorId,
    keyIndex,
    {
      flag: '--validator-index <n>',
      key: 'validatorIndex',
      coerce: toBigInt,
      description: 'CL validator index to pack into the report (default 900000)',
    },
  ],
  run: (ctx, o: ExitRequestOptions) => exitRequest(ctx, o),
  report: (r: ExitRequestResult, o: ExitRequestOptions) => [
    `operator ${o.noId} key ${o.keyIndex}: exit requested (module ${r.moduleId}, refSlot ${r.refSlot})`,
    `reportHash ${r.reportHash}`,
  ],
}
```

`operatorId` and `keyIndex` are `required`, so `define.ts`'s positional heuristic
(`required && !repeatable`) accepts them positionally — `sm-recipes exit-request <noId> <keyIndex>
[--validator-index n]` works — while the optional `--validator-index` stays flag-only. Because it
lives in the shared registry, `program.ts` auto-mirrors it under `csm`/`cm` with the module
pre-bound, no extra wiring — no CLI-machinery change.

## File plan

| File | Change |
| --- | --- |
| `tools/recipes/src/recipes/exit-request.ts` | **new** — `exitRequest` + `resolveModuleId` helper + `REPORT_DATA_PARAMS` |
| `tools/recipes/src/cli/commands/shared.ts` | one new `exit-request` descriptor (imports `exitRequest`) |
| `tools/recipes/src/index.ts` | export `exitRequest`, `ExitRequestOptions`, `ExitRequestResult` |
| `tools/recipes/test/exit-request.test.ts` | **new** — hermetic fake-client tests |
| `tools/recipes/test/cli-shared.test.ts` | add `exit-request` to the exact-match command-name list |
| `tools/recipes/test/smoke.fork.test.ts` | one `ANVIL_FORK_URL`-gated `exitRequest` round-trip |
| `.changeset/exit-request.md` | `'@sm-lab/recipes': minor` |

No changes to `@sm-lab/receipts`, `context.ts`, `act-as.ts`, `client.ts`, `roles.ts`, or the CLI
`define.ts` seam. `stakingRouterAbi` + `vEBOAbi` are imported into the new recipe from
`@sm-lab/receipts`.

## Data flow

Unchanged from every existing recipe: `connect()` → `Ctx` → the recipe composes
`contract()` / `roleMember()` / `actAs()` + direct `ctx.client` reads/writes. The CLI `defineCommand`
factory wires the descriptor (coercion, `connect()` once, `--json` vs human `report()`, error-exit)
with no new machinery.

## Error handling

- `resolveModuleId` throws `@sm-lab/recipes: module <addr> not registered in the StakingRouter` when
  no staking module matches — surfaced as `Error: …`, exit 1 (CLI contract).
- An empty/missing key (`getSigningKeys` returns `0x`) surfaces the VEBO/module revert as-is; no
  special-casing (the source does not guard it either).
- All errors follow the CLI contract: stderr `Error: …`, exit 1; success prints the human `report()`
  lines, or the bigint-safe JSON object under `--json`.

## Testing (hermetic, fake `RecipeClient`)

Model on the existing `validators` / `rewards` tests. Using `makeFakeClient({ reads: { … } })` and
`byMethod`, assert:

- **Reads:** `getSigningKeys(noId, keyIndex, 1n)`, `getStakingModuleIds`, `getStakingModule` (returns
  a struct with a matching `stakingModuleAddress`), `getConsensusReport`, `getConsensusVersion`,
  `getContractVersion`, `getConsensusContract`, `SUBMIT_DATA_ROLE`, `getRoleMember(DEFAULT_ADMIN_ROLE,
  0)`.
- **Write order + authority:** `submitConsensusReport(reportHash, refSlot, deadline)` as the consensus
  contract; then `grantRole(SUBMIT_DATA_ROLE, admin)` + `submitReportData(report, contractVersion)`
  as the admin. Assert `actAs` impersonated exactly the consensus contract then the admin.
- **Packed `data`:** exact 64-byte hex for a known `(moduleId, noId, validatorIndex, pubkey)`.
- **`reportHash`:** pinned golden vector (recompute with viem in the test).
- **`moduleId` resolution:** picks the id whose `stakingModuleAddress` matches the module address;
  throws when none match; iterating all ids covers an index-0 module.
- **Default `validatorIndex`:** omitting it packs `900000n`.
- **Module switch:** `ctx.module = 'csm'` reads `getSigningKeys` / matches `moduleId` on the CSModule
  address; `'cm'` on the CuratedModule address.
- **CLI:** `exit-request` appears in the shared command-name list and is mirrored under `csm`/`cm`.

The `ANVIL_FORK_URL`-gated smoke performs one real `exitRequest` and asserts `submitted`/`refSlot`
shape, mirroring the existing rewards smoke.

## Open decision — CL-mock reflection (chosen out; documented follow-up)

The source is pure on-chain. sm-lab separately added a cl-mock bridge on the *activation* side
(`clActivate` → `active_ongoing`), and the cl-mock already models `active_exiting` / `exited_*` /
`withdrawal_*`. A symmetric extension would, when `ctx.clMockUrl` is set, additionally mark the
validator `active_exiting` on the running cl-mock after the VEBO submit.

**This spec chooses the faithful on-chain-only port** and leaves the CL flip as a follow-up, because
(a) it matches `fork.just:exit-request` 1:1, (b) it is the smallest correct increment, and (c) the
hook is trivial to add later — the `clActivate` precedent shows exactly how (`ctx.clMockUrl` guard →
`setClValidator({ pubkey, status: 'active_exiting' })`), and `ExitRequestResult` already returns the
`pubkey`. If wanted, it becomes an optional post-step returning `clStatus?: 'active_exiting'`, guarded
on `ctx.clMockUrl` (opt-in; hermetic/on-chain-only use unaffected). **Flagged for the user at review.**

## Out of scope / follow-ups

- **CL-mock exit reflection** — see Open decision; add on request as an opt-in post-step.
- **Batch exits** (`requestsCount > 1`) — the source and this port do one request per call.
- **Real HashConsensus quorum for VEBO** — intentionally bypassed via consensus-contract
  impersonation, matching the source.
