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

/** Effective balance the source reports to mark a key active: 32 ETH + 1 gwei. */
const ACTIVE_BALANCE = 32n * 10n ** 18n + 10n ** 9n;

/**
 * Activate `count` deposited-but-not-yet-active keys of an operator (Verifier-gated) by reporting
 * an effective balance of 32 ETH + 1 gwei on each. Skips keys that already have a confirmed
 * balance or are withdrawn. Port of `NodeOperators.activateKeys`. Returns the count activated.
 */
export async function activateKeys(
  ctx: Ctx,
  opts: { noId: bigint; count: number },
): Promise<{ activated: number }> {
  const m = contract(ctx, 'module');
  const { noId, count } = opts;

  const op = await ctx.client.readContract({ ...m, functionName: 'getNodeOperator', args: [noId] });
  const total = (op as { totalDepositedKeys: number }).totalDepositedKeys;

  // Read each deposited key's confirmed balance + withdrawn flag up front (order-independent).
  const state = await Promise.all(
    Array.from({ length: total }, (_, i) => i).map(async (i) => ({
      i,
      confirmed: (await ctx.client.readContract({
        ...m,
        functionName: 'getKeyConfirmedBalances',
        args: [noId, BigInt(i), 1n],
      })) as readonly bigint[],
      withdrawn: (await ctx.client.readContract({
        ...m,
        functionName: 'isValidatorWithdrawn',
        args: [noId, BigInt(i)],
      })) as boolean,
    })),
  );

  // Eligible = confirmed balance 0 and not withdrawn; take the first `count` in index order.
  const eligible = state.filter((s) => s.confirmed[0] === 0n && !s.withdrawn).slice(0, count);
  if (eligible.length < count) {
    throw new Error(
      `@sm-lab/recipes: operator ${noId} has only ${eligible.length} activatable key(s), need ${count}`,
    );
  }

  await actAs(ctx, ctx.addresses.Verifier, async (from) => {
    for (const { i } of eligible) {
      // eslint-disable-next-line no-await-in-loop -- impersonation is global fork state; sequential writes
      await ctx.client.writeContract({
        ...m,
        functionName: 'reportValidatorBalance',
        args: [noId, BigInt(i), ACTIVE_BALANCE],
        account: from,
        chain: null,
      });
    }
  });

  return { activated: eligible.length };
}

/**
 * Report an arbitrary CL balance (wei) for one deposited key (Verifier-gated). Validates the key
 * index is in range and not withdrawn. Port of `NodeOperators.reportBalance`.
 */
export async function reportBalance(
  ctx: Ctx,
  opts: { noId: bigint; keyIndex: bigint; balanceWei: bigint },
): Promise<{ noId: bigint; keyIndex: bigint; balanceWei: bigint }> {
  const m = contract(ctx, 'module');
  const { noId, keyIndex, balanceWei } = opts;

  const op = await ctx.client.readContract({ ...m, functionName: 'getNodeOperator', args: [noId] });
  const total = (op as { totalDepositedKeys: number }).totalDepositedKeys;
  if (keyIndex >= BigInt(total)) {
    throw new Error(
      `@sm-lab/recipes: key index ${keyIndex} out of bounds (operator ${noId} has ${total} deposited keys)`,
    );
  }
  const withdrawn = await ctx.client.readContract({
    ...m,
    functionName: 'isValidatorWithdrawn',
    args: [noId, keyIndex],
  });
  if (withdrawn) {
    throw new Error(`@sm-lab/recipes: key ${keyIndex} of operator ${noId} is withdrawn`);
  }

  await actAs(ctx, ctx.addresses.Verifier, (from) =>
    ctx.client.writeContract({
      ...m,
      functionName: 'reportValidatorBalance',
      args: [noId, keyIndex, balanceWei],
      account: from,
      chain: null,
    }),
  );

  return { noId, keyIndex, balanceWei };
}
