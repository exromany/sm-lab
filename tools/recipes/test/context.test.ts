import { addresses } from '@csm-lab/receipts';
import { describe, expect, it } from 'vitest';
import { connect, resolveGate } from '../src/context';
import { makeFakeClient } from './helpers/fake-client';
import { A, csmBook, fakeCtx } from './helpers/book';

const LOCATOR_READS = {
  stakingRouter: A(0xa1),
  validatorsExitBusOracle: A(0xa2),
  lido: A(0xa3),
  withdrawalQueue: A(0xa4),
  burner: A(0xa5),
};

describe('connect', () => {
  it('resolves protocol addresses from LidoLocator and merges the injected snapshot', async () => {
    const { client, byMethod } = makeFakeClient({ chainId: 560048, reads: LOCATOR_READS });
    const ctx = await connect({ module: 'csm', client, addresses: csmBook() });

    expect(ctx.module).toBe('csm');
    expect(ctx.addresses.CSModule).toBe(A(0x01)); // from the snapshot
    expect(ctx.addresses.stakingRouter).toBe(A(0xa1)); // locator-resolved
    expect(ctx.addresses.vebo).toBe(A(0xa2));
    expect(ctx.addresses.lido).toBe(A(0xa3));
    expect(ctx.addresses.withdrawalQueue).toBe(A(0xa4));
    expect(ctx.addresses.burner).toBe(A(0xa5));
    expect(byMethod('readContract')).toHaveLength(5); // exactly the 5 locator getters
  });

  it('falls back to the default @csm-lab/receipts snapshot by chainId', async () => {
    const { client } = makeFakeClient({ chainId: 560048, reads: LOCATOR_READS });
    const ctx = await connect({ module: 'csm', client });
    expect(ctx.addresses.CSModule).toBe(addresses.hoodi.csm.CSModule);
  });

  it('throws when no chainId match exists in the default snapshot', async () => {
    const { client } = makeFakeClient({ chainId: 999999, reads: LOCATOR_READS });
    await expect(connect({ module: 'csm', client })).rejects.toThrow(/no default snapshot/);
  });
});

describe('resolveGate', () => {
  it('maps the csm ics selector to VettedGate and rejects idvtc/unknown', () => {
    const ctx = fakeCtx('csm', makeFakeClient().client, { VettedGate: A(0xd1) });
    expect(resolveGate(ctx, 'ics')).toBe(A(0xd1));
    expect(() => resolveGate(ctx, 'idvtc')).toThrow(/6f/);
    expect(() => resolveGate(ctx, 'bogus')).toThrow(/unknown/);
  });

  it('maps cm selectors and numeric indices to CuratedGates', () => {
    const ctx = fakeCtx('cm', makeFakeClient().client, { CuratedGates: [A(0x30), A(0x31)] });
    expect(resolveGate(ctx, 'po')).toBe(A(0x30));
    expect(resolveGate(ctx, 'pto')).toBe(A(0x31));
    expect(resolveGate(ctx, '1')).toBe(A(0x31));
    expect(() => resolveGate(ctx, '5')).toThrow(/out of range/);
  });
});
