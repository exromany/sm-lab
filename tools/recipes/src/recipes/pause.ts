import { maxUint256 } from 'viem';
import type { Abi } from 'viem';
import { curatedGateAbi, vettedGateAbi } from '@sm-lab/receipts';
import type { Hex } from '@sm-lab/receipts';
import { actAs, roleMember } from '../act-as';
import { contract, resolveGate, type Ctx } from '../context';
import { DEFAULT_ADMIN_ROLE, PAUSE_ROLE, RESUME_ROLE } from '../roles';

export interface PauseResult {
  /** the target keyword as supplied (module | accounting | gate selector) */
  target: string;
  /** the resolved contract address */
  address: Hex;
  /** paused state after the call */
  paused: boolean;
}

/**
 * Resolve a pause target keyword to a contract handle. `module` and `accounting` are reserved;
 * anything else is a gate selector resolved via `resolveGate` (ics/idvtc for csm; po…iodcp/index
 * for cm; 0x… for either).
 */
function resolveTarget(ctx: Ctx, target: string): { address: Hex; abi: Abi } {
  if (target === 'module') {
    const m = contract(ctx, 'module');
    return { address: m.address, abi: m.abi as Abi };
  }
  if (target === 'accounting') {
    const a = contract(ctx, 'Accounting');
    return { address: a.address, abi: a.abi as Abi };
  }
  // All gate types share the PausableUntil surface, so either gate abi decodes it.
  const abi = (ctx.module === 'cm' ? curatedGateAbi : vettedGateAbi) as Abi;
  return { address: resolveGate(ctx, target), abi };
}

/** Pause a target (module | accounting | gate selector). Idempotent: no-op if already paused. */
export async function pause(ctx: Ctx, opts: { target: string }): Promise<PauseResult> {
  const t = resolveTarget(ctx, opts.target);
  const already = (await ctx.client.readContract({ ...t, functionName: 'isPaused' })) as boolean;
  if (already) return { target: opts.target, address: t.address, paused: true };

  const admin = await roleMember(ctx, t, DEFAULT_ADMIN_ROLE);
  await actAs(ctx, admin, async (from) => {
    await ctx.client.writeContract({
      ...t,
      functionName: 'grantRole',
      args: [PAUSE_ROLE, admin],
      account: from,
      chain: null,
    });
    await ctx.client.writeContract({
      ...t,
      functionName: 'pauseFor',
      args: [maxUint256],
      account: from,
      chain: null,
    });
  });
  return { target: opts.target, address: t.address, paused: true };
}

/** Resume a target (module | accounting | gate selector). Idempotent: no-op if not paused. */
export async function resume(ctx: Ctx, opts: { target: string }): Promise<PauseResult> {
  const t = resolveTarget(ctx, opts.target);
  const paused = (await ctx.client.readContract({ ...t, functionName: 'isPaused' })) as boolean;
  if (!paused) return { target: opts.target, address: t.address, paused: false };

  const admin = await roleMember(ctx, t, DEFAULT_ADMIN_ROLE);
  await actAs(ctx, admin, async (from) => {
    await ctx.client.writeContract({
      ...t,
      functionName: 'grantRole',
      args: [RESUME_ROLE, admin],
      account: from,
      chain: null,
    });
    await ctx.client.writeContract({
      ...t,
      functionName: 'resume',
      account: from,
      chain: null,
    });
  });
  return { target: opts.target, address: t.address, paused: false };
}
