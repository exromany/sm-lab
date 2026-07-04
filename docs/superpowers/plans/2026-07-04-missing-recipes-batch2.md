# Missing Recipes — Batch 2 (activate-keys, report-balance, topup, Tier-2 reads)

> **Executed via Workflow** (3 parallel implementers on disjoint files → serial integrator → opus review) on branch `feat/missing-recipes`, base `ddabc7e`.

**Goal:** Add 9 more `fork.just` recipes to `@sm-lab/recipes`: on-chain `activate-keys` + `report-balance` (Verifier-gated), `topup` (anvil setBalance), and six read-only recipes (`bond-info`, `operator-keys`, `key-balances`, `operators-count`, `get-last-operator`, `get-gate-tree`).

## Global Constraints (identical to Batch 1)

- ESM extensionless imports; `import type` for type-only. `noUncheckedIndexedAccess` on — guard array access.
- prettier: single quotes, width 100, trailing commas. oxlint clean. No `@sm-lab/receipts` changes.
- Verified ABI fragments present in `CSModule`+`CuratedModule`: `getNodeOperatorsCount`, `getKeyConfirmedBalances`, `getSigningKeys`, `getKeyAllocatedBalances`, `isValidatorWithdrawn`, `reportValidatorBalance`, `getNodeOperator`. `Accounting.getNodeOperatorBondInfo` → tuple `{currentBond, requiredBond, lockedBond, bondDebt, pendingSharesToSplit}` (all uint256). Gate `treeRoot`/`treeCid` present. `RecipeClient.setBalance` exists.
- Do NOT add Claude as a git co-author.

## File ownership (collision-free fan-out)

| Owner | File(s) | Recipes |
|---|---|---|
| **Impl-A** | `src/recipes/validators.ts` (+ append to `test/validators.test.ts`) | `activateKeys`, `reportBalance` |
| **Impl-B** | `src/recipes/chain.ts` (+ new `test/chain.test.ts`) | `topUpAccount` |
| **Impl-C** | `src/recipes/reads.ts` (+ new `test/reads-extra.test.ts`) | `bondInfo`, `operatorKeys`, `keyBalances`, `operatorsCount`, `getLastOperator`, `getGateTree` |
| **Integrator** | `src/index.ts`, `src/cli/commands/shared.ts`, `test/cli-shared.test.ts`, `.changeset/missing-recipes.md` | exports + CLI + changeset |

**Implementers MUST NOT touch `index.ts`, `shared.ts`, or any file another owner owns.** Unit tests import recipe fns directly from their source file (e.g. `from '../src/recipes/reads'`), so no export wiring is needed to test. Implementers run only their FOCUSED test (`pnpm --filter @sm-lab/recipes test <name>`) and do NOT commit. The integrator wires exports + CLI, runs the full gate, and makes the commits.

---

## Impl-A — `validators.ts`: `activateKeys` + `reportBalance`

Append to `tools/recipes/src/recipes/validators.ts` (it already imports `actAs`, `contract`, `Ctx`):

