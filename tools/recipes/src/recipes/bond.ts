import { actAs } from '../act-as';
import { contract, type Ctx } from '../context';

/** Top up an operator's bond with ETH (permissionless `depositETH`), signed by the manager. */
export async function addBond(ctx: Ctx, opts: { noId: bigint; amount: bigint }): Promise<void> {
  const m = contract(ctx, 'module');
  const acc = contract(ctx, 'Accounting');
  const op = await ctx.client.readContract({
    ...m,
    functionName: 'getNodeOperator',
    args: [opts.noId],
  });
  await actAs(ctx, op.managerAddress, (from) =>
    ctx.client.writeContract({
      ...acc,
      functionName: 'depositETH',
      args: [opts.noId],
      account: from,
      value: opts.amount,
      chain: null,
    }),
  );
}

/**
 * Charge a penalty against an operator's bond (creating bond debt if uncovered). `Accounting.penalize`
 * is module-only, so we impersonate the module address. Returns whether the penalty was fully covered.
 */
export async function createBondDebt(
  ctx: Ctx,
  opts: { noId: bigint; amount: bigint },
): Promise<{ penaltyCovered: boolean }> {
  const moduleAddress = contract(ctx, 'module').address;
  const acc = contract(ctx, 'Accounting');
  return actAs(ctx, moduleAddress, async (from) => {
    const { result, request } = await ctx.client.simulateContract({
      ...acc,
      functionName: 'penalize',
      args: [opts.noId, opts.amount],
      account: from,
    });
    await ctx.client.writeContract({ ...request, chain: null });
    return { penaltyCovered: result };
  });
}
