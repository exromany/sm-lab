import { describe, expect, it } from 'vitest';
import { addBond, createBondDebt } from '../src/recipes/bond';
import { makeFakeClient } from './helpers/fake-client';
import { A, fakeCtx } from './helpers/book';

const MANAGER = A(0xb1);

describe('bond recipes', () => {
  it('addBond: Accounting.depositETH(noId) payable, as the manager', async () => {
    const fc = makeFakeClient({ reads: { getNodeOperator: { managerAddress: MANAGER } } });
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01), Accounting: A(0x02) });
    await addBond(ctx, { noId: 5n, amount: 1_000n });
    const w = fc.byMethod('writeContract')[0] as any;
    expect(w.functionName).toBe('depositETH');
    expect(w.address).toBe(A(0x02));
    expect(w.args).toEqual([5n]);
    expect(w.value).toBe(1_000n);
    expect(w.account).toBe(MANAGER);
  });

  it('createBondDebt: Accounting.penalize(noId, amount) impersonating the module; returns penaltyCovered', async () => {
    const fc = makeFakeClient({ simulate: { result: true, request: { __pen: true } } });
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01), Accounting: A(0x02) });
    const res = await createBondDebt(ctx, { noId: 5n, amount: 9n });
    expect(res.penaltyCovered).toBe(true);
    const sim = fc.byMethod('simulateContract')[0] as any;
    expect(sim.functionName).toBe('penalize');
    expect(sim.address).toBe(A(0x02)); // Accounting
    expect(sim.args).toEqual([5n, 9n]);
    expect(sim.account).toBe(A(0x01)); // impersonating the module
    const writes = fc.byMethod('writeContract') as any[];
    expect(writes.some((w) => w.__pen === true)).toBe(true);
    expect(fc.byMethod('impersonateAccount')[0]).toEqual({ address: A(0x01) });
  });
});
