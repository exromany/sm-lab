import { maxUint256, size } from 'viem';
import { actAs } from '../act-as';
import { contract, type Ctx } from '../context';

/**
 * Deposit up to `count` of an operator's depositable keys (StakingRouter-gated). Flushes pending
 * deposit-info, caps to the module's depositable count, and returns the number actually deposited
 * (derived from the keys `obtainDepositData` hands back). Throws if a positive request finds nothing
 * depositable — the Solidity helper silently no-ops there. (Port of `NodeOperators.deposit`.)
 */
export async function deposit(
  ctx: Ctx,
  opts: { count: number | bigint },
): Promise<{ deposited: bigint }> {
  const m = contract(ctx, 'module');
  const requested = BigInt(opts.count);

  return actAs(ctx, ctx.addresses.stakingRouter, async (from) => {
    await ctx.client.writeContract({
      ...m,
      functionName: 'batchDepositInfoUpdate',
      args: [maxUint256],
      account: from,
      chain: null,
    });

    const summary = await ctx.client.readContract({
      ...m,
      functionName: 'getStakingModuleSummary',
    });
    const [, , depositable] = summary as [bigint, bigint, bigint];
    const capped = requested < depositable ? requested : depositable;
    if (requested > 0n && capped === 0n) {
      throw new Error('@csm-lab/recipes: deposit found nothing depositable for this module');
    }

    const { result, request } = await ctx.client.simulateContract({
      ...m,
      functionName: 'obtainDepositData',
      args: [capped, '0x'],
      account: from,
    });
    await ctx.client.writeContract({ ...request, chain: null });

    const [pubkeys] = result as [string, string];
    return { deposited: BigInt(size(pubkeys as `0x${string}`) / 48) };
  });
}
