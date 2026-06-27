import { maxUint256, toHex } from 'viem';
import type { Hex } from '@csm-lab/receipts';
import { actAs, roleMember } from '../act-as';
import { contract, type Ctx } from '../context';
import { REPORT_GENERAL_DELAYED_PENALTY_ROLE, SETTLE_GENERAL_DELAYED_PENALTY_ROLE } from '../roles';

/** Report a general delayed penalty against an operator (penalty-reporter role). */
export async function reportPenalty(
  ctx: Ctx,
  opts: { noId: bigint; amount: bigint; penaltyType?: Hex; details?: string },
): Promise<void> {
  const m = contract(ctx, 'module');
  const reporter = await roleMember(ctx, m, REPORT_GENERAL_DELAYED_PENALTY_ROLE);
  const penaltyType = opts.penaltyType ?? toHex(1n, { size: 32 });
  const details = opts.details ?? 'fork-penalty';
  await actAs(ctx, reporter, (from) =>
    ctx.client.writeContract({
      ...m,
      functionName: 'reportGeneralDelayedPenalty',
      args: [opts.noId, penaltyType, opts.amount, details],
      account: from,
      chain: null,
    }),
  );
}

/** Cancel a previously-reported general delayed penalty (penalty-reporter role). */
export async function cancelPenalty(
  ctx: Ctx,
  opts: { noId: bigint; amount: bigint },
): Promise<void> {
  const m = contract(ctx, 'module');
  const reporter = await roleMember(ctx, m, REPORT_GENERAL_DELAYED_PENALTY_ROLE);
  await actAs(ctx, reporter, (from) =>
    ctx.client.writeContract({
      ...m,
      functionName: 'cancelGeneralDelayedPenalty',
      args: [opts.noId, opts.amount],
      account: from,
      chain: null,
    }),
  );
}

/** Settle (process) an operator's general delayed penalty (penalty-settler role). */
export async function settlePenalty(
  ctx: Ctx,
  opts: { noId: bigint; maxAmount?: bigint },
): Promise<void> {
  const m = contract(ctx, 'module');
  const settler = await roleMember(ctx, m, SETTLE_GENERAL_DELAYED_PENALTY_ROLE);
  await actAs(ctx, settler, (from) =>
    ctx.client.writeContract({
      ...m,
      functionName: 'settleGeneralDelayedPenalty',
      args: [[opts.noId], [opts.maxAmount ?? maxUint256]],
      account: from,
      chain: null,
    }),
  );
}

/** Compensate (pay off) an operator's general delayed penalty — signed by the operator manager. */
export async function compensatePenalty(ctx: Ctx, opts: { noId: bigint }): Promise<void> {
  const m = contract(ctx, 'module');
  const op = await ctx.client.readContract({
    ...m,
    functionName: 'getNodeOperator',
    args: [opts.noId],
  });
  await actAs(ctx, op.managerAddress, (from) =>
    ctx.client.writeContract({
      ...m,
      functionName: 'compensateGeneralDelayedPenalty',
      args: [opts.noId],
      account: from,
      chain: null,
    }),
  );
}
