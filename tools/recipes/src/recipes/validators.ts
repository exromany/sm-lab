import { actAs } from '../act-as';
import { contract, type Ctx } from '../context';

/** One withdrawn-validator record for `reportRegularWithdrawnValidators`. */
export interface WithdrawnValidatorInfo {
  nodeOperatorId: bigint;
  keyIndex: bigint;
  exitBalance: bigint;
  slashingPenalty: bigint;
  isSlashed: boolean;
}

/** Report a validator slashing for an operator's key (Verifier-gated). `keyIndex` is the storage index. */
export async function slash(ctx: Ctx, opts: { noId: bigint; keyIndex: bigint }): Promise<void> {
  const m = contract(ctx, 'module');
  await actAs(ctx, ctx.addresses.Verifier, (from) =>
    ctx.client.writeContract({
      ...m,
      functionName: 'reportValidatorSlashing',
      args: [opts.noId, opts.keyIndex],
      account: from,
      chain: null,
    }),
  );
}

/** Report a regular validator withdrawal for one key (Verifier-gated). isSlashed = slashingPenalty > 0. */
export async function withdraw(
  ctx: Ctx,
  opts: { noId: bigint; keyIndex: bigint; exitBalance: bigint; slashingPenalty?: bigint },
): Promise<void> {
  const m = contract(ctx, 'module');
  const slashingPenalty = opts.slashingPenalty ?? 0n;
  const info: WithdrawnValidatorInfo = {
    nodeOperatorId: opts.noId,
    keyIndex: opts.keyIndex,
    exitBalance: opts.exitBalance,
    slashingPenalty,
    isSlashed: slashingPenalty > 0n,
  };
  await actAs(ctx, ctx.addresses.Verifier, (from) =>
    ctx.client.writeContract({
      ...m,
      functionName: 'reportRegularWithdrawnValidators',
      args: [[info]],
      account: from,
      chain: null,
    }),
  );
}
