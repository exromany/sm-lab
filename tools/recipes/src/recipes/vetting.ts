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