```ts
/** Effective balance the source reports to mark a key active: 32 ETH + 1 gwei. */
const ACTIVE_BALANCE = 32n * 10n ** 18n + 10n ** 9n;

/**
 * Activate `count` deposited-but-not-yet-active keys of an operator (Verifier-gated) by reporting
 * an effective balance of 32 ETH + 1 gwei on each. Skips keys that already have a confirmed
 * balance or are withdrawn. Port of `NodeOperators.activateKeys`. Returns the count activated.
 */
export async function activateKeys(
  ctx: Ctx,
  opts: { noId: bigint; count: number },
): Promise<{ activated: number }> {
  const m = contract(ctx, 'module');
  const { noId, count } = opts;

  const op = await ctx.client.readContract({ ...m, functionName: 'getNodeOperator', args: [noId] });
  const total = (op as { totalDepositedKeys: number }).totalDepositedKeys;

  // Read each deposited key's confirmed balance + withdrawn flag up front (order-independent).
  const state = await Promise.all(
    Array.from({ length: total }, (_, i) => i).map(async (i) => ({
      i,
      confirmed: (await ctx.client.readContract({
        ...m,
        functionName: 'getKeyConfirmedBalances',
        args: [noId, BigInt(i), 1n],
      })) as readonly bigint[],
      withdrawn: (await ctx.client.readContract({
        ...m,
        functionName: 'isValidatorWithdrawn',
        args: [noId, BigInt(i)],
      })) as boolean,
    })),
  );

  // Eligible = confirmed balance 0 and not withdrawn; take the first `count` in index order.
  const eligible = state.filter((s) => s.confirmed[0] === 0n && !s.withdrawn).slice(0, count);
  if (eligible.length < count) {
    throw new Error(
      `@sm-lab/recipes: operator ${noId} has only ${eligible.length} activatable key(s), need ${count}`,
    );
  }

  await actAs(ctx, ctx.addresses.Verifier, async (from) => {
    for (const { i } of eligible) {
      // eslint-disable-next-line no-await-in-loop -- impersonation is global fork state; sequential writes
      await ctx.client.writeContract({
        ...m,
        functionName: 'reportValidatorBalance',
        args: [noId, BigInt(i), ACTIVE_BALANCE],
        account: from,
        chain: null,
      });
    }
  });

  return { activated: eligible.length };
}

/**
 * Report an arbitrary CL balance (wei) for one deposited key (Verifier-gated). Validates the key
 * index is in range and not withdrawn. Port of `NodeOperators.reportBalance`.
 */
export async function reportBalance(
  ctx: Ctx,
  opts: { noId: bigint; keyIndex: bigint; balanceWei: bigint },
): Promise<{ noId: bigint; keyIndex: bigint; balanceWei: bigint }> {
  const m = contract(ctx, 'module');
  const { noId, keyIndex, balanceWei } = opts;

  const op = await ctx.client.readContract({ ...m, functionName: 'getNodeOperator', args: [noId] });
  const total = (op as { totalDepositedKeys: number }).totalDepositedKeys;
  if (keyIndex >= BigInt(total)) {
    throw new Error(
      `@sm-lab/recipes: key index ${keyIndex} out of bounds (operator ${noId} has ${total} deposited keys)`,
    );
  }
  const withdrawn = await ctx.client.readContract({
    ...m,
    functionName: 'isValidatorWithdrawn',
    args: [noId, keyIndex],
  });
  if (withdrawn) {
    throw new Error(`@sm-lab/recipes: key ${keyIndex} of operator ${noId} is withdrawn`);
  }

  await actAs(ctx, ctx.addresses.Verifier, (from) =>
    ctx.client.writeContract({
      ...m,
      functionName: 'reportValidatorBalance',
      args: [noId, keyIndex, balanceWei],
      account: from,
      chain: null,
    }),
  );

  return { noId, keyIndex, balanceWei };
}
```

Tests (append to `tools/recipes/test/validators.test.ts`; reuse its existing `makeFakeClient`/`A`/`fakeCtx` imports, merging any new symbols into existing import lines):

