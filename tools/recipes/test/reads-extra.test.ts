import { describe, expect, it } from 'vitest';
import {
  bondInfo,
  operatorKeys,
  keyBalances,
  operatorsCount,
  getLastOperator,
  getGateTree,
} from '../src/recipes/reads';
import { makeFakeClient } from './helpers/fake-client';
import { A, fakeCtx } from './helpers/book';

describe('bondInfo', () => {
  it('reads getNodeOperatorBondInfo on Accounting', async () => {
    const info = {
      currentBond: 1n,
      requiredBond: 2n,
      lockedBond: 3n,
      bondDebt: 4n,
      pendingSharesToSplit: 5n,
    };
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
