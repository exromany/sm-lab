import { describe, expect, it } from 'vitest';
import { topUpAccount } from '../src/recipes/chain';
import { makeFakeClient } from './helpers/fake-client';
import { A, fakeCtx } from './helpers/book';

describe('topUpAccount', () => {
  it('sets the balance via setBalance and returns it', async () => {
    const fc = makeFakeClient();
    const ctx = fakeCtx('csm', fc.client);
    const res = await topUpAccount(ctx, { address: A(0xab), amountWei: 5n * 10n ** 18n });
    expect(fc.byMethod('setBalance')[0]).toEqual({ address: A(0xab), value: 5n * 10n ** 18n });
    expect(res).toEqual({ address: A(0xab), amountWei: 5n * 10n ** 18n });
  });

  it('defaults to 100 ETH when amount is omitted', async () => {
    const fc = makeFakeClient();
    const ctx = fakeCtx('csm', fc.client);
    const res = await topUpAccount(ctx, { address: A(0xab) });
    expect(res.amountWei).toBe(100n * 10n ** 18n);
    expect((fc.byMethod('setBalance')[0] as any).value).toBe(100n * 10n ** 18n);
  });
});
