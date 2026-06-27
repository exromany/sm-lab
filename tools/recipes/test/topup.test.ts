import { describe, expect, it } from 'vitest';
import { increaseAllocatedBalance, topUpActiveKeys } from '../src/recipes/topup';
import { makeFakeClient } from './helpers/fake-client';
import { A, fakeCtx } from './helpers/book';

const MAX = 2016n * 10n ** 18n;
// A distinct, well-formed 48-byte pubkey per key index (48 bytes = 96 hex chars after 0x).
const pk = (i: number): `0x${string}` =>
  `0x${i.toString(16).padStart(2, '0').repeat(48)}` as `0x${string}`;

describe('increaseAllocatedBalance', () => {
  it('tops up a single key as the staking router (T1)', async () => {
    const PK = pk(0xa1);
    const fc = makeFakeClient({
      reads: {
        getNodeOperator: { totalDepositedKeys: 4 },
        isValidatorWithdrawn: false,
        getSigningKeys: PK,
      },
    });
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01) });

    const res = await increaseAllocatedBalance(ctx, {
      noId: 1n,
      keyIndex: 2n,
      amountWei: 5n * 10n ** 18n,
    });
    expect(res).toEqual({ amountWei: 5n * 10n ** 18n });

    const writes = fc.byMethod('writeContract') as any[];
    expect(writes).toHaveLength(1);
    expect(writes[0].functionName).toBe('allocateDeposits');
    expect(writes[0].args).toEqual([5n * 10n ** 18n, [PK], [2n], [1n], [5n * 10n ** 18n]]);
    expect(writes[0].account).toBe(ctx.addresses.stakingRouter);
    expect(writes[0].chain).toBe(null);
    expect(fc.byMethod('impersonateAccount')).toContainEqual({
      address: ctx.addresses.stakingRouter,
    });
  });

  it('throws when the key index is out of bounds, no write or impersonate (T2)', async () => {
    const fc = makeFakeClient({
      reads: {
        getNodeOperator: { totalDepositedKeys: 2 },
        isValidatorWithdrawn: false,
        getSigningKeys: pk(0xa1),
      },
    });
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01) });
    await expect(
      increaseAllocatedBalance(ctx, { noId: 1n, keyIndex: 2n, amountWei: 1n }),
    ).rejects.toThrow(/out of bounds/);
    expect(fc.byMethod('writeContract')).toHaveLength(0);
    expect(fc.byMethod('impersonateAccount')).toHaveLength(0);
  });

  it('throws on a withdrawn key, no write (T3)', async () => {
    const fc = makeFakeClient({
      reads: {
        getNodeOperator: { totalDepositedKeys: 4 },
        isValidatorWithdrawn: true,
        getSigningKeys: pk(0xa1),
      },
    });
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01) });
    await expect(
      increaseAllocatedBalance(ctx, { noId: 1n, keyIndex: 1n, amountWei: 1n }),
    ).rejects.toThrow(/withdrawn/);
    expect(fc.byMethod('writeContract')).toHaveLength(0);
    expect(fc.byMethod('impersonateAccount')).toHaveLength(0);
  });

  it('throws on a missing/empty pubkey, no write (T4)', async () => {
    const fc = makeFakeClient({
      reads: {
        getNodeOperator: { totalDepositedKeys: 4 },
        isValidatorWithdrawn: false,
        getSigningKeys: '0x',
      },
    });
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01) });
    await expect(
      increaseAllocatedBalance(ctx, { noId: 1n, keyIndex: 1n, amountWei: 1n }),
    ).rejects.toThrow(/no key found/);
    expect(fc.byMethod('writeContract')).toHaveLength(0);
  });
});

