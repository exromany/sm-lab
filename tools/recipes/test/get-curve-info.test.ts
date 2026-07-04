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
