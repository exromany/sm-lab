import { size } from 'viem';
import type { Hex } from '@csm-lab/receipts';
import { contract, type Ctx } from '../context';

/** One key's 48-byte pubkey from on-chain storage. Throws if no key exists at `keyIndex`. */
export async function getPubkey(ctx: Ctx, opts: { noId: bigint; keyIndex: bigint }): Promise<Hex> {
  const m = contract(ctx, 'module');
  const keys = (await ctx.client.readContract({
    ...m,
    functionName: 'getSigningKeys',
    args: [opts.noId, opts.keyIndex, 1n],
  })) as Hex;
  // count=1 → a single packed 48-byte pubkey; no per-48 slice needed. Guard `undefined`
  // (unscripted fake reads) before `size()` so it throws the clean error, not a viem internal.
  if (!keys || size(keys) !== 48) {
    throw new Error(
      `@csm-lab/recipes: no key found for operator ${opts.noId} at index ${opts.keyIndex}`,
    );
  }
  return keys;
}

/** Allocated balance (wei) for one key. */
export async function getKeyBalance(
  ctx: Ctx,
  opts: { noId: bigint; keyIndex: bigint },
): Promise<bigint> {
  const m = contract(ctx, 'module');
  const balances = (await ctx.client.readContract({
    ...m,
    functionName: 'getKeyAllocatedBalances',
    args: [opts.noId, opts.keyIndex, 1n],
  })) as readonly bigint[];
  const wei = balances[0]; // noUncheckedIndexedAccess: guard
  if (wei === undefined) {
    throw new Error(
      `@csm-lab/recipes: no allocated balance for operator ${opts.noId} at index ${opts.keyIndex}`,
    );
  }
  return wei;
}
