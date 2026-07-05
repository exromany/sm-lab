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
    await expect(setTargetLimit(ctx, { noId: 1n, mode: 3 })).rejects.toThrow(
      /mode must be 0, 1, or 2/,
    );
  });
});
