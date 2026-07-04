import { maxUint256 } from 'viem';
import { describe, expect, it } from 'vitest';
import { pause, resume } from '../src/recipes/pause';
import { PAUSE_ROLE, RESUME_ROLE } from '../src/roles';
import { makeFakeClient } from './helpers/fake-client';
import { A, fakeCtx } from './helpers/book';

const ADMIN = A(0xd0);

describe('pause', () => {
  it('module (csm): grants PAUSE_ROLE + pauseFor(max) as admin on CSModule', async () => {
    const fc = makeFakeClient({ reads: { isPaused: false, getRoleMember: ADMIN } });
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01) });

    const res = await pause(ctx, { target: 'module' });

    const writes = fc.byMethod('writeContract') as any[];
    expect(writes[0].functionName).toBe('grantRole');
    expect(writes[0].args).toEqual([PAUSE_ROLE, ADMIN]);
    expect(writes[0].address).toBe(A(0x01));
    expect(writes[1].functionName).toBe('pauseFor');
    expect(writes[1].args).toEqual([maxUint256]);
    expect(writes[1].account).toBe(ADMIN);
    expect(res).toEqual({ target: 'module', address: A(0x01), paused: true });
  });

  it('module (cm): resolves the CuratedModule address', async () => {
    const fc = makeFakeClient({ reads: { isPaused: false, getRoleMember: ADMIN } });
    const ctx = fakeCtx('cm', fc.client, { CuratedModule: A(0x21) });
    const res = await pause(ctx, { target: 'module' });
    expect(res.address).toBe(A(0x21));
    expect((fc.byMethod('writeContract')[0] as any).address).toBe(A(0x21));
  });

  it('accounting: targets the Accounting address', async () => {
    const fc = makeFakeClient({ reads: { isPaused: false, getRoleMember: ADMIN } });
    const ctx = fakeCtx('csm', fc.client, { Accounting: A(0x02) });
    const res = await pause(ctx, { target: 'accounting' });
    expect(res.address).toBe(A(0x02));
    expect((fc.byMethod('writeContract')[0] as any).address).toBe(A(0x02));
  });

  it('gate (csm ics → VettedGate)', async () => {
    const fc = makeFakeClient({ reads: { isPaused: false, getRoleMember: ADMIN } });
    const ctx = fakeCtx('csm', fc.client, { VettedGate: A(0x0d) });
    const res = await pause(ctx, { target: 'ics' });
    expect(res.address).toBe(A(0x0d));
  });

  it('gate (cm po → CuratedGates[0])', async () => {
    const fc = makeFakeClient({ reads: { isPaused: false, getRoleMember: ADMIN } });
    const ctx = fakeCtx('cm', fc.client);
    const res = await pause(ctx, { target: 'po' });
    expect(res.address).toBe(A(0x30));
  });

  it('is idempotent: no writes when already paused', async () => {
    const fc = makeFakeClient({ reads: { isPaused: true, getRoleMember: ADMIN } });
    const ctx = fakeCtx('csm', fc.client);
    const res = await pause(ctx, { target: 'module' });
    expect(fc.byMethod('writeContract')).toHaveLength(0);
    expect(res.paused).toBe(true);
  });
});

describe('resume', () => {
  it('grants RESUME_ROLE + resume() as admin when paused', async () => {
    const fc = makeFakeClient({ reads: { isPaused: true, getRoleMember: ADMIN } });
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01) });

    const res = await resume(ctx, { target: 'module' });

    const writes = fc.byMethod('writeContract') as any[];
    expect(writes[0].functionName).toBe('grantRole');
    expect(writes[0].args).toEqual([RESUME_ROLE, ADMIN]);
    expect(writes[1].functionName).toBe('resume');
    expect(writes[1].account).toBe(ADMIN);
    expect(res).toEqual({ target: 'module', address: A(0x01), paused: false });
  });

  it('is idempotent: no writes when not paused', async () => {
    const fc = makeFakeClient({ reads: { isPaused: false, getRoleMember: ADMIN } });
    const ctx = fakeCtx('csm', fc.client);
    const res = await resume(ctx, { target: 'module' });
    expect(fc.byMethod('writeContract')).toHaveLength(0);
    expect(res.paused).toBe(false);
  });
});
