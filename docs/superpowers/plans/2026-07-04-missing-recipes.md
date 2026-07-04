# Missing Recipes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the still-live `fork.just` recipes `@sm-lab/recipes` skipped — `set-target-limit`, `remove-key`, `get-curve-info` — plus a new module-agnostic unified `pause`/`resume` surface (module + accounting + gates, csm & cm).

**Architecture:** Each recipe is a pure async fn `(ctx, opts)` composing the existing seams — `contract(ctx, …)` / `resolveGate(ctx, …)` for address+abi, `roleMember` + `actAs` for impersonation, `ctx.client` for reads/writes. The CLI exposes each as a declarative `RecipeCommand` descriptor in `cli/commands/shared.ts`, auto-mirrored under the `csm`/`cm` groups. No `@sm-lab/receipts` changes — every ABI fragment and address field already ships.

**Tech Stack:** TypeScript (ESM, `moduleResolution: Bundler`), viem, commander, vitest (hermetic fake-client), tsdown.

## Global Constraints

- **Node ≥ 24.**
- **ESM extensionless imports:** `from './x'`, never `'./x.js'`. Use `import type` for type-only imports.
- **No DOM lib** (`lib: ES2023`); **`noUncheckedIndexedAccess` is on** — guard every array index / default-destructure.
- **Prefer `Array#toSorted()`** over `.sort()`.
- **Machine-readable `--json` contract:** results serialize with 2-space indent, bigints as strings via `bigintReplacer`; errors → stderr `Error: …`, exit 1. (Handled by `defineCommand`; recipes just return plain data.)
- **Lint/format:** oxlint + prettier (single quotes, width 100, trailing commas).
- **No `@sm-lab/receipts` changes.** All required ABI fragments (`updateTargetValidatorsLimits`, `removeKeys`, `getNodeOperator`, `getCurveInfo`, `getRoleMember`, `grantRole`, `pauseFor`, `resume`, `isPaused`, `PAUSE_ROLE`, `RESUME_ROLE`) are verified present in `CSModule`, `CuratedModule`, `Accounting`, `VettedGate`, `CuratedGate`.
- **Do NOT add Claude as a git co-author.**

## Setup (before Task 1)

We are on `main`. Create a feature branch before the first commit:

```bash
git checkout -b feat/missing-recipes
```

## Per-package gates (run before each task's commit)

```bash
pnpm --filter @sm-lab/recipes types
pnpm --filter @sm-lab/recipes test
pnpm exec oxlint tools/recipes/src
pnpm exec prettier --check "tools/recipes/**/*.{ts,json}"
```

(Run a single test file fast with e.g. `pnpm --filter @sm-lab/recipes test target-limit`.)

---

### Task 1: `set-target-limit` recipe

Port of `NodeOperators.targetLimit` → `updateTargetValidatorsLimits(noId, mode, limit)`, StakingRouter-gated. One parametric recipe replaces `fork.just`'s three (`target-limit` / `-forced` / `-off`).

**Files:**
- Create: `tools/recipes/src/recipes/target-limit.ts`
- Create: `tools/recipes/test/target-limit.test.ts`
- Modify: `tools/recipes/src/index.ts` (add export)

**Interfaces:**
- Produces: `setTargetLimit(ctx: Ctx, opts: { noId: bigint; mode: number; limit?: bigint }): Promise<{ noId: bigint; mode: number; limit: bigint }>`; types `SetTargetLimitOptions`, `SetTargetLimitResult`.
- Consumes: `actAs` (act-as), `contract` + `Ctx` (context), `ctx.addresses.stakingRouter`.

- [ ] **Step 1: Write the failing test**

`tools/recipes/test/target-limit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { setTargetLimit } from '../src/recipes/target-limit';
import { makeFakeClient } from './helpers/fake-client';
import { A, fakeCtx } from './helpers/book';

describe('setTargetLimit', () => {
  it('calls updateTargetValidatorsLimits(noId, mode, limit) as the staking router', async () => {
    const fc = makeFakeClient();
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01) });

    const res = await setTargetLimit(ctx, { noId: 3n, mode: 1, limit: 100n });

    const w = fc.byMethod('writeContract')[0] as any;
    expect(w.functionName).toBe('updateTargetValidatorsLimits');
    expect(w.args).toEqual([3n, 1n, 100n]);
    expect(w.account).toBe(ctx.addresses.stakingRouter);
    expect(fc.byMethod('impersonateAccount')[0]).toEqual({ address: ctx.addresses.stakingRouter });
    expect(res).toEqual({ noId: 3n, mode: 1, limit: 100n });
  });

  it('forces limit to 0 when mode is 0 (off), ignoring any passed limit', async () => {
    const fc = makeFakeClient();
    const ctx = fakeCtx('csm', fc.client);
    const res = await setTargetLimit(ctx, { noId: 3n, mode: 0, limit: 999n });
    const w = fc.byMethod('writeContract')[0] as any;
    expect(w.args).toEqual([3n, 0n, 0n]);
    expect(res.limit).toBe(0n);
  });

  it('defaults limit to 0 when omitted', async () => {
    const fc = makeFakeClient();
    const ctx = fakeCtx('cm', fc.client);
    await setTargetLimit(ctx, { noId: 1n, mode: 2 });
    const w = fc.byMethod('writeContract')[0] as any;
    expect(w.args).toEqual([1n, 2n, 0n]);
  });

  it('throws on an invalid mode', async () => {
    const fc = makeFakeClient();
    const ctx = fakeCtx('csm', fc.client);
    await expect(setTargetLimit(ctx, { noId: 1n, mode: 3 })).rejects.toThrow(/mode must be 0, 1, or 2/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sm-lab/recipes test target-limit`
