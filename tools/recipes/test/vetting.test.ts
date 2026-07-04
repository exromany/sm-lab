import { toHex } from 'viem';
import { describe, expect, it } from 'vitest';
import { keyCountBytes, nodeOperatorIdBytes } from '../src/encode';
import { exit, removeKey, unvet } from '../src/recipes/vetting';
import { makeFakeClient } from './helpers/fake-client';
import { A, fakeCtx } from './helpers/book';

describe('encode helpers', () => {
  it('packs noId as bytes8 and count as bytes16 (big-endian)', () => {
    expect(nodeOperatorIdBytes(1n)).toBe('0x0000000000000001');
    expect(keyCountBytes(5n)).toBe('0x00000000000000000000000000000005');
    expect(nodeOperatorIdBytes(7n)).toBe(toHex(7n, { size: 8 }));
  });
});

describe('vetting recipes', () => {
  it('unvet: decreaseVettedSigningKeysCount(bytes8 noId, bytes16 count) as the staking router', async () => {
    const fc = makeFakeClient();
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01) });
    await unvet(ctx, { noId: 1n, vettedKeys: 5n });
    const w = fc.byMethod('writeContract')[0] as any;
    expect(w.functionName).toBe('decreaseVettedSigningKeysCount');
    expect(w.args).toEqual([nodeOperatorIdBytes(1n), keyCountBytes(5n)]);
    expect(w.account).toBe(ctx.addresses.stakingRouter);
    expect(fc.byMethod('impersonateAccount')[0]).toEqual({ address: ctx.addresses.stakingRouter });
  });

  it('exit: updateExitedValidatorsCount(bytes8 noId, bytes16 count) as the staking router', async () => {
    const fc = makeFakeClient();
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01) });
    await exit(ctx, { noId: 2n, exitedKeys: 3n });
    const w = fc.byMethod('writeContract')[0] as any;
    expect(w.functionName).toBe('updateExitedValidatorsCount');
    expect(w.args).toEqual([nodeOperatorIdBytes(2n), keyCountBytes(3n)]);
    expect(w.account).toBe(ctx.addresses.stakingRouter);
  });
});

describe('removeKey', () => {
  it('calls removeKeys(noId, keyIndex, count) as the operator manager (default count=1)', async () => {
    const MANAGER = A(0xaa);
    const fc = makeFakeClient({ reads: { getNodeOperator: { managerAddress: MANAGER } } });
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01) });

    const res = await removeKey(ctx, { noId: 2n, keyIndex: 4n });

    const w = fc.byMethod('writeContract')[0] as any;
    expect(w.functionName).toBe('removeKeys');
    expect(w.args).toEqual([2n, 4n, 1n]);
    expect(w.account).toBe(MANAGER);
    expect(fc.byMethod('impersonateAccount')[0]).toEqual({ address: MANAGER });
    expect(res).toEqual({ noId: 2n, keyIndex: 4n, count: 1n });
  });

  it('honours an explicit count', async () => {
    const MANAGER = A(0xaa);
    const fc = makeFakeClient({ reads: { getNodeOperator: { managerAddress: MANAGER } } });
    const ctx = fakeCtx('cm', fc.client);
    const res = await removeKey(ctx, { noId: 0n, keyIndex: 0n, count: 3n });
    const w = fc.byMethod('writeContract')[0] as any;
    expect(w.args).toEqual([0n, 0n, 3n]);
    expect(res).toEqual({ noId: 0n, keyIndex: 0n, count: 3n });
  });
});
