import { actAs } from '../act-as';
import { contract, type Ctx } from '../context';

export interface SetTargetLimitOptions {
  noId: bigint;
  /** 0 = off, 1 = soft, 2 = forced. */
  mode: number;
  /** Target validator limit; ignored (forced to 0) when mode === 0. Defaults to 0. */
  limit?: bigint;
}

export interface SetTargetLimitResult {
  noId: bigint;
  mode: number;
  limit: bigint;
}

/**
 * Set an operator's target validator limit (StakingRouter-gated). Port of
 * `NodeOperators.targetLimit` → `updateTargetValidatorsLimits(noId, mode, limit)`.
 */
export async function setTargetLimit(
  ctx: Ctx,
  opts: SetTargetLimitOptions,
): Promise<SetTargetLimitResult> {
  if (opts.mode !== 0 && opts.mode !== 1 && opts.mode !== 2) {
    throw new Error(`@sm-lab/recipes: target limit mode must be 0, 1, or 2 (got ${opts.mode})`);
  }
  const limit = opts.mode === 0 ? 0n : (opts.limit ?? 0n);
  const m = contract(ctx, 'module');
  await actAs(ctx, ctx.addresses.stakingRouter, (from) =>
    ctx.client.writeContract({
      ...m,
      functionName: 'updateTargetValidatorsLimits',
      args: [opts.noId, BigInt(opts.mode), limit],
      account: from,
      chain: null,
    }),
  );
  return { noId: opts.noId, mode: opts.mode, limit };
}