Expected: FAIL — cannot resolve `../src/recipes/target-limit`.

- [ ] **Step 3: Write minimal implementation**

`tools/recipes/src/recipes/target-limit.ts`:

```ts
import { actAs } from '../act-as';
import { contract, type Ctx } from '../context';

export interface SetTargetLimitOptions {
  noId: bigint;
  /** 0 = off, 1 = soft, 2 = forced. */
  mode: number;
  /** Target validator limit; ignored (forced to 0) when mode === 0. Defaults to 0. */
  limit?: bigint;
}

export interface SetTargetLimitResult {
  noId: bigint;
  mode: number;
  limit: bigint;
}

/**
 * Set an operator's target validator limit (StakingRouter-gated). Port of
 * `NodeOperators.targetLimit` → `updateTargetValidatorsLimits(noId, mode, limit)`.
 */
export async function setTargetLimit(
  ctx: Ctx,
  opts: SetTargetLimitOptions,
): Promise<SetTargetLimitResult> {
  if (opts.mode !== 0 && opts.mode !== 1 && opts.mode !== 2) {
    throw new Error(`@sm-lab/recipes: target limit mode must be 0, 1, or 2 (got ${opts.mode})`);
  }
  const limit = opts.mode === 0 ? 0n : (opts.limit ?? 0n);
  const m = contract(ctx, 'module');
  await actAs(ctx, ctx.addresses.stakingRouter, (from) =>
    ctx.client.writeContract({
      ...m,
      functionName: 'updateTargetValidatorsLimits',
      args: [opts.noId, BigInt(opts.mode), limit],
      account: from,
      chain: null,
    }),
  );
  return { noId: opts.noId, mode: opts.mode, limit };
}
```

- [ ] **Step 4: Add the export**

In `tools/recipes/src/index.ts`, after the `chain` export (line ~21), add:

```ts
export { setTargetLimit } from './recipes/target-limit';
export type { SetTargetLimitOptions, SetTargetLimitResult } from './recipes/target-limit';
```

- [ ] **Step 5: Run test + gates**

Run: `pnpm --filter @sm-lab/recipes test target-limit` → PASS.
Then the four per-package gates above → all green.

- [ ] **Step 6: Commit**

```bash
git add tools/recipes/src/recipes/target-limit.ts tools/recipes/test/target-limit.test.ts tools/recipes/src/index.ts
git commit -m "feat(recipes): add set-target-limit recipe"
```

---

### Task 2: `remove-key` recipe

Port of `NodeOperators.removeKey` → `removeKeys(noId, keyIndex, count)`, as the operator's manager. Co-located in `vetting.ts` (the key-count-mutation family).

**Files:**
- Modify: `tools/recipes/src/recipes/vetting.ts` (add `removeKey`)
- Modify: `tools/recipes/test/vetting.test.ts` (add a describe block)
- Modify: `tools/recipes/src/index.ts` (extend the vetting export)

**Interfaces:**
- Produces: `removeKey(ctx: Ctx, opts: { noId: bigint; keyIndex: bigint; count?: bigint }): Promise<void>`.
- Consumes: `actAs`, `contract`, `Ctx`; reads `getNodeOperator(noId).managerAddress` (same pattern as `addKeys`, `add-keys.ts:25-30`).

- [ ] **Step 1: Write the failing test**

Append to `tools/recipes/test/vetting.test.ts` (add `removeKey` to the import on line 4, and this block after the existing `vetting recipes` describe):

