# Missing recipes — pause/resume, target-limit, remove-key, get-curve-info

**Date:** 2026-07-04
**Status:** design (approved)
**Type:** feature — port the still-live `fork.just` recipes that `@sm-lab/recipes` skipped, plus a
new module-agnostic pause/resume surface (module + accounting + gates).

## Context

Coverage analysis of `csm-widget`'s fork-e2e suite (`tests/shared/services/forkActions.service.ts`)
against `@sm-lab/recipes` found the widget drives **36** `fork.just` recipes, of which **18** are not
yet ported. `@sm-lab/recipes` is the TS port of `community-staking-module/fork.just`, so the gap is
"what the port skipped."

Triaging those 18 against the **current v3 contracts** removes most of them:

- **Dead in v3 — drop.** The EL-rewards-stealing penalty family (`report/cancel/settle/compensate-stealing`)
  no longer exists: `reportStealing` is gone from `NodeOperators.s.sol` and `SimulateVote.s.sol:314-317`
  *revokes* `REPORT_EL_REWARDS_STEALING_PENALTY_ROLE`/`SETTLE_EL_REWARDS_STEALING_PENALTY_ROLE` on
  upgrade while *granting* `REPORT_GENERAL_DELAYED_PENALTY_ROLE`. It was **superseded by the general
  delayed penalty** mechanism, which sm-lab already ports as `report/cancel/settle/compensate-penalty`.
  `stuck-keys` is likewise dead — `stuckValidatorsCount` is hardcoded to `0` (`NodeOperatorOps.sol:330`)
  with no setter. `public-release` no longer exists in `PauseResume.s.sol`.
- **Excluded by decision.** Vote-simulation recipes (`vote-add-module`, `vote-upgrade`) — out of scope.
- **Deferred.** `exit-request` — reaches *outside* the module into the Validators Exit Bus Oracle
  (`_exitRequest`, `NodeOperators.s.sol:241`): a multi-impersonation VEBO consensus-report + submit
  dance. Materially heavier than everything else here; gets its own spec.

### Penalty families (the finding that shaped scope)

Both families share an identical lifecycle — `report` → lock bond, `cancel` → unlock, `settle` → burn
locked bond, `compensate` → operator pays off. They differ only in **scope + protocol version**:

| | EL-rewards-stealing | General delayed penalty |
| --- | --- | --- |
| Purpose | steal EL rewards owed to the protocol | any off-chain-detected misbehavior (`bytes32` type) |
| API | `reportStealing`/… | `reportGeneralDelayedPenalty(noId,bytes32,amount,desc)`/… |
| Version | **v2 / legacy** (removed) | **v3** (live) |
| Extra | — | fixed fine from `PARAMETERS_REGISTRY.getGeneralDelayedPenaltyAdditionalFine` |

sm-lab is v3-only (idvtc gate, protocol block baked from the v3 upgrade), so the stealing family is
out and the existing `*-penalty` recipes are the correct equivalent.

## Scope

**In (this batch):** `set-target-limit`, `remove-key`, `pause`/`resume` (module + accounting + gates,
csm & cm), `get-curve-info`.
**Out:** stealing family, `stuck-keys`, `public-release` (all v3-dead); `vote-*` (excluded);
`exit-request` (deferred to its own spec).

## Feasibility — no `@sm-lab/receipts` changes

Verified against the current address book + ABIs:

- Both `CsmAddressBook` and `CmAddressBook` carry `Accounting` (`fixtures/receipts/src/types.ts:18,41`).
- `CSModule`, `CuratedModule`, `Accounting`, `VettedGate`, `CuratedGate` ABIs all expose the full
  `PausableUntil` surface (`pauseFor`/`resume`/`isPaused`/`PAUSE_ROLE`/`RESUME_ROLE`).
- `contract(ctx,'module')` (`context.ts:128-145`) already switches CSModule↔CuratedModule on the
  shared `csModuleAbi` surface by `ctx.module`; `resolveGate(ctx,selector)` (`context.ts:155-175`)
  already maps every gate selector for both modules.

So csm+cm coverage falls out of the existing `ctx.module` resolution — no new addresses, no new ABIs.

Every function these recipes call is confirmed present in the shipped ABIs:
`updateTargetValidatorsLimits`, `removeKeys`, `getNodeOperator`, `PAUSE_ROLE`, `RESUME_ROLE`,
`pauseFor`, `resume`, `isPaused` in both `CSModule` and `CuratedModule`; `getCurveInfo` +
`getRoleMember`/`grantRole` + the pausable surface in `Accounting`; `getRoleMember`/`grantRole`/
`pauseFor` in `VettedGate` and `CuratedGate`.

## Design — unified pause/resume

All three target kinds pause/resume through **one identical mechanism**, already precedented in
`cm/index.ts:58-89` (grant `RESUME_ROLE`, guard on `isPaused`, `resume()`):

```
admin  = roleMember(target, DEFAULT_ADMIN_ROLE)          // getRoleMember(role, 0)
actAs(ctx, admin, from =>
  grantRole(PAUSE_ROLE | RESUME_ROLE, admin)             // as admin
  pauseFor(type(uint256).max) | resume()                 // as admin
)
```

Only `{address, abi}` varies by target. The CLI surface is therefore a single verb pair with a
positional `target`:

```
sm-recipes csm pause module        sm-recipes cm  resume accounting
sm-recipes csm pause accounting     sm-recipes cm  pause  po
sm-recipes csm pause ics            sm-recipes csm resume idvtc
```

`target` ∈ `module` | `accounting` | any gate selector accepted by `resolveGate`
(`ics`/`idvtc` for csm; `po|pto|pgo|do|eeo|iodc|iodcp`/index for cm; `0x…` for either). `module` and
`accounting` are reserved keywords that cannot collide with the gate selectors. The active module is
chosen by `--module` (or the `csm`/`cm` command group), so csm+cm are covered by one descriptor pair.

