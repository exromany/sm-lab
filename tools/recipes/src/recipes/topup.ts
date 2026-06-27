import { size } from 'viem';
import type { Hex } from '@csm-lab/receipts';
import { actAs } from '../act-as';
import { contract, type Ctx } from '../context';

/** Per-key top-up cap (2016 ether). Matches `NodeOperators.MAX_TOPUP_PER_KEY`. */
const MAX_TOPUP_PER_KEY = 2016n * 10n ** 18n;

/**
 * Top up the allocated balance of a single deposited key (StakingRouter-gated). Validates the key
 * exists and is not withdrawn, then writes a one-element `allocateDeposits` for it. Port of
 * `NodeOperators.increaseAllocatedBalance` — returns the `amountWei` it allocated.
 */
export async function increaseAllocatedBalance(
  ctx: Ctx,
  opts: { noId: bigint; keyIndex: bigint; amountWei: bigint },
): Promise<{ amountWei: bigint }> {
  const m = contract(ctx, 'module');
  const { noId, keyIndex, amountWei } = opts;

  // Order-independent pre-write reads — parallelize (faithful to the source's two `require`s + the
  // pubkey lookup, all of which run before `allocateDeposits`).
  const [op, withdrawn, pubkey] = await Promise.all([
    ctx.client.readContract({ ...m, functionName: 'getNodeOperator', args: [noId] }),
    ctx.client.readContract({ ...m, functionName: 'isValidatorWithdrawn', args: [noId, keyIndex] }),
    ctx.client.readContract({ ...m, functionName: 'getSigningKeys', args: [noId, keyIndex, 1n] }),
  ]);

  const total = (op as { totalDepositedKeys: number }).totalDepositedKeys;
  if (keyIndex >= BigInt(total)) {
    throw new Error(
      `@csm-lab/recipes: key index ${keyIndex} out of bounds (operator ${noId} has ${total} deposited keys)`,
    );
  }
  if (withdrawn) {
    throw new Error(`@csm-lab/recipes: key ${keyIndex} of operator ${noId} is withdrawn`);
  }
  // count=1 → a single packed 48-byte pubkey (same guard as reads.ts getPubkey).
  const key = pubkey as Hex;
  if (!key || size(key) !== 48) {
    throw new Error(`@csm-lab/recipes: no key found for operator ${noId} at index ${keyIndex}`);
  }

  await actAs(ctx, ctx.addresses.stakingRouter, (from) =>
    ctx.client.writeContract({
      ...m,
      functionName: 'allocateDeposits',
      args: [amountWei, [key], [keyIndex], [noId], [amountWei]],
      account: from,
      chain: null,
    }),
  );

  return { amountWei };
}

/**
 * Top up every not-yet-allocated, not-withdrawn deposited key of an operator, one at a time in
 * strict ascending key-index order — `TopUpQueueOps` enforces a global FIFO queue head, so the
 * writes must be sequential and ordered (capped at `MAX_TOPUP_PER_KEY` per key). Port of
 * `NodeOperators.topUpActiveKeys` — returns the count it topped up.
 */
export async function topUpActiveKeys(
  ctx: Ctx,
  opts: { noId: bigint },
): Promise<{ toppedUp: number }> {
  const m = contract(ctx, 'module');
  const { noId } = opts;

  const op = await ctx.client.readContract({ ...m, functionName: 'getNodeOperator', args: [noId] });
  const total = (op as { totalDepositedKeys: number }).totalDepositedKeys;
  if (total === 0) {
    throw new Error(`@csm-lab/recipes: operator ${noId} has no deposited keys`);
  }

  const allocated = (await ctx.client.readContract({
    ...m,
    functionName: 'getKeyAllocatedBalances',
    args: [noId, 0n, BigInt(total)],
  })) as readonly bigint[];
  // Guard the read against noUncheckedIndexedAccess: a too-short array would otherwise make
  // `allocated[i] === 0n` silently false-y for the missing tail.
  if (allocated.length !== total) {
    throw new Error(
      `@csm-lab/recipes: getKeyAllocatedBalances returned ${allocated.length} entries (expected ${total})`,
    );
  }

  // Reads are pulled up-front in parallel for every key — a harmless divergence from the source's
  // lazy per-key short-circuit (the extra `isValidatorWithdrawn`/`getSigningKeys` reads are free on
  // a fork and order-independent).
  const keys = await Promise.all(
    Array.from({ length: total }, (_, i) => i).map(async (i) => ({
      i,
      pubkey: (await ctx.client.readContract({
        ...m,
        functionName: 'getSigningKeys',
        args: [noId, BigInt(i), 1n],
      })) as Hex,
      withdrawn: (await ctx.client.readContract({
        ...m,
        functionName: 'isValidatorWithdrawn',
        args: [noId, BigInt(i)],
      })) as boolean,
    })),
  );

  // Skip already-allocated (`allocated[i] !== 0`) and withdrawn keys — the source's two `continue`s.
  const workList = keys.filter(({ i, withdrawn }) => allocated[i] === 0n && !withdrawn);

  // No-op without entering impersonation when nothing needs topping up (matches the
  // createOperatorGroup "no chain call on no-op" discipline).
  if (workList.length === 0) {
    return { toppedUp: 0 };
  }

  await actAs(ctx, ctx.addresses.stakingRouter, async (from) => {
    for (const { i, pubkey } of workList) {
      // eslint-disable-next-line no-await-in-loop -- sequential by necessity (TopUpQueueOps FIFO queue head; impersonation is global state)
      await ctx.client.writeContract({
        ...m,
        functionName: 'allocateDeposits',
        args: [MAX_TOPUP_PER_KEY, [pubkey], [BigInt(i)], [noId], [MAX_TOPUP_PER_KEY]],
        account: from,
        chain: null,
      });
    }
  });

  return { toppedUp: workList.length };
}
