import { describe, expect, it } from 'vitest';
import { slash, withdraw } from '../src/recipes/validators';
import { makeFakeClient } from './helpers/fake-client';
import { A, fakeCtx } from './helpers/book';

describe('validator-report recipes', () => {
  it('slash: reportValidatorSlashing(noId, keyIndex) as the verifier', async () => {
    const fc = makeFakeClient();
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01), Verifier: A(0x08) });
    await slash(ctx, { noId: 4n, keyIndex: 2n });
    const w = fc.byMethod('writeContract')[0] as any;
    expect(w.functionName).toBe('reportValidatorSlashing');
    expect(w.args).toEqual([4n, 2n]);
    expect(w.account).toBe(A(0x08));
    expect(fc.byMethod('impersonateAccount')[0]).toEqual({ address: A(0x08) });
  });

  it('withdraw: reportRegularWithdrawnValidators([info]) as the verifier; isSlashed = penalty>0', async () => {
    const fc = makeFakeClient();
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01), Verifier: A(0x08) });
    await withdraw(ctx, {
      noId: 4n,
      keyIndex: 2n,
      exitBalance: 32_000_000_000n,
      slashingPenalty: 1_000_000n,
    });
    const w = fc.byMethod('writeContract')[0] as any;
    expect(w.functionName).toBe('reportRegularWithdrawnValidators');
    expect(w.args).toEqual([
      [
        {
          nodeOperatorId: 4n,
          keyIndex: 2n,
          exitBalance: 32_000_000_000n,
          slashingPenalty: 1_000_000n,
          isSlashed: true,
        },
      ],
    ]);
    expect(w.account).toBe(A(0x08));
  });

  it('withdraw: isSlashed is false when slashingPenalty omitted', async () => {
    const fc = makeFakeClient();
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01), Verifier: A(0x08) });
    await withdraw(ctx, { noId: 1n, keyIndex: 0n, exitBalance: 32_000_000_000n });
    const w = fc.byMethod('writeContract')[0] as any;
    expect(w.args[0][0].isSlashed).toBe(false);
    expect(w.args[0][0].slashingPenalty).toBe(0n);
  });
});
