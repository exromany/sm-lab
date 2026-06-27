import { describe, expect, it } from 'vitest';
import {
  confirmManager,
  confirmReward,
  proposeManager,
  proposeReward,
} from '../src/recipes/address-changes';
import { makeFakeClient } from './helpers/fake-client';
import { A, fakeCtx } from './helpers/book';

const NODE_OP = {
  managerAddress: A(0xb1),
  proposedManagerAddress: A(0xb2),
  rewardAddress: A(0xb3),
  proposedRewardAddress: A(0xb4),
};

function ctxWithOp() {
  const fc = makeFakeClient({ reads: { getNodeOperator: NODE_OP } });
  return { ...fc, ctx: fakeCtx('csm', fc.client, { CSModule: A(0x01) }) };
}

describe('address-change recipes', () => {
  it('proposeManager: writes proposeNodeOperatorManagerAddressChange as the manager', async () => {
    const { ctx, byMethod, order } = ctxWithOp();
    await proposeManager(ctx, { noId: 7n, proposed: A(0xcc) });
    const w = byMethod('writeContract')[0] as any;
    expect(w.functionName).toBe('proposeNodeOperatorManagerAddressChange');
    expect(w.args).toEqual([7n, A(0xcc)]);
    expect(w.account).toBe(NODE_OP.managerAddress);
    expect(byMethod('impersonateAccount')[0]).toEqual({ address: NODE_OP.managerAddress });
    expect(order().indexOf('impersonateAccount')).toBeLessThan(order().indexOf('writeContract'));
    expect(order().indexOf('writeContract')).toBeLessThan(
      order().indexOf('stopImpersonatingAccount'),
    );
  });

  it('confirmManager: writes confirm… as the proposed manager', async () => {
    const { ctx, byMethod } = ctxWithOp();
    await confirmManager(ctx, { noId: 7n });
    const w = byMethod('writeContract')[0] as any;
    expect(w.functionName).toBe('confirmNodeOperatorManagerAddressChange');
    expect(w.args).toEqual([7n]);
    expect(w.account).toBe(NODE_OP.proposedManagerAddress);
  });

  it('proposeReward: writes propose…RewardAddressChange as the MANAGER (not reward)', async () => {
    const { ctx, byMethod } = ctxWithOp();
    await proposeReward(ctx, { noId: 7n, proposed: A(0xdd) });
    const w = byMethod('writeContract')[0] as any;
    expect(w.functionName).toBe('proposeNodeOperatorRewardAddressChange');
    expect(w.args).toEqual([7n, A(0xdd)]);
    expect(w.account).toBe(NODE_OP.managerAddress);
  });

  it('confirmReward: writes confirm…RewardAddressChange as the proposed reward', async () => {
    const { ctx, byMethod } = ctxWithOp();
    await confirmReward(ctx, { noId: 7n });
    const w = byMethod('writeContract')[0] as any;
    expect(w.functionName).toBe('confirmNodeOperatorRewardAddressChange');
    expect(w.args).toEqual([7n]);
    expect(w.account).toBe(NODE_OP.proposedRewardAddress);
  });
});
