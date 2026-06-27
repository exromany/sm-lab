import { toHex } from 'viem';
import { describe, expect, it } from 'vitest';
import { keyCountBytes, nodeOperatorIdBytes } from '../src/encode';
import { exit, unvet } from '../src/recipes/vetting';
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
