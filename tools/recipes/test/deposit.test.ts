import { describe, expect, it } from 'vitest';
import { deposit } from '../src/recipes/deposit';
import { makeFakeClient } from './helpers/fake-client';
import { A, fakeCtx } from './helpers/book';

// 2 pubkeys = 96 bytes = 192 hex chars after 0x
const TWO_PUBKEYS = `0x${'ab'.repeat(48 * 2)}` as const;

describe('deposit', () => {
  it('flushes, caps to depositable, deposits, and returns the count from returned pubkeys', async () => {
    const fc = makeFakeClient({
      reads: { getStakingModuleSummary: [0n, 10n, 5n] }, // depositable = 5
      simulate: { result: [TWO_PUBKEYS, '0x'], request: { __dep: true } },
    });
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01) });

    const res = await deposit(ctx, { count: 2 });
    expect(res.deposited).toBe(2n);

    // flush write happened
    const writes = fc.byMethod('writeContract') as any[];
    expect(writes.some((w) => w.functionName === 'batchDepositInfoUpdate')).toBe(true);
    // obtainDepositData simulated with the (capped) count + empty calldata, as the staking router
    const sim = fc.byMethod('simulateContract')[0] as any;
    expect(sim.functionName).toBe('obtainDepositData');
    expect(sim.args).toEqual([2n, '0x']);
    expect(sim.account).toBe(ctx.addresses.stakingRouter);
    // the create write reused the simulate request
    expect(writes.some((w) => w.__dep === true)).toBe(true);
    // impersonated the staking router
    expect(fc.byMethod('impersonateAccount')).toContainEqual({ address: ctx.addresses.stakingRouter });
  });

  it('caps the requested count to depositableValidatorsCount', async () => {
    const fc = makeFakeClient({
      reads: { getStakingModuleSummary: [0n, 10n, 1n] }, // depositable = 1
      simulate: { result: [`0x${'cd'.repeat(48)}`, '0x'], request: { __dep: true } }, // 1 pubkey
    });
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01) });
    const res = await deposit(ctx, { count: 9 });
    const sim = fc.byMethod('simulateContract')[0] as any;
    expect(sim.args).toEqual([1n, '0x']); // capped to 1
    expect(res.deposited).toBe(1n);
  });

  it('throws when a positive request has nothing depositable (silent no-op guard)', async () => {
    const fc = makeFakeClient({ reads: { getStakingModuleSummary: [0n, 10n, 0n] } });
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01) });
    await expect(deposit(ctx, { count: 3 })).rejects.toThrow(/nothing depositable|no depositable/i);
  });
});