```ts
describe('activateKeys', () => {
  it('reports 32 ETH + 1 gwei for the first N eligible keys as the Verifier', async () => {
    const fc = makeFakeClient({
      reads: {
        getNodeOperator: { totalDepositedKeys: 3 },
        getKeyConfirmedBalances: [0n], // every key unconfirmed
        isValidatorWithdrawn: false,
      },
    });
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01) });

    const res = await activateKeys(ctx, { noId: 1n, count: 2 });

    expect(res).toEqual({ activated: 2 });
    const writes = fc.byMethod('writeContract') as any[];
    expect(writes).toHaveLength(2);
    expect(writes[0].functionName).toBe('reportValidatorBalance');
    expect(writes[0].args).toEqual([1n, 0n, 32n * 10n ** 18n + 10n ** 9n]);
    expect(writes[1].args).toEqual([1n, 1n, 32n * 10n ** 18n + 10n ** 9n]);
    expect(writes[0].account).toBe(ctx.addresses.Verifier);
  });

  it('throws when fewer keys are activatable than requested', async () => {
    const fc = makeFakeClient({
      reads: { getNodeOperator: { totalDepositedKeys: 1 }, getKeyConfirmedBalances: [0n], isValidatorWithdrawn: false },
    });
    const ctx = fakeCtx('csm', fc.client);
    await expect(activateKeys(ctx, { noId: 0n, count: 2 })).rejects.toThrow(/only 1 activatable/);
  });

  it('skips already-confirmed keys', async () => {
    const fc = makeFakeClient({
      reads: {
        getNodeOperator: { totalDepositedKeys: 2 },
        getKeyConfirmedBalances: (args: any) => (args[1] === 0n ? [5n] : [0n]), // key 0 already active
        isValidatorWithdrawn: false,
      },
    });
    const ctx = fakeCtx('csm', fc.client);
    const res = await activateKeys(ctx, { noId: 0n, count: 1 });
    expect(res.activated).toBe(1);
    const w = (fc.byMethod('writeContract') as any[])[0];
    expect(w.args[1]).toBe(1n); // key 1, not key 0
  });
});

describe('reportBalance', () => {
  it('reports the given wei balance for a key as the Verifier', async () => {
    const fc = makeFakeClient({
      reads: { getNodeOperator: { totalDepositedKeys: 3 }, isValidatorWithdrawn: false },
    });
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01) });
    const res = await reportBalance(ctx, { noId: 1n, keyIndex: 2n, balanceWei: 31n * 10n ** 18n });
    const w = (fc.byMethod('writeContract') as any[])[0];
    expect(w.functionName).toBe('reportValidatorBalance');
    expect(w.args).toEqual([1n, 2n, 31n * 10n ** 18n]);
    expect(w.account).toBe(ctx.addresses.Verifier);
    expect(res.balanceWei).toBe(31n * 10n ** 18n);
  });

  it('throws when the key index is out of bounds', async () => {
    const fc = makeFakeClient({ reads: { getNodeOperator: { totalDepositedKeys: 1 } } });
    const ctx = fakeCtx('csm', fc.client);
    await expect(reportBalance(ctx, { noId: 0n, keyIndex: 5n, balanceWei: 1n })).rejects.toThrow(/out of bounds/);
  });

  it('throws when the key is withdrawn', async () => {
    const fc = makeFakeClient({ reads: { getNodeOperator: { totalDepositedKeys: 3 }, isValidatorWithdrawn: true } });
    const ctx = fakeCtx('csm', fc.client);
    await expect(reportBalance(ctx, { noId: 0n, keyIndex: 0n, balanceWei: 1n })).rejects.toThrow(/withdrawn/);
  });
});
```

Focused test: `pnpm --filter @sm-lab/recipes test validators`.

---

## Impl-B — `chain.ts`: `topUpAccount`

Append to `tools/recipes/src/recipes/chain.ts` (it already imports `Hex` from `@sm-lab/receipts` and `Ctx`):

```ts
/**
 * Fund an account on the fork by setting its balance (anvil_setBalance). `amountWei` defaults to
 * 100 ETH. Port of `NodeOperators` `topup`.
 */
export async function topUpAccount(
  ctx: Ctx,
  opts: { address: Hex; amountWei?: bigint },
): Promise<{ address: Hex; amountWei: bigint }> {
  const amountWei = opts.amountWei ?? 100n * 10n ** 18n;
  await ctx.client.setBalance({ address: opts.address, value: amountWei });
  return { address: opts.address, amountWei };
}
```

