import type { Hex } from '@csm-lab/receipts';
import { actAs } from '../act-as';
import { contract, type Ctx } from '../context';

/** Propose a new manager address for an operator (signed by the current manager). */
export async function proposeManager(ctx: Ctx, opts: { noId: bigint; proposed: Hex }): Promise<void> {
  const m = contract(ctx, 'module');
  const op = await ctx.client.readContract({ ...m, functionName: 'getNodeOperator', args: [opts.noId] });
  await actAs(ctx, op.managerAddress, (from) =>
    ctx.client.writeContract({
      ...m,
      functionName: 'proposeNodeOperatorManagerAddressChange',
      args: [opts.noId, opts.proposed],
      account: from,
      chain: null,
    }),
  );
}

/** Confirm the proposed manager address (signed by the proposed manager). */
export async function confirmManager(ctx: Ctx, opts: { noId: bigint }): Promise<void> {
  const m = contract(ctx, 'module');
  const op = await ctx.client.readContract({ ...m, functionName: 'getNodeOperator', args: [opts.noId] });
  await actAs(ctx, op.proposedManagerAddress, (from) =>
    ctx.client.writeContract({
      ...m,
      functionName: 'confirmNodeOperatorManagerAddressChange',
      args: [opts.noId],
      account: from,
      chain: null,
    }),
  );
}

/** Propose a new reward address (signed by the MANAGER, per the on-chain access rule). */
export async function proposeReward(ctx: Ctx, opts: { noId: bigint; proposed: Hex }): Promise<void> {
  const m = contract(ctx, 'module');
  const op = await ctx.client.readContract({ ...m, functionName: 'getNodeOperator', args: [opts.noId] });
  await actAs(ctx, op.managerAddress, (from) =>
    ctx.client.writeContract({
      ...m,
      functionName: 'proposeNodeOperatorRewardAddressChange',
      args: [opts.noId, opts.proposed],
      account: from,
      chain: null,
    }),
  );
}

/** Confirm the proposed reward address (signed by the proposed reward address). */
export async function confirmReward(ctx: Ctx, opts: { noId: bigint }): Promise<void> {
  const m = contract(ctx, 'module');
  const op = await ctx.client.readContract({ ...m, functionName: 'getNodeOperator', args: [opts.noId] });
  await actAs(ctx, op.proposedRewardAddress, (from) =>
    ctx.client.writeContract({
      ...m,
      functionName: 'confirmNodeOperatorRewardAddressChange',
      args: [opts.noId],
      account: from,
      chain: null,
    }),
  );
}