**Idempotence:** `pause` no-ops when already paused; `resume` no-ops when not paused (reusing the
`isPaused` read-guard). `pauseFor` on an already-paused contract reverts otherwise.

## Recipe specs

Authority in parentheses is the account `actAs` impersonates.

### `set-target-limit` (shared) — StakingRouter

- Contract: `updateTargetValidatorsLimits(noId, targetLimitMode, limit)` — `NodeOperators.s.sol:182`.
- `actAs(ctx.addresses.stakingRouter)`.
- Options: `--operator-id` (required, positional), `--mode <0|1|2>` (required, positional; 0=off,
  1=soft, 2=forced), `--limit <n>` (optional flag, default `0`; only meaningful for modes 1/2 —
  forced to `0` for mode 0). Optional so mode-off is just `set-target-limit <id> 0`.
- Validate `mode ∈ {0,1,2}`, else throw.
- Returns `{ noId, mode, limit }`.
- Replaces `fork.just` `target-limit` / `target-limit-forced` / `target-limit-off` with one parametric
  recipe (matches the single underlying call; consistent with `report-penalty` taking `penaltyType`).

### `remove-key` (shared) — manager

- Contract: `removeKeys(noId, keyIndex, count)` — `NodeOperators.s.sol:146` (`removeKeys(noId,i,1)`).
- `actAs(manager)` where `manager = getNodeOperator(noId).managerAddress` (same resolution `addKeys` uses).
- Options: `--operator-id` (required), `--key-index` (required), `--count <n>` (default `1`).
- Returns `{ noId, keyIndex, count }`.

### `pause` / `resume` (shared) — target admin

- As designed above. Internal `resolveTarget(ctx, target) → { address, abi, label }`:
  - `module` → `contract(ctx,'module')`
  - `accounting` → `contract(ctx,'Accounting')`
  - else → `{ address: resolveGate(ctx, target), abi: <gate abi by module> }` (csm→`vettedGateAbi`,
    cm→`curatedGateAbi`; the `PausableUntil` fragments are byte-identical across gate types, so the
    exact gate ABI only needs the pausable surface).
- Options: `target` (required, positional).
- Returns `{ target, address, paused }` (post-condition).

### `get-curve-info` (shared, read-only) — no impersonation

- Contract: read `Accounting.getCurveInfo(curveId)` — `fork.just:5` (`cast call … getCurveInfo`).
- Options: `--curve-id <n>` (required, positional).
- Returns the curve struct as read (bigint-safe under the `--json` contract).

## Components / file plan

| File | Change |
| --- | --- |
| `tools/recipes/src/roles.ts` | add `PAUSE_ROLE = keccak256(toBytes('PAUSE_ROLE'))` (RESUME_ROLE exists); export from `index.ts` |
| `tools/recipes/src/recipes/pause.ts` | **new** — `pause`/`resume` + `resolveTarget` |
| `tools/recipes/src/recipes/target-limit.ts` | **new** — `setTargetLimit` |
| `tools/recipes/src/recipes/vetting.ts` | add `removeKey` (co-located with `unvet`/`exit`) |
| `tools/recipes/src/recipes/reads.ts` | add `getCurveInfo` |
| `tools/recipes/src/cli/commands/shared.ts` | 5 new `RecipeCommand` descriptors; auto-mirrored under `csm`/`cm` groups |
| `tools/recipes/src/index.ts` | export the new recipe fns |

No changes to `@sm-lab/receipts`, `context.ts`, `act-as.ts`, `client.ts`, or the CLI `define.ts` seam.

## Data flow

Unchanged from every existing recipe: `connect()` → `Ctx` → recipe composes
`contract()` / `resolveGate()` / `roleMember()` / `actAs()`. The CLI `defineCommand` factory wires each
descriptor (coercion, `connect()` once, `--json` vs human `report()`, error-exit) with no new machinery.

## Error handling

- `set-target-limit`: throw on `mode ∉ {0,1,2}`.
- `pause`/`resume`: unknown gate selector throws via `resolveGate`'s existing message; unknown
  non-gate keyword throws an explicit `unknown pause target` error. `idvtc` on a v2/mainnet snapshot
  throws via `resolveGate` (v3-only) — surfaced as-is.
- All follow the CLI contract: stderr `Error: …`, exit 1.

## Testing (hermetic, fake `RecipeClient`)

Model on existing set-gate / cm tests. Per recipe assert:

- **pause/resume:** exact call sequence `grantRole(PAUSE_ROLE|RESUME_ROLE, admin)` → `pauseFor(max)` |
  `resume()`, all as the resolved admin; `isPaused` idempotence guard (already-paused pause = no-op,
  not-paused resume = no-op); correct `{address}` per target keyword; **module switch** — same
  `pause module` resolves CSModule under csm and CuratedModule under cm; a gate selector resolves the
  right gate per module.
- **set-target-limit:** `updateTargetValidatorsLimits` args `(noId, mode, limit)`, `limit`→`0` for
  mode 0, impersonation = stakingRouter, mode-validation throw.
- **remove-key:** `removeKeys(noId, keyIndex, count)` as `managerAddress`, default `count=1`.
- **get-curve-info:** reads `getCurveInfo(curveId)` on the Accounting address; no writes/impersonation.

Plus extend the `ANVIL_FORK_URL`-gated smoke with one pause→resume round-trip.

## Out of scope / follow-ups

- **`exit-request`** — own spec (VEBO consensus-report + submit; cross-contract, multi-impersonation).
- v2/legacy stealing recipes — intentionally never ported (dead in v3).