describe('topUpActiveKeys', () => {
  it('tops up only not-allocated, not-withdrawn keys (partial skip) (T5)', async () => {
    const fc = makeFakeClient({
      reads: {
        getNodeOperator: { totalDepositedKeys: 3 },
        getKeyAllocatedBalances: [0n, 7n, 0n], // index 1 already allocated → skipped
        isValidatorWithdrawn: (args: unknown[]) => args[1] === 2n, // index 2 withdrawn → skipped
        getSigningKeys: (args: unknown[]) => pk(Number(args[1])),
      },
    });
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01) });

    const res = await topUpActiveKeys(ctx, { noId: 9n });
    expect(res).toEqual({ toppedUp: 1 });

    const writes = fc.byMethod('writeContract') as any[];
    expect(writes).toHaveLength(1);
    expect(writes[0].functionName).toBe('allocateDeposits');
    expect(writes[0].args).toEqual([MAX, [pk(0)], [0n], [9n], [MAX]]);
    expect(writes[0].account).toBe(ctx.addresses.stakingRouter);
    expect(writes[0].chain).toBe(null);
    expect(fc.byMethod('impersonateAccount')).toContainEqual({
      address: ctx.addresses.stakingRouter,
    });
  });

  it('tops up all keys in ascending key-index order (T6)', async () => {
    const fc = makeFakeClient({
      reads: {
        getNodeOperator: { totalDepositedKeys: 3 },
        getKeyAllocatedBalances: [0n, 0n, 0n],
        isValidatorWithdrawn: false,
        getSigningKeys: (args: unknown[]) => pk(Number(args[1])),
      },
    });
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01) });

    const res = await topUpActiveKeys(ctx, { noId: 9n });
    expect(res).toEqual({ toppedUp: 3 });

    const writes = fc.byMethod('writeContract') as any[];
    expect(writes).toHaveLength(3);
    expect(writes.map((w) => w.args[2])).toEqual([[0n], [1n], [2n]]); // ascending keyIndices
    expect(writes[0].args).toEqual([MAX, [pk(0)], [0n], [9n], [MAX]]);
    expect(writes[2].args).toEqual([MAX, [pk(2)], [2n], [9n], [MAX]]);
    expect(writes.every((w) => w.account === ctx.addresses.stakingRouter)).toBe(true);
    // one impersonation session covering all writes
    expect(fc.byMethod('impersonateAccount')).toHaveLength(1);
  });

  it('is a no-op when nothing needs topping up — zero writes, zero impersonate (T7)', async () => {
    const fc = makeFakeClient({
      reads: {
        getNodeOperator: { totalDepositedKeys: 2 },
        getKeyAllocatedBalances: [5n, 5n],
        isValidatorWithdrawn: false,
        getSigningKeys: (args: unknown[]) => pk(Number(args[1])),
      },
    });
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01) });

    const res = await topUpActiveKeys(ctx, { noId: 9n });
    expect(res).toEqual({ toppedUp: 0 });
    expect(fc.byMethod('writeContract')).toHaveLength(0);
    expect(fc.byMethod('impersonateAccount')).toHaveLength(0);
  });

  it('throws when the operator has no deposited keys, zero writes (T8)', async () => {
    const fc = makeFakeClient({
      reads: { getNodeOperator: { totalDepositedKeys: 0 } },
    });
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01) });
    await expect(topUpActiveKeys(ctx, { noId: 9n })).rejects.toThrow(/no deposited keys/);
    expect(fc.byMethod('writeContract')).toHaveLength(0);
  });

  it('reads all per-key state before any write (T9)', async () => {
    const fc = makeFakeClient({
      reads: {
        getNodeOperator: { totalDepositedKeys: 3 },
        getKeyAllocatedBalances: [0n, 0n, 0n],
        isValidatorWithdrawn: false,
        getSigningKeys: (args: unknown[]) => pk(Number(args[1])),
      },
    });
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01) });
    await topUpActiveKeys(ctx, { noId: 9n });

    const order = fc.order();
    const lastRead = order.lastIndexOf('readContract');
    const firstWrite = order.indexOf('writeContract');
    expect(firstWrite).toBeGreaterThan(lastRead);
  });
});