New test `tools/recipes/test/chain.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { topUpAccount } from '../src/recipes/chain';
import { makeFakeClient } from './helpers/fake-client';
import { A, fakeCtx } from './helpers/book';

describe('topUpAccount', () => {
  it('sets the balance via setBalance and returns it', async () => {
    const fc = makeFakeClient();
    const ctx = fakeCtx('csm', fc.client);
    const res = await topUpAccount(ctx, { address: A(0xab), amountWei: 5n * 10n ** 18n });
    expect(fc.byMethod('setBalance')[0]).toEqual({ address: A(0xab), value: 5n * 10n ** 18n });
    expect(res).toEqual({ address: A(0xab), amountWei: 5n * 10n ** 18n });
  });

  it('defaults to 100 ETH when amount is omitted', async () => {
    const fc = makeFakeClient();
    const ctx = fakeCtx('csm', fc.client);
    const res = await topUpAccount(ctx, { address: A(0xab) });
    expect(res.amountWei).toBe(100n * 10n ** 18n);
    expect((fc.byMethod('setBalance')[0] as any).value).toBe(100n * 10n ** 18n);
  });
});
```

Focused test: `pnpm --filter @sm-lab/recipes test chain`.

---

## Impl-C — `reads.ts`: six read recipes

Edit `tools/recipes/src/recipes/reads.ts`. Current imports: `import { size } from 'viem';`, `import type { Hex } from '@sm-lab/receipts';`, `import { contract, type Ctx } from '../context';`. ADD to the context import: `resolveGate`; ADD a receipts value import: `import { curatedGateAbi, vettedGateAbi } from '@sm-lab/receipts';`. Then append:

```ts
export interface BondInfo {
  currentBond: bigint;
  requiredBond: bigint;
  lockedBond: bigint;
  bondDebt: bigint;
  pendingSharesToSplit: bigint;
}

/** Read an operator's bond summary from Accounting (read-only). */
export async function bondInfo(ctx: Ctx, opts: { noId: bigint }): Promise<BondInfo> {
  const acc = contract(ctx, 'Accounting');
  return (await ctx.client.readContract({
    ...acc,
    functionName: 'getNodeOperatorBondInfo',
    args: [opts.noId],
  })) as BondInfo;
}

/** All of an operator's pubkeys (48 bytes each), in index order (read-only). */
export async function operatorKeys(ctx: Ctx, opts: { noId: bigint }): Promise<Hex[]> {
  const m = contract(ctx, 'module');
  const op = await ctx.client.readContract({ ...m, functionName: 'getNodeOperator', args: [opts.noId] });
  const total = (op as { totalAddedKeys: number }).totalAddedKeys;
  if (total === 0) return [];
  const packed = (await ctx.client.readContract({
    ...m,
    functionName: 'getSigningKeys',
    args: [opts.noId, 0n, BigInt(total)],
  })) as Hex;
  const hex = packed.slice(2); // drop 0x; 48 bytes = 96 hex chars per key
  const keys: Hex[] = [];
  for (let i = 0; i < total; i++) keys.push(`0x${hex.slice(i * 96, (i + 1) * 96)}` as Hex);
  return keys;
}

/** All of an operator's deposited-key allocated balances (wei), in index order (read-only). */
export async function keyBalances(ctx: Ctx, opts: { noId: bigint }): Promise<bigint[]> {
  const m = contract(ctx, 'module');
  const op = await ctx.client.readContract({ ...m, functionName: 'getNodeOperator', args: [opts.noId] });
  const total = (op as { totalDepositedKeys: number }).totalDepositedKeys;
  if (total === 0) return [];
  const balances = (await ctx.client.readContract({
    ...m,
    functionName: 'getKeyAllocatedBalances',
    args: [opts.noId, 0n, BigInt(total)],
  })) as readonly bigint[];
  return [...balances];
}

/** Total number of node operators in the module (read-only). */
export async function operatorsCount(ctx: Ctx): Promise<bigint> {
  const m = contract(ctx, 'module');
  return (await ctx.client.readContract({ ...m, functionName: 'getNodeOperatorsCount' })) as bigint;
}

/** The highest node operator id (count - 1). Throws when there are no operators. */
export async function getLastOperator(ctx: Ctx): Promise<bigint> {
  const count = await operatorsCount(ctx);
  if (count === 0n) throw new Error('@sm-lab/recipes: no node operators');
  return count - 1n;
}

export interface GateTree {
  selector: string;
  address: Hex;
  treeRoot: Hex;
  treeCid: string;
}

/** Read a gate's current merkle tree params (root + cid) by selector (read-only). */
export async function getGateTree(ctx: Ctx, opts: { selector: string }): Promise<GateTree> {
  const address = resolveGate(ctx, opts.selector);
  const abi = ctx.module === 'cm' ? curatedGateAbi : vettedGateAbi;
  const gate = { address, abi } as const;
  const treeRoot = (await ctx.client.readContract({ ...gate, functionName: 'treeRoot' })) as Hex;
  const treeCid = (await ctx.client.readContract({ ...gate, functionName: 'treeCid' })) as string;
  return { selector: opts.selector, address, treeRoot, treeCid };
}
```

