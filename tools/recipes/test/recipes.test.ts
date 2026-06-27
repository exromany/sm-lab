import { describe, expect, it } from 'vitest';
import { addKeys } from '../src/recipes/add-keys';
import { operatorInfo } from '../src/recipes/operator-info';
import { revert, snapshot, warpBy } from '../src/recipes/chain';
import { makeFakeClient } from './helpers/fake-client';
import { A, fakeCtx } from './helpers/book';

describe('addKeys', () => {
  it('reads bond + manager, then sends addValidatorKeysETH impersonating the manager', async () => {
    const MANAGER = A(0xb1);
    const { client, order, byMethod } = makeFakeClient({
      reads: { getNodeOperator: { managerAddress: MANAGER }, getRequiredBondForNextKeys: 5n },
    });
    const ctx = fakeCtx('csm', client, { CSModule: A(0x01), Accounting: A(0x02) });

    const res = await addKeys(ctx, { noId: 3n, count: 2, seed: '0x01' });
    expect(res.publicKeys).toHaveLength(2);

    const w = byMethod('writeContract')[0] as any;
    expect(w.functionName).toBe('addValidatorKeysETH');
    expect(w.address).toBe(A(0x01));
    expect(w.args[0]).toBe(MANAGER); // from
    expect(w.args[1]).toBe(3n); // noId
    expect(w.args[2]).toBe(2n); // count (bigint)
    expect(w.args[3].length).toBe(2 + 2 * 48 * 2); // packed pubkeys
    expect(w.args[4].length).toBe(2 + 2 * 96 * 2); // packed signatures
    expect(w.value).toBe(5n);
    expect(w.account).toBe(MANAGER);

    const o = order();
    expect(o.indexOf('impersonateAccount')).toBeLessThan(o.indexOf('writeContract'));
    expect(o.indexOf('writeContract')).toBeLessThan(o.indexOf('stopImpersonatingAccount'));
  });
});

describe('operatorInfo', () => {
  it('returns the decoded NodeOperator struct', async () => {
    const op = {
      totalAddedKeys: 5,
      totalDepositedKeys: 2,
      managerAddress: A(0xb1),
      rewardAddress: A(0xb2),
      extendedManagerPermissions: true,
    };
    const { client } = makeFakeClient({ reads: { getNodeOperator: op } });
    const info = await operatorInfo(fakeCtx('csm', client), { noId: 1n });
    expect(info.managerAddress).toBe(A(0xb1));
    expect(info.totalAddedKeys).toBe(5);
    expect(info.extendedManagerPermissions).toBe(true);
  });
});

describe('chain ops', () => {
  it('warpBy increases time then mines a block', async () => {
    const { client, order, byMethod } = makeFakeClient();
    await warpBy(fakeCtx('csm', client), 86400);
    expect(order()).toEqual(['increaseTime', 'mine']);
    expect(byMethod('increaseTime')[0]).toEqual({ seconds: 86400 });
    expect(byMethod('mine')[0]).toEqual({ blocks: 1 });
  });

  it('snapshot returns the id; revert passes it through', async () => {
    const snap = makeFakeClient({ snapshotId: '0x7' });
    expect(await snapshot(fakeCtx('csm', snap.client))).toBe('0x7');

    const rev = makeFakeClient();
    await revert(fakeCtx('csm', rev.client), '0x7');
    expect(rev.byMethod('revert')[0]).toEqual({ id: '0x7' });
  });
});