```ts
import { removeKey } from '../src/recipes/vetting'; // extend existing import line

describe('removeKey', () => {
  it('calls removeKeys(noId, keyIndex, count) as the operator manager (default count=1)', async () => {
    const MANAGER = A(0xaa);
    const fc = makeFakeClient({ reads: { getNodeOperator: { managerAddress: MANAGER } } });
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01) });

    await removeKey(ctx, { noId: 2n, keyIndex: 4n });

    const w = fc.byMethod('writeContract')[0] as any;
    expect(w.functionName).toBe('removeKeys');
    expect(w.args).toEqual([2n, 4n, 1n]);
    expect(w.account).toBe(MANAGER);
    expect(fc.byMethod('impersonateAccount')[0]).toEqual({ address: MANAGER });
  });

  it('honours an explicit count', async () => {
    const MANAGER = A(0xaa);
    const fc = makeFakeClient({ reads: { getNodeOperator: { managerAddress: MANAGER } } });
    const ctx = fakeCtx('cm', fc.client);
    await removeKey(ctx, { noId: 0n, keyIndex: 0n, count: 3n });
    const w = fc.byMethod('writeContract')[0] as any;
    expect(w.args).toEqual([0n, 0n, 3n]);
  });
});
```

> Note: merge the `removeKey` import into the existing `from '../src/recipes/vetting'` line rather than adding a duplicate import.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sm-lab/recipes test vetting`
Expected: FAIL — `removeKey` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `tools/recipes/src/recipes/vetting.ts`: add `import type { Hex } from '@sm-lab/receipts';` at the top, then append:

```ts
/** Remove `count` keys (default 1) from operator `noId` starting at `keyIndex`, as the operator's manager. */
export async function removeKey(
  ctx: Ctx,
  opts: { noId: bigint; keyIndex: bigint; count?: bigint },
): Promise<void> {
  const count = opts.count ?? 1n;
  const m = contract(ctx, 'module');
  const op = await ctx.client.readContract({
    ...m,
    functionName: 'getNodeOperator',
    args: [opts.noId],
  });
  const manager = (op as { managerAddress: Hex }).managerAddress;
  await actAs(ctx, manager, (from) =>
    ctx.client.writeContract({
      ...m,
      functionName: 'removeKeys',
      args: [opts.noId, opts.keyIndex, count],
      account: from,
      chain: null,
    }),
  );
}
```

- [ ] **Step 4: Extend the export**

In `tools/recipes/src/index.ts`, change `export { unvet, exit } from './recipes/vetting';` to:

```ts
export { unvet, exit, removeKey } from './recipes/vetting';
```

- [ ] **Step 5: Run test + gates**

Run: `pnpm --filter @sm-lab/recipes test vetting` → PASS. Then the four gates → green.

- [ ] **Step 6: Commit**

```bash
git add tools/recipes/src/recipes/vetting.ts tools/recipes/test/vetting.test.ts tools/recipes/src/index.ts
git commit -m "feat(recipes): add remove-key recipe"
```

---

### Task 3: `get-curve-info` read recipe

Port of `fork.just` `get-curve-info` → read-only `Accounting.getCurveInfo(id)`. No impersonation.

**Files:**
- Modify: `tools/recipes/src/recipes/reads.ts` (add `getCurveInfo` + types)
- Modify: `tools/recipes/test/recipes.test.ts` (add a describe block) — or create `tools/recipes/test/reads.test.ts` if no reads test exists there; use `recipes.test.ts` only if it already covers reads. Default: **create `tools/recipes/test/get-curve-info.test.ts`**.
- Modify: `tools/recipes/src/index.ts` (extend the reads export)

**Interfaces:**
- Produces: `getCurveInfo(ctx: Ctx, opts: { curveId: bigint }): Promise<BondCurveInfo>`; types `BondCurveInterval { minKeysCount: bigint; minBond: bigint; trend: bigint }`, `BondCurveInfo { intervals: BondCurveInterval[] }`.
- Consumes: `contract(ctx, 'Accounting')`, `ctx.client.readContract`.

- [ ] **Step 1: Write the failing test**

Create `tools/recipes/test/get-curve-info.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getCurveInfo } from '../src/recipes/reads';
import { makeFakeClient } from './helpers/fake-client';
import { A, fakeCtx } from './helpers/book';