New test `tools/recipes/test/reads-extra.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { bondInfo, operatorKeys, keyBalances, operatorsCount, getLastOperator, getGateTree } from '../src/recipes/reads';
import { makeFakeClient } from './helpers/fake-client';
import { A, fakeCtx } from './helpers/book';

describe('bondInfo', () => {
  it('reads getNodeOperatorBondInfo on Accounting', async () => {
    const info = { currentBond: 1n, requiredBond: 2n, lockedBond: 3n, bondDebt: 4n, pendingSharesToSplit: 5n };
    const fc = makeFakeClient({ reads: { getNodeOperatorBondInfo: info } });
    const ctx = fakeCtx('csm', fc.client, { Accounting: A(0x02) });
    const res = await bondInfo(ctx, { noId: 1n });
    expect(res).toEqual(info);
    const read = (fc.byMethod('readContract') as any[])[0];
    expect(read.functionName).toBe('getNodeOperatorBondInfo');
    expect(read.address).toBe(A(0x02));
    expect(fc.byMethod('writeContract')).toHaveLength(0);
  });
});

describe('operatorKeys', () => {
  it('slices packed signing keys into 48-byte pubkeys', async () => {
    const k0 = '11'.repeat(48);
    const k1 = '22'.repeat(48);
    const fc = makeFakeClient({
      reads: { getNodeOperator: { totalAddedKeys: 2 }, getSigningKeys: `0x${k0}${k1}` },
    });
    const ctx = fakeCtx('csm', fc.client);
    const res = await operatorKeys(ctx, { noId: 0n });
    expect(res).toEqual([`0x${k0}`, `0x${k1}`]);
  });

  it('returns [] when the operator has no keys', async () => {
    const fc = makeFakeClient({ reads: { getNodeOperator: { totalAddedKeys: 0 } } });
    const ctx = fakeCtx('csm', fc.client);
    expect(await operatorKeys(ctx, { noId: 0n })).toEqual([]);
  });
});

describe('keyBalances', () => {
  it('reads all deposited-key allocated balances', async () => {
    const fc = makeFakeClient({
      reads: { getNodeOperator: { totalDepositedKeys: 2 }, getKeyAllocatedBalances: [10n, 20n] },
    });
    const ctx = fakeCtx('csm', fc.client);
    expect(await keyBalances(ctx, { noId: 0n })).toEqual([10n, 20n]);
  });
});

describe('operatorsCount / getLastOperator', () => {
  it('operatorsCount reads getNodeOperatorsCount', async () => {
    const fc = makeFakeClient({ reads: { getNodeOperatorsCount: 4n } });
    const ctx = fakeCtx('csm', fc.client);
    expect(await operatorsCount(ctx)).toBe(4n);
  });
  it('getLastOperator returns count - 1', async () => {
    const fc = makeFakeClient({ reads: { getNodeOperatorsCount: 4n } });
    const ctx = fakeCtx('csm', fc.client);
    expect(await getLastOperator(ctx)).toBe(3n);
  });
  it('getLastOperator throws when there are no operators', async () => {
    const fc = makeFakeClient({ reads: { getNodeOperatorsCount: 0n } });
    const ctx = fakeCtx('csm', fc.client);
    await expect(getLastOperator(ctx)).rejects.toThrow(/no node operators/);
  });
});

describe('getGateTree', () => {
  it('reads treeRoot + treeCid on the csm ics gate', async () => {
    const fc = makeFakeClient({ reads: { treeRoot: '0xabc', treeCid: 'cid-x' } });
    const ctx = fakeCtx('csm', fc.client, { VettedGate: A(0x0d) });
    const res = await getGateTree(ctx, { selector: 'ics' });
    expect(res).toEqual({ selector: 'ics', address: A(0x0d), treeRoot: '0xabc', treeCid: 'cid-x' });
  });
  it('resolves a cm gate (po → CuratedGates[0])', async () => {
    const fc = makeFakeClient({ reads: { treeRoot: '0xabc', treeCid: 'cid-x' } });
    const ctx = fakeCtx('cm', fc.client);
    const res = await getGateTree(ctx, { selector: 'po' });
    expect(res.address).toBe(A(0x30));
  });
});
```

