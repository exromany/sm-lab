import { describe, expect, it } from 'vitest';
import { activateKeys, reportBalance, slash, withdraw } from '../src/recipes/validators';
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

describe('activateKeys', () => {
  it('reports 32 ETH + 1 gwei for the first N eligible keys as the Verifier', async () => {
    const fc = makeFakeClient({
      reads: {
        getNodeOperator: { totalDepositedKeys: 3 },
        getKeyConfirmedBalances: [0n], // every key unconfirmed
        isValidatorWithdrawn: false,
      },
    });
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01) });

    const res = await activateKeys(ctx, { noId: 1n, count: 2 });

    expect(res).toEqual({ activated: 2 });
    const writes = fc.byMethod('writeContract') as any[];
    expect(writes).toHaveLength(2);
    expect(writes[0].functionName).toBe('reportValidatorBalance');
    expect(writes[0].args).toEqual([1n, 0n, 32n * 10n ** 18n + 10n ** 9n]);
    expect(writes[1].args).toEqual([1n, 1n, 32n * 10n ** 18n + 10n ** 9n]);
    expect(writes[0].account).toBe(ctx.addresses.Verifier);
  });

  it('throws when fewer keys are activatable than requested', async () => {
    const fc = makeFakeClient({
      reads: {
        getNodeOperator: { totalDepositedKeys: 1 },
        getKeyConfirmedBalances: [0n],
        isValidatorWithdrawn: false,
      },
    });
    const ctx = fakeCtx('csm', fc.client);
    await expect(activateKeys(ctx, { noId: 0n, count: 2 })).rejects.toThrow(/only 1 activatable/);
  });

  it('skips already-confirmed keys', async () => {
    const fc = makeFakeClient({
      reads: {
        getNodeOperator: { totalDepositedKeys: 2 },
        getKeyConfirmedBalances: (args: any) => (args[1] === 0n ? [5n] : [0n]), // key 0 already active
        isValidatorWithdrawn: false,
      },
    });
    const ctx = fakeCtx('csm', fc.client);
    const res = await activateKeys(ctx, { noId: 0n, count: 1 });
    expect(res.activated).toBe(1);
    const w = (fc.byMethod('writeContract') as any[])[0];
    expect(w.args[1]).toBe(1n); // key 1, not key 0
  });
});

describe('reportBalance', () => {
  it('reports the given wei balance for a key as the Verifier', async () => {
    const fc = makeFakeClient({
      reads: { getNodeOperator: { totalDepositedKeys: 3 }, isValidatorWithdrawn: false },
    });
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01) });
    const res = await reportBalance(ctx, { noId: 1n, keyIndex: 2n, balanceWei: 31n * 10n ** 18n });
    const w = (fc.byMethod('writeContract') as any[])[0];
    expect(w.functionName).toBe('reportValidatorBalance');
    expect(w.args).toEqual([1n, 2n, 31n * 10n ** 18n]);
    expect(w.account).toBe(ctx.addresses.Verifier);
    expect(res.balanceWei).toBe(31n * 10n ** 18n);
  });

  it('throws when the key index is out of bounds', async () => {
    const fc = makeFakeClient({ reads: { getNodeOperator: { totalDepositedKeys: 1 } } });
    const ctx = fakeCtx('csm', fc.client);
    await expect(reportBalance(ctx, { noId: 0n, keyIndex: 5n, balanceWei: 1n })).rejects.toThrow(
      /out of bounds/,
    );
  });

  it('throws when the key is withdrawn', async () => {
    const fc = makeFakeClient({
      reads: { getNodeOperator: { totalDepositedKeys: 3 }, isValidatorWithdrawn: true },
    });
    const ctx = fakeCtx('csm', fc.client);
    await expect(reportBalance(ctx, { noId: 0n, keyIndex: 0n, balanceWei: 1n })).rejects.toThrow(
      /withdrawn/,
    );
  });
});
