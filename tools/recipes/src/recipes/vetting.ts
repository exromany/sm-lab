import type { Hex } from '@sm-lab/receipts';
import { actAs } from '../act-as';
import { contract, type Ctx } from '../context';
import { keyCountBytes, nodeOperatorIdBytes } from '../encode';

/** Set an operator's vetted-keys count (StakingRouter-gated). `vettedKeys` is the new absolute count. */
export async function unvet(ctx: Ctx, opts: { noId: bigint; vettedKeys: bigint }): Promise<void> {
  const m = contract(ctx, 'module');
  await actAs(ctx, ctx.addresses.stakingRouter, (from) =>
    ctx.client.writeContract({
      ...m,
      functionName: 'decreaseVettedSigningKeysCount',
      args: [nodeOperatorIdBytes(opts.noId), keyCountBytes(opts.vettedKeys)],
      account: from,
      chain: null,
    }),
  );
}

/** Set an operator's exited-keys count (StakingRouter-gated). `exitedKeys` is the new absolute total. */
export async function exit(ctx: Ctx, opts: { noId: bigint; exitedKeys: bigint }): Promise<void> {
  const m = contract(ctx, 'module');
  await actAs(ctx, ctx.addresses.stakingRouter, (from) =>
    ctx.client.writeContract({
      ...m,
      functionName: 'updateExitedValidatorsCount',
      args: [nodeOperatorIdBytes(opts.noId), keyCountBytes(opts.exitedKeys)],
      account: from,
      chain: null,
    }),
  );
}

/** Remove `count` keys (default 1) from operator `noId` starting at `keyIndex`, as the operator's manager. */
export async function removeKey(
  ctx: Ctx,
  opts: { noId: bigint; keyIndex: bigint; count?: bigint },
): Promise<{ noId: bigint; keyIndex: bigint; count: bigint }> {
  const count = opts.count ?? 1n;
  const m = contract(ctx, 'module');
  const op = await ctx.client.readContract({
    ...m,
    functionName: 'getNodeOperator',
    args: [opts.noId],
  });
  const manager = (op as { managerAddress: Hex }).managerAddress;
  await actAs(ctx, manager, (from) =>
    ctx.client.writeContract({
      ...m,
      functionName: 'removeKeys',
      args: [opts.noId, opts.keyIndex, count],
      account: from,
      chain: null,
    }),
  );
  return { noId: opts.noId, keyIndex: opts.keyIndex, count };
}
