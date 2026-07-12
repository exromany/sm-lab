import type { Hex } from '@sm-lab/receipts';
import type { Ctx } from '../context';
import { setClValidator } from '../cl-mock';
import { getKeyBalance, getPubkey } from './reads';

const GWEI_PER_ETH = 1_000_000_000n;
const BASE_ETH_GWEI = 32n * GWEI_PER_ETH; // base 32 ETH, in gwei (32_000_000_000n)

export interface ClActivateResult {
  pubkey: Hex;
  status: 'active_ongoing';
  effectiveBalanceGwei: bigint;
}

/**
 * Effective balance of an active validator, in gwei: 32 ETH + the key's on-chain allocated balance
 * (sub-gwei dust floored). Shared by `clActivate` (`active_ongoing`) and `exitRequest`'s optional
 * cl-mock flip (`active_exiting`) so both bridges report the same balance for the same key.
 */
export async function activeEffectiveBalanceGwei(
  ctx: Ctx,
  opts: { noId: bigint; keyIndex: bigint },
): Promise<bigint> {
  const allocWei = await getKeyBalance(ctx, opts);
  // BigInt `/` floors sub-gwei dust (allocWei >= 0 so floor == truncation toward zero).
  return BASE_ETH_GWEI + allocWei / GWEI_PER_ETH;
}

/**
 * Read a key's pubkey + allocated balance on-chain, then mark it `active_ongoing` on a running
 * cl-mock with effective balance = 32 ETH + allocated balance, in gwei. Port of
 * `cl-mock.just:cl-activate`. Diverges from the Solidity helper's integer-ETH truncation
 * (`balances[0] / 1 ether`) by keeping full gwei precision (cl-mock stores `effective_balance`
 * in gwei) — the spec-blessed divergence.
 */
export async function clActivate(
  ctx: Ctx,
  opts: { noId: bigint; keyIndex: bigint },
): Promise<ClActivateResult> {
  if (!ctx.clMockUrl) {
    throw new Error(
      '@sm-lab/recipes: clActivate needs a running cl-mock. ' +
        'Start one (npx @sm-lab/cl serve) and pass --cl-mock-url <url> (or set CL_MOCK_URL).',
    );
  }
  // Sequential, not Promise.all: pubkey first so an empty key throws "no key found" before any
  // balance read (deterministic errors; no balance read on the empty-pubkey path).
  const pubkey = await getPubkey(ctx, opts);
  const effectiveBalanceGwei = await activeEffectiveBalanceGwei(ctx, opts);
  await setClValidator(ctx.clMockUrl, {
    pubkey,
    status: 'active_ongoing',
    effectiveBalanceGwei,
  });
  return { pubkey, status: 'active_ongoing', effectiveBalanceGwei };
}
