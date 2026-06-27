import { parseEther } from 'viem';
import { describe, expect, it } from 'vitest';
import { actAs } from '../src/act-as';
import { makeFakeClient } from './helpers/fake-client';
import { A, fakeCtx } from './helpers/book';

const WHO = A(0x99);

describe('actAs', () => {
  it('funds, impersonates, runs fn, then stops — in that order', async () => {
    const { client, order, byMethod } = makeFakeClient();
    const out = await actAs(fakeCtx('csm', client), WHO, async (from) => {
      expect(from).toBe(WHO);
      return 'done';
    });
    expect(out).toBe('done');
    expect(order()).toEqual(['setBalance', 'impersonateAccount', 'stopImpersonatingAccount']);
    expect(byMethod('setBalance')[0]).toEqual({ address: WHO, value: parseEther('100') });
    expect(byMethod('impersonateAccount')[0]).toEqual({ address: WHO });
    expect(byMethod('stopImpersonatingAccount')[0]).toEqual({ address: WHO });
  });

  it('stops impersonating even when fn throws', async () => {
    const { client, order } = makeFakeClient();
    await expect(
      actAs(fakeCtx('csm', client), WHO, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(order()).toEqual(['setBalance', 'impersonateAccount', 'stopImpersonatingAccount']);
  });
});
