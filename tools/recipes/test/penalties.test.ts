import { maxUint256, toHex } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  cancelPenalty,
  compensatePenalty,
  reportPenalty,
  settlePenalty,
} from '../src/recipes/penalties';
import {
  REPORT_GENERAL_DELAYED_PENALTY_ROLE,
  SETTLE_GENERAL_DELAYED_PENALTY_ROLE,
} from '../src/roles';
import { makeFakeClient } from './helpers/fake-client';
import { A, fakeCtx } from './helpers/book';

const REPORTER = A(0xe1);
const SETTLER = A(0xe2);
const MANAGER = A(0xb1);

describe('penalty recipes', () => {
  it('reportPenalty: reportGeneralDelayedPenalty as the reporter role member; defaults type+details', async () => {
    const fc = makeFakeClient({ reads: { getRoleMember: REPORTER } });
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01) });
    await reportPenalty(ctx, { noId: 3n, amount: 100n });
    const role = fc.byMethod('readContract')[0] as any;
    expect(role.functionName).toBe('getRoleMember');
    expect(role.args).toEqual([REPORT_GENERAL_DELAYED_PENALTY_ROLE, 0n]);
    const w = fc.byMethod('writeContract')[0] as any;
    expect(w.functionName).toBe('reportGeneralDelayedPenalty');
    expect(w.args).toEqual([3n, toHex(1n, { size: 32 }), 100n, 'fork-penalty']);
    expect(w.account).toBe(REPORTER);
  });

  it('cancelPenalty: cancelGeneralDelayedPenalty as the reporter role member', async () => {
    const fc = makeFakeClient({ reads: { getRoleMember: REPORTER } });
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01) });
    await cancelPenalty(ctx, { noId: 3n, amount: 40n });
    const w = fc.byMethod('writeContract')[0] as any;
    expect(w.functionName).toBe('cancelGeneralDelayedPenalty');
    expect(w.args).toEqual([3n, 40n]);
    expect(w.account).toBe(REPORTER);
  });

  it('settlePenalty: settleGeneralDelayedPenalty([noId],[max]) as the settler role member', async () => {
    const fc = makeFakeClient({ reads: { getRoleMember: SETTLER } });
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01) });
    await settlePenalty(ctx, { noId: 3n });
    const role = fc.byMethod('readContract')[0] as any;
    expect(role.args).toEqual([SETTLE_GENERAL_DELAYED_PENALTY_ROLE, 0n]);
    const w = fc.byMethod('writeContract')[0] as any;
    expect(w.functionName).toBe('settleGeneralDelayedPenalty');
    expect(w.args).toEqual([[3n], [maxUint256]]);
    expect(w.account).toBe(SETTLER);
  });

  it('compensatePenalty: compensateGeneralDelayedPenalty as the operator manager', async () => {
    const fc = makeFakeClient({ reads: { getNodeOperator: { managerAddress: MANAGER } } });
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01) });
    await compensatePenalty(ctx, { noId: 3n });
    const w = fc.byMethod('writeContract')[0] as any;
    expect(w.functionName).toBe('compensateGeneralDelayedPenalty');
    expect(w.args).toEqual([3n]);
    expect(w.account).toBe(MANAGER);
  });
});