Focused test: `pnpm --filter @sm-lab/recipes test reads-extra`.

---

## Integrator — exports + CLI + changeset + full gate + commit

Only run after Impl-A/B/C files exist. Steps:

### 1. `src/index.ts` — extend three existing export lines

- `export { slash, withdraw } from './recipes/validators';` → add `activateKeys, reportBalance`, and add:
  `export type { WithdrawnValidatorInfo } from './recipes/validators';` already exists — leave it.
- `export { warpBy, warpTo, snapshot, revert } from './recipes/chain';` → add `topUpAccount`.
- `export { getPubkey, getKeyBalance, getCurveInfo } from './recipes/reads';` → add `bondInfo, operatorKeys, keyBalances, operatorsCount, getLastOperator, getGateTree`.
- Extend the reads type export: `export type { BondCurveInfo, BondCurveInterval } from './recipes/reads';` → add `BondInfo, GateTree`.

### 2. `src/cli/commands/shared.ts` — add 9 descriptors

Extend imports (merge, don't duplicate): the `../define` import already provides `identity, toAddressValue, toBigInt, toEth, toHexValue, toNumber, bigintReplacer, RecipeCommand` — ensure `toNumber`, `toEth`, `toAddressValue`, `identity` are present (add any missing). Recipe fn imports: merge `activateKeys, reportBalance` into the existing `'../../recipes/validators'` import (`import { slash, withdraw } ...`); merge `topUpAccount` into the existing `'../../recipes/chain'` import; merge `bondInfo, operatorKeys, keyBalances, operatorsCount, getLastOperator, getGateTree` into the existing `'../../recipes/reads'` import. `formatEther` is already imported from `viem`. Reuse the existing `operatorId`/`keyIndex` option specs.

Add to the `sharedCommands` array (before the closing `]`):

```ts
  {
    name: 'activate-keys',
    summary: 'activate N deposited keys on-chain (report 32 ETH + 1 gwei each, Verifier-gated)',
    options: [operatorId, { flag: '--count <n>', key: 'count', coerce: toNumber, required: true }],
    run: (ctx, o: { noId: bigint; count: number }) => activateKeys(ctx, o),
    report: (r: { activated: number }) => [`activated ${r.activated} key(s)`],
  },
  {
    name: 'report-balance',
    summary: "report a key's CL balance on-chain (ETH, Verifier-gated)",
    options: [
      operatorId,
      keyIndex,
      { flag: '--balance <eth>', key: 'balanceWei', coerce: toEth, required: true },
    ],
    run: (ctx, o: { noId: bigint; keyIndex: bigint; balanceWei: bigint }) => reportBalance(ctx, o),
    report: (r: { noId: bigint; keyIndex: bigint; balanceWei: bigint }) => [
      `operator ${r.noId} key ${r.keyIndex}: reported ${formatEther(r.balanceWei)} ETH`,
    ],
  },
  {
    name: 'topup',
    summary: 'fund an account by setting its balance (anvil_setBalance; default 100 ETH)',
    options: [
      { flag: '--address <addr>', key: 'address', coerce: toAddressValue, required: true, positional: true },
      { flag: '--amount <eth>', key: 'amountWei', coerce: toEth, description: 'ETH to set (default 100)' },
    ],
    run: (ctx, o: { address: Hex; amountWei?: bigint }) => topUpAccount(ctx, o),
    report: (r: { address: Hex; amountWei: bigint }) => [
      `${r.address}: balance set to ${formatEther(r.amountWei)} ETH`,
    ],
  },
  {
    name: 'bond-info',
    summary: "read an operator's bond summary (read-only); one field per line, --json for the object",
    options: [operatorId],
    run: (ctx, o: { noId: bigint }) => bondInfo(ctx, o),
    report: (r: Record<string, bigint>, o: { noId: bigint }) => [
      `operator ${o.noId}:`,
      ...Object.entries(r).map(([k, v]) => `  ${k}: ${v}`),
    ],
  },
  {
    name: 'operator-keys',
    summary: "read all of an operator's pubkeys (read-only)",
    options: [operatorId],
    run: (ctx, o: { noId: bigint }) => operatorKeys(ctx, o),
    report: (r: Hex[]) => (r.length ? r : ['(no keys)']),
  },
  {
    name: 'key-balances',
    summary: "read all of an operator's deposited-key allocated balances (read-only)",
    options: [operatorId],
    run: (ctx, o: { noId: bigint }) => keyBalances(ctx, o),
    report: (r: bigint[]) =>
      r.length ? r.map((b, i) => `  key ${i}: ${formatEther(b)} ETH`) : ['(no deposited keys)'],
  },
  {
    name: 'operators-count',
    summary: 'read the module operator count (read-only)',
    options: [],
    run: (ctx) => operatorsCount(ctx),
    report: (r: bigint) => [`${r}`],
  },
  {
    name: 'get-last-operator',
    summary: 'read the highest operator id, count - 1 (read-only)',
    options: [],
    run: (ctx) => getLastOperator(ctx),
    report: (r: bigint) => [`${r}`],
  },
  {
    name: 'get-gate-tree',
    summary: "read a gate's current merkle tree root + cid by selector (read-only)",
    options: [
      {
        flag: '--selector <name>',
        key: 'selector',
        coerce: identity,
        required: true,
        positional: true,
        description: 'gate selector (ics/idvtc for csm; po…iodcp for cm; 0x…)',
      },
    ],
    run: (ctx, o: { selector: string }) => getGateTree(ctx, o),
    report: (r: { selector: string; address: Hex; treeRoot: Hex; treeCid: string }) => [
      `${r.selector} → ${r.address}`,
      `root: ${r.treeRoot}`,
      `cid:  ${r.treeCid}`,
    ],
  },
```

### 3. `test/cli-shared.test.ts` — extend the exact-match name list

Add these 9 to the `toEqual([...])` array: `'activate-keys'`, `'report-balance'`, `'topup'`, `'bond-info'`, `'operator-keys'`, `'key-balances'`, `'operators-count'`, `'get-last-operator'`, `'get-gate-tree'`.

### 4. `.changeset/missing-recipes.md` — extend the body

Add the new recipes to the existing changeset body (keep `'@sm-lab/recipes': minor`): append a sentence listing `activate-keys`, `report-balance`, `topup`, and the read recipes (`bond-info`, `operator-keys`, `key-balances`, `operators-count`, `get-last-operator`, `get-gate-tree`).

### 5. Full gate + commit

```bash
pnpm --filter @sm-lab/recipes types
pnpm --filter @sm-lab/recipes test
pnpm --filter @sm-lab/recipes build
pnpm exec oxlint tools/recipes/src
pnpm exec prettier --check "tools/recipes/**/*.{ts,json}"
```
Fix prettier with `--write` on touched files if needed. Then commit (two commits ok):

```bash
git add tools/recipes/src tools/recipes/test
git commit -m "feat(recipes): add activate-keys, report-balance, topup + tier-2 read recipes"
git add tools/recipes/src/cli tools/recipes/test/cli-shared.test.ts .changeset/missing-recipes.md
git commit -m "feat(recipes): expose batch-2 recipes in the CLI + changeset"
```
(Or one combined commit — the split is a nicety.) Do NOT add Claude as a git co-author.
