import type { Hex } from '@csm-lab/receipts';
import type { Ctx } from '../context';

/** Advance fork time by `seconds` and mine a block (evm_increaseTime + evm_mine). */
export async function warpBy(ctx: Ctx, seconds: number | bigint): Promise<void> {
  await ctx.client.increaseTime({ seconds: Number(seconds) });
  await ctx.client.mine({ blocks: 1 });
}

/** Take an anvil state snapshot; returns the snapshot id (evm_snapshot). */
export function snapshot(ctx: Ctx): Promise<Hex> {
  return ctx.client.snapshot();
}

/** Revert the fork to a snapshot id (evm_revert). */
export async function revert(ctx: Ctx, id: Hex): Promise<void> {
  await ctx.client.revert({ id });
}