describe('getCurveInfo', () => {
  it('reads getCurveInfo(curveId) on the Accounting contract, no writes', async () => {
    const curve = { intervals: [{ minKeysCount: 1n, minBond: 2n, trend: 3n }] };
    const fc = makeFakeClient({ reads: { getCurveInfo: curve } });
    const ctx = fakeCtx('csm', fc.client, { Accounting: A(0x02) });

    const res = await getCurveInfo(ctx, { curveId: 5n });

    expect(res).toEqual(curve);
    const read = fc.byMethod('readContract')[0] as any;
    expect(read.functionName).toBe('getCurveInfo');
    expect(read.args).toEqual([5n]);
    expect(read.address).toBe(A(0x02));
    expect(fc.byMethod('writeContract')).toHaveLength(0);
    expect(fc.byMethod('impersonateAccount')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sm-lab/recipes test get-curve-info`
Expected: FAIL — `getCurveInfo` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `tools/recipes/src/recipes/reads.ts`:

```ts
export interface BondCurveInterval {
  minKeysCount: bigint;
  minBond: bigint;
  trend: bigint;
}
export interface BondCurveInfo {
  intervals: BondCurveInterval[];
}

/** Read a bond curve by id from Accounting (read-only). */
export async function getCurveInfo(
  ctx: Ctx,
  opts: { curveId: bigint },
): Promise<BondCurveInfo> {
  const acc = contract(ctx, 'Accounting');
  const info = (await ctx.client.readContract({
    ...acc,
    functionName: 'getCurveInfo',
    args: [opts.curveId],
  })) as BondCurveInfo;
  return info;
}
```

- [ ] **Step 4: Extend the export**

In `tools/recipes/src/index.ts`, change `export { getPubkey, getKeyBalance } from './recipes/reads';` to:

```ts
export { getPubkey, getKeyBalance, getCurveInfo } from './recipes/reads';
export type { BondCurveInfo, BondCurveInterval } from './recipes/reads';
```

- [ ] **Step 5: Run test + gates**

Run: `pnpm --filter @sm-lab/recipes test get-curve-info` → PASS. Then the four gates → green.

- [ ] **Step 6: Commit**

```bash
git add tools/recipes/src/recipes/reads.ts tools/recipes/test/get-curve-info.test.ts tools/recipes/src/index.ts
git commit -m "feat(recipes): add get-curve-info read recipe"
```

---

### Task 4: unified `pause` / `resume` recipes (module + accounting + gates)

The headline feature. One mechanism for all three target kinds — `roleMember(target, DEFAULT_ADMIN_ROLE)` → `actAs(admin)` → `grantRole(PAUSE_ROLE|RESUME_ROLE)` → `pauseFor(maxUint256)` | `resume()` — precedented in `cm/index.ts:58-89`. Idempotent via an `isPaused` read guard. Module-agnostic: `contract(ctx,'module')`/`resolveGate` switch csm↔cm by `ctx.module`.

**Files:**
- Modify: `tools/recipes/src/roles.ts` (add `PAUSE_ROLE`)
- Create: `tools/recipes/src/recipes/pause.ts`
- Create: `tools/recipes/test/pause.test.ts`
- Modify: `tools/recipes/src/index.ts` (add exports)

**Interfaces:**
- Produces: `pause(ctx, opts: { target: string }): Promise<PauseResult>`, `resume(ctx, opts: { target: string }): Promise<PauseResult>`; type `PauseResult { target: string; address: Hex; paused: boolean }`; const `PAUSE_ROLE: Hex`.
- Consumes: `actAs`, `roleMember` (act-as), `contract`, `resolveGate`, `Ctx` (context), `DEFAULT_ADMIN_ROLE`, `RESUME_ROLE` (roles), `curatedGateAbi`, `vettedGateAbi` (@sm-lab/receipts), `maxUint256` (viem).

- [ ] **Step 1: Add the `PAUSE_ROLE` constant**

In `tools/recipes/src/roles.ts`, after the `RESUME_ROLE` line (line 9), add:

```ts
/** PausableWithRoles: keccak256("PAUSE_ROLE"). */
export const PAUSE_ROLE = keccak256(toBytes('PAUSE_ROLE'));
```

- [ ] **Step 2: Write the failing test**

Create `tools/recipes/test/pause.test.ts`:

```ts
import { maxUint256 } from 'viem';
import { describe, expect, it } from 'vitest';
import { pause, resume } from '../src/recipes/pause';
import { PAUSE_ROLE, RESUME_ROLE } from '../src/roles';
import { makeFakeClient } from './helpers/fake-client';
import { A, fakeCtx } from './helpers/book';

const ADMIN = A(0xd0);

describe('pause', () => {
  it('module (csm): grants PAUSE_ROLE + pauseFor(max) as admin on CSModule', async () => {
    const fc = makeFakeClient({ reads: { isPaused: false, getRoleMember: ADMIN } });
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01) });

    const res = await pause(ctx, { target: 'module' });

    const writes = fc.byMethod('writeContract') as any[];
    expect(writes[0].functionName).toBe('grantRole');
    expect(writes[0].args).toEqual([PAUSE_ROLE, ADMIN]);
    expect(writes[0].address).toBe(A(0x01));
    expect(writes[1].functionName).toBe('pauseFor');
    expect(writes[1].args).toEqual([maxUint256]);
    expect(writes[1].account).toBe(ADMIN);
    expect(res).toEqual({ target: 'module', address: A(0x01), paused: true });
  });

  it('module (cm): resolves the CuratedModule address', async () => {
    const fc = makeFakeClient({ reads: { isPaused: false, getRoleMember: ADMIN } });
    const ctx = fakeCtx('cm', fc.client, { CuratedModule: A(0x21) });
    const res = await pause(ctx, { target: 'module' });
    expect(res.address).toBe(A(0x21));
    expect((fc.byMethod('writeContract')[0] as any).address).toBe(A(0x21));
  });

  it('accounting: targets the Accounting address', async () => {
    const fc = makeFakeClient({ reads: { isPaused: false, getRoleMember: ADMIN } });
    const ctx = fakeCtx('csm', fc.client, { Accounting: A(0x02) });
    const res = await pause(ctx, { target: 'accounting' });
    expect(res.address).toBe(A(0x02));
    expect((fc.byMethod('writeContract')[0] as any).address).toBe(A(0x02));
  });

  it('gate (csm ics → VettedGate)', async () => {
    const fc = makeFakeClient({ reads: { isPaused: false, getRoleMember: ADMIN } });
    const ctx = fakeCtx('csm', fc.client, { VettedGate: A(0x0d) });
    const res = await pause(ctx, { target: 'ics' });
    expect(res.address).toBe(A(0x0d));
  });

  it('gate (cm po → CuratedGates[0])', async () => {
    const fc = makeFakeClient({ reads: { isPaused: false, getRoleMember: ADMIN } });
    const ctx = fakeCtx('cm', fc.client);
    const res = await pause(ctx, { target: 'po' });
    expect(res.address).toBe(A(0x30));
  });

  it('is idempotent: no writes when already paused', async () => {
    const fc = makeFakeClient({ reads: { isPaused: true, getRoleMember: ADMIN } });
    const ctx = fakeCtx('csm', fc.client);
    const res = await pause(ctx, { target: 'module' });
    expect(fc.byMethod('writeContract')).toHaveLength(0);
    expect(res.paused).toBe(true);
  });
});

describe('resume', () => {
  it('grants RESUME_ROLE + resume() as admin when paused', async () => {
    const fc = makeFakeClient({ reads: { isPaused: true, getRoleMember: ADMIN } });
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01) });

    const res = await resume(ctx, { target: 'module' });

    const writes = fc.byMethod('writeContract') as any[];
    expect(writes[0].functionName).toBe('grantRole');
    expect(writes[0].args).toEqual([RESUME_ROLE, ADMIN]);
    expect(writes[1].functionName).toBe('resume');
    expect(writes[1].account).toBe(ADMIN);
    expect(res).toEqual({ target: 'module', address: A(0x01), paused: false });
  });

  it('is idempotent: no writes when not paused', async () => {
    const fc = makeFakeClient({ reads: { isPaused: false, getRoleMember: ADMIN } });
    const ctx = fakeCtx('csm', fc.client);
    const res = await resume(ctx, { target: 'module' });
    expect(fc.byMethod('writeContract')).toHaveLength(0);
    expect(res.paused).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @sm-lab/recipes test pause`
Expected: FAIL — cannot resolve `../src/recipes/pause`.

- [ ] **Step 4: Write minimal implementation**

Create `tools/recipes/src/recipes/pause.ts`:

```ts
import { maxUint256 } from 'viem';
import type { Abi } from 'viem';
import { curatedGateAbi, vettedGateAbi } from '@sm-lab/receipts';
import type { Hex } from '@sm-lab/receipts';
import { actAs, roleMember } from '../act-as';
import { contract, resolveGate, type Ctx } from '../context';
import { DEFAULT_ADMIN_ROLE, PAUSE_ROLE, RESUME_ROLE } from '../roles';

export interface PauseResult {
  /** the target keyword as supplied (module | accounting | gate selector) */
  target: string;
  /** the resolved contract address */
  address: Hex;
  /** paused state after the call */
  paused: boolean;
}

/**
 * Resolve a pause target keyword to a contract handle. `module` and `accounting` are reserved;
 * anything else is a gate selector resolved via `resolveGate` (ics/idvtc for csm; po…iodcp/index
 * for cm; 0x… for either).
 */
function resolveTarget(ctx: Ctx, target: string): { address: Hex; abi: Abi } {
  if (target === 'module') {
    const m = contract(ctx, 'module');
    return { address: m.address, abi: m.abi as Abi };
  }
  if (target === 'accounting') {
    const a = contract(ctx, 'Accounting');
    return { address: a.address, abi: a.abi as Abi };
  }
  // All gate types share the PausableUntil surface, so either gate abi decodes it.
  const abi = (ctx.module === 'cm' ? curatedGateAbi : vettedGateAbi) as Abi;
  return { address: resolveGate(ctx, target), abi };
}

/** Pause a target (module | accounting | gate selector). Idempotent: no-op if already paused. */
export async function pause(ctx: Ctx, opts: { target: string }): Promise<PauseResult> {
  const t = resolveTarget(ctx, opts.target);
  const already = (await ctx.client.readContract({ ...t, functionName: 'isPaused' })) as boolean;
  if (already) return { target: opts.target, address: t.address, paused: true };

  const admin = await roleMember(ctx, t, DEFAULT_ADMIN_ROLE);
  await actAs(ctx, admin, async (from) => {
    await ctx.client.writeContract({
      ...t,
      functionName: 'grantRole',
      args: [PAUSE_ROLE, admin],
      account: from,
      chain: null,
    });
    await ctx.client.writeContract({
      ...t,
      functionName: 'pauseFor',
      args: [maxUint256],
      account: from,
      chain: null,
    });
  });
  return { target: opts.target, address: t.address, paused: true };
}

/** Resume a target (module | accounting | gate selector). Idempotent: no-op if not paused. */
export async function resume(ctx: Ctx, opts: { target: string }): Promise<PauseResult> {
  const t = resolveTarget(ctx, opts.target);
  const paused = (await ctx.client.readContract({ ...t, functionName: 'isPaused' })) as boolean;
  if (!paused) return { target: opts.target, address: t.address, paused: false };

  const admin = await roleMember(ctx, t, DEFAULT_ADMIN_ROLE);
  await actAs(ctx, admin, async (from) => {
    await ctx.client.writeContract({
      ...t,
      functionName: 'grantRole',
      args: [RESUME_ROLE, admin],
      account: from,
      chain: null,
    });
    await ctx.client.writeContract({
      ...t,
      functionName: 'resume',
      account: from,
      chain: null,
    });
  });
  return { target: opts.target, address: t.address, paused: false };
}
```

- [ ] **Step 5: Add exports**

In `tools/recipes/src/index.ts`:
- change `export { DEFAULT_ADMIN_ROLE, SET_TREE_ROLE, RESUME_ROLE } from './roles';` to include `PAUSE_ROLE`:

```ts
export { DEFAULT_ADMIN_ROLE, SET_TREE_ROLE, RESUME_ROLE, PAUSE_ROLE } from './roles';
```

- add, near the reads export:

```ts
export { pause, resume } from './recipes/pause';
export type { PauseResult } from './recipes/pause';
```

- [ ] **Step 6: Run test + gates**

Run: `pnpm --filter @sm-lab/recipes test pause` → PASS. Then the four gates → green.

- [ ] **Step 7: Commit**

```bash
git add tools/recipes/src/roles.ts tools/recipes/src/recipes/pause.ts tools/recipes/test/pause.test.ts tools/recipes/src/index.ts
git commit -m "feat(recipes): add unified pause/resume (module, accounting, gates)"
```

---

### Task 5: CLI descriptors + test updates

Wire all five recipes into the CLI as `RecipeCommand` descriptors. They're shared → auto-mirrored under `csm`/`cm` by `program.ts`. Update the exact-match command-name list in `cli-shared.test.ts`.

**Files:**
- Modify: `tools/recipes/src/cli/commands/shared.ts` (imports + 5 descriptors)
- Modify: `tools/recipes/test/cli-shared.test.ts` (expected names list)
- Test: `tools/recipes/test/cli-program.test.ts` (already dynamic; add group-mirror assertions for `pause`)

**Interfaces:**
- Consumes: `setTargetLimit`, `removeKey`, `getCurveInfo`, `pause`, `resume` (from Tasks 1-4); `bigintReplacer`, `identity`, `toBigInt`, `toNumber` (define); existing `operatorId`, `keyIndex` local specs.

- [ ] **Step 1: Write the failing test — extend the expected names list**

In `tools/recipes/test/cli-shared.test.ts`, add these five entries to the `toEqual([...])` array (order irrelevant — it's `.toSorted()` compared): `'set-target-limit'`, `'remove-key'`, `'get-curve-info'`, `'pause'`, `'resume'`.

Also append to `tools/recipes/test/cli-program.test.ts`, inside the `mirrors every shared command…` test (after line 87), an assertion that the new shared commands mirror too:

```ts
    for (const shared of ['pause', 'resume', 'set-target-limit', 'get-curve-info']) {
      expect(cmNames).toContain(shared);
      expect(csmNames).toContain(shared);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sm-lab/recipes test cli-shared`
Expected: FAIL — actual names list is missing the five new commands.

- [ ] **Step 3: Add the descriptors**

In `tools/recipes/src/cli/commands/shared.ts`:

Extend the `define` import to include `bigintReplacer`:

```ts
import {
  bigintReplacer,
  identity,
  toAddressValue,
  toBigInt,
  toEth,
  toHexValue,
  toNumber,
  type RecipeCommand,
} from '../define';
```

Add these recipe imports (alongside the existing ones):

```ts
import { setTargetLimit } from '../../recipes/target-limit';
import { removeKey } from '../../recipes/vetting';
import { getCurveInfo } from '../../recipes/reads';
import { pause, resume } from '../../recipes/pause';
```

> Note: `unvet, exit` are already imported from `'../../recipes/vetting'` (line 15). Merge `removeKey` into that existing import line instead of adding a second import from the same module; likewise merge `getCurveInfo` into the existing `'../../recipes/reads'` import (line 33).

Then add these five descriptors to the `sharedCommands` array (before the closing `]`):

```ts
  {
    name: 'set-target-limit',
    summary:
      "set an operator's target validator limit (as the StakingRouter); mode 0=off, 1=soft, 2=forced",
    options: [
      operatorId,
      {
        flag: '--mode <0|1|2>',
        key: 'mode',
        coerce: toNumber,
        required: true,
        description: '0=off, 1=soft, 2=forced',
      },
      {
        flag: '--limit <n>',
        key: 'limit',
        coerce: toBigInt,
        description: 'target limit (ignored for mode 0; default 0)',
      },
    ],
    run: (ctx, o: { noId: bigint; mode: number; limit?: bigint }) => setTargetLimit(ctx, o),
    report: (r: { noId: bigint; mode: number; limit: bigint }) => [
      `operator ${r.noId}: targetLimitMode=${r.mode}, limit=${r.limit}`,
    ],
  },
  {
    name: 'remove-key',
    summary: 'remove key(s) from an operator starting at an index (as manager)',
    options: [
      operatorId,
      keyIndex,
      {
        flag: '--count <n>',
        key: 'count',
        coerce: toBigInt,
        description: 'number of keys to remove (default 1)',
      },
    ],
    run: (ctx, o: { noId: bigint; keyIndex: bigint; count?: bigint }) => removeKey(ctx, o),
    report: (_r, o: { noId: bigint; keyIndex: bigint; count?: bigint }) => [
      `operator ${o.noId}: removed ${o.count ?? 1n} key(s) from index ${o.keyIndex}`,
    ],
  },
  {
    name: 'get-curve-info',
    summary: 'read a bond curve by id (read-only)',
    options: [
      {
        flag: '--curve-id <n>',
        key: 'curveId',
        coerce: toBigInt,
        required: true,
        description: 'bond curve id (uint)',
      },
    ],
    run: (ctx, o: { curveId: bigint }) => getCurveInfo(ctx, o),
    report: (r: unknown) => [JSON.stringify(r, bigintReplacer, 2)],
  },
  {
    name: 'pause',
    summary:
      'pause a target: module | accounting | gate selector (grants PAUSE_ROLE + pauseFor max; idempotent)',
    options: [
      {
        flag: '--target <name>',
        key: 'target',
        coerce: identity,
        required: true,
        positional: true,
        description: 'module | accounting | gate selector (ics/idvtc/po…iodcp/index/0x…)',
      },
    ],
    run: (ctx, o: { target: string }) => pause(ctx, o),
    report: (r: { target: string; address: Hex; paused: boolean }) => [
      `${r.target} (${r.address}): paused=${r.paused}`,
    ],
  },
  {
    name: 'resume',
    summary:
      'resume a target: module | accounting | gate selector (grants RESUME_ROLE + resume; idempotent)',
    options: [
      {
        flag: '--target <name>',
        key: 'target',
        coerce: identity,
        required: true,
        positional: true,
        description: 'module | accounting | gate selector (ics/idvtc/po…iodcp/index/0x…)',
      },
    ],
    run: (ctx, o: { target: string }) => resume(ctx, o),
    report: (r: { target: string; address: Hex; paused: boolean }) => [
      `${r.target} (${r.address}): paused=${r.paused}`,
    ],
  },
```

- [ ] **Step 4: Run tests + gates**

Run: `pnpm --filter @sm-lab/recipes test cli` → PASS (cli-shared, cli-program, cli-json, cli-modules, cli-define all green).
Then the four per-package gates → green.

- [ ] **Step 5: Smoke the CLI help manually**

Run: `pnpm --filter @sm-lab/recipes build && node tools/recipes/dist/cli.mjs csm pause --help`
Expected: usage shows `pause [options] [target]` and the positional-order help line `Required options may be passed positionally in this order: target`.

- [ ] **Step 6: Commit**

```bash
git add tools/recipes/src/cli/commands/shared.ts tools/recipes/test/cli-shared.test.ts tools/recipes/test/cli-program.test.ts
git commit -m "feat(recipes): expose set-target-limit, remove-key, get-curve-info, pause, resume in the CLI"
```

---

### Task 6: fork smoke round-trip + changeset

Extend the `ANVIL_FORK_URL`-gated smoke with a pause→resume round-trip, and add a changeset (repo convention: one changeset per user-facing change).

**Files:**
- Modify: `tools/recipes/test/smoke.fork.test.ts` (add one `it`)
- Create: `.changeset/<name>.md`

- [ ] **Step 1: Add the smoke round-trip**

Append inside the `describe.skipIf(!FORK_URL)(…)` block in `tools/recipes/test/smoke.fork.test.ts` (and add the import `import { pause, resume } from '../src/recipes/pause';` at the top):

```ts
  it('pauses and resumes the module (round-trip, idempotent)', async () => {
    const ctx = await connect({ module: 'csm', rpcUrl: FORK_URL as string });

    const paused = await pause(ctx, { target: 'module' });
    expect(paused.paused).toBe(true);
    expect(
      await ctx.client.readContract({
        address: ctx.addresses.CSModule as Hex,
        abi: csModuleAbi,
        functionName: 'isPaused',
      }),
    ).toBe(true);

    const resumed = await resume(ctx, { target: 'module' });
    expect(resumed.paused).toBe(false);
  });
```

Add the ABI import to the existing `@sm-lab/receipts` import line: change `import { feeDistributorAbi } from '@sm-lab/receipts';` to `import { csModuleAbi, feeDistributorAbi } from '@sm-lab/receipts';`. (`CSModule` is on `ResolvedAddresses` via the csm book.)

- [ ] **Step 2: Verify the default suite still passes (smoke stays skipped)**

Run: `pnpm --filter @sm-lab/recipes test`
Expected: all green; the fork smoke block is skipped (no `ANVIL_FORK_URL`).

> Optional live check (only if a hoodi fork is handy): `ANVIL_FORK_URL=http://127.0.0.1:8545 pnpm --filter @sm-lab/recipes test smoke` against `anvil --fork-url <hoodi RPC>`.

- [ ] **Step 3: Add a changeset**

Create `.changeset/missing-recipes.md`:

```md
---
'@sm-lab/recipes': minor
---

Add recipes: `set-target-limit`, `remove-key`, `get-curve-info`, and a unified `pause`/`resume`
that targets the module, accounting, or any gate (ics/idvtc for csm; po…iodcp for cm), across both
csm and cm. Exposed as CLI commands (shared, mirrored under the `csm`/`cm` groups).
```

- [ ] **Step 4: Full gates + commit**

```bash
pnpm --filter @sm-lab/recipes types
pnpm --filter @sm-lab/recipes test
pnpm --filter @sm-lab/recipes build
pnpm exec oxlint tools/recipes/src
pnpm exec prettier --check "tools/recipes/**/*.{ts,json}"
git add tools/recipes/test/smoke.fork.test.ts .changeset/missing-recipes.md
git commit -m "test(recipes): fork smoke pause/resume round-trip + changeset"
```

---

## Self-Review

**1. Spec coverage:**
- `set-target-limit` (modes 0/1/2) → Task 1. ✔
- `remove-key` (with `--count` default 1) → Task 2. ✔
- `get-curve-info` (read-only) → Task 3. ✔
- unified `pause`/`resume` for module + accounting + gates, csm & cm → Task 4 (recipe) + Task 5 (CLI). ✔
- No `@sm-lab/receipts` changes → confirmed; all fragments verified present. ✔
- Idempotence (`isPaused` guard) → Task 4 tests. ✔
- Module switch (csm↔cm resolves different addresses) → Task 4 tests (`module cm` → CuratedModule; `po` → CuratedGates[0]). ✔
- CLI auto-mirror under csm/cm groups → Task 5 (cli-program assertions). ✔
- Machine-readable `--json` → inherited from `defineCommand`; no per-recipe work. ✔
- Fork smoke pause→resume → Task 6. ✔
- Deferred `exit-request` / dropped dead recipes → out of scope, not in plan. ✔

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code; every command shows expected output. ✔

**3. Type consistency:** `setTargetLimit`/`removeKey`/`getCurveInfo`/`pause`/`resume` signatures identical across recipe files, index exports, and CLI descriptors. `PauseResult { target, address, paused }` used identically in `pause.ts`, tests, and the CLI `report`. `BondCurveInfo` used in `reads.ts` and its test. `PAUSE_ROLE` defined in `roles.ts`, exported in `index.ts`, asserted in `pause.test.ts`. ✔

## Execution note

Tasks 1-4 are independent (separate new files); `index.ts` is appended by each — trivial, sequential, no logical conflict. Task 5 depends on 1-4 (imports the recipes). Task 6 depends on 4. Recommended order: 1 → 2 → 3 → 4 → 5 → 6.
