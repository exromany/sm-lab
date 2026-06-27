import type { Hex } from '@csm-lab/receipts';
import type { Ctx } from '../context';

/** Advance fork time by `seconds` and mine a block (evm_increaseTime + evm_mine). */
export async function warpBy(ctx: Ctx, seconds: number | bigint): Promise<void> {
  await ctx.client.increaseTime({ seconds: Number(seconds) });
  await ctx.client.mine({ blocks: 1 });
}

/**
 * Warp fork time to an absolute unix timestamp and mine a block
 * (evm_setNextBlockTimestamp + evm_mine). The absolute counterpart of `warpBy` — used by
 * `submitRewards`'s consensus-frame wait. Over RPC, `setNextBlockTimestamp` + `mine` reproduces
 * Foundry's `vm.warp(ts)` (the post-warp `block.timestamp` settles automatically after mining).
 */
export async function warpTo(ctx: Ctx, timestamp: number | bigint): Promise<void> {
  await ctx.client.setNextBlockTimestamp({ timestamp: BigInt(timestamp) });
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
