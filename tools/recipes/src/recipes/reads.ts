import { size } from 'viem';
import { curatedGateAbi, stakingRouterAbi, vettedGateAbi } from '@sm-lab/receipts';
import type { Hex } from '@sm-lab/receipts';
import { contract, resolveGate, type Ctx } from '../context';
import { NAMED_GATE_MODULES } from '../modules';

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
      `@sm-lab/recipes: no key found for operator ${opts.noId} at index ${opts.keyIndex}`,
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
      `@sm-lab/recipes: no allocated balance for operator ${opts.noId} at index ${opts.keyIndex}`,
    );
  }
  return wei;
}

export interface BondCurveInterval {
  minKeysCount: bigint;
  minBond: bigint;
  trend: bigint;
}
export interface BondCurveInfo {
  intervals: BondCurveInterval[];
}

/** Read a bond curve by id from Accounting (read-only). */
export async function getCurveInfo(ctx: Ctx, opts: { curveId: bigint }): Promise<BondCurveInfo> {
  const acc = contract(ctx, 'Accounting');
  const info = (await ctx.client.readContract({
    ...acc,
    functionName: 'getCurveInfo',
    args: [opts.curveId],
  })) as BondCurveInfo;
  return info;
}

export interface BondInfo {
  currentBond: bigint;
  requiredBond: bigint;
  lockedBond: bigint;
  bondDebt: bigint;
  pendingSharesToSplit: bigint;
}

/** Read an operator's bond summary from Accounting (read-only). */
export async function bondInfo(ctx: Ctx, opts: { noId: bigint }): Promise<BondInfo> {
  const acc = contract(ctx, 'Accounting');
  return (await ctx.client.readContract({
    ...acc,
    functionName: 'getNodeOperatorBondInfo',
    args: [opts.noId],
  })) as BondInfo;
}

/** All of an operator's pubkeys (48 bytes each), in index order (read-only). */
export async function operatorKeys(ctx: Ctx, opts: { noId: bigint }): Promise<Hex[]> {
  const m = contract(ctx, 'module');
  const op = await ctx.client.readContract({
    ...m,
    functionName: 'getNodeOperator',
    args: [opts.noId],
  });
  const total = (op as { totalAddedKeys: number }).totalAddedKeys;
  if (total === 0) return [];
  const packed = (await ctx.client.readContract({
    ...m,
    functionName: 'getSigningKeys',
    args: [opts.noId, 0n, BigInt(total)],
  })) as Hex;
  const hex = packed.slice(2); // drop 0x; 48 bytes = 96 hex chars per key
  const keys: Hex[] = [];
  for (let i = 0; i < total; i++) keys.push(`0x${hex.slice(i * 96, (i + 1) * 96)}` as Hex);
  return keys;
}

/** All of an operator's deposited-key allocated balances (wei), in index order (read-only). */
export async function keyBalances(ctx: Ctx, opts: { noId: bigint }): Promise<bigint[]> {
  const m = contract(ctx, 'module');
  const op = await ctx.client.readContract({
    ...m,
    functionName: 'getNodeOperator',
    args: [opts.noId],
  });
  const total = (op as { totalDepositedKeys: number }).totalDepositedKeys;
  if (total === 0) return [];
  const balances = (await ctx.client.readContract({
    ...m,
    functionName: 'getKeyAllocatedBalances',
    args: [opts.noId, 0n, BigInt(total)],
  })) as readonly bigint[];
  return [...balances];
}

/** Total number of node operators in the module (read-only). */
export async function operatorsCount(ctx: Ctx): Promise<bigint> {
  const m = contract(ctx, 'module');
  return (await ctx.client.readContract({ ...m, functionName: 'getNodeOperatorsCount' })) as bigint;
}

/** The highest node operator id (count - 1). Throws when there are no operators. */
export async function getLastOperator(ctx: Ctx): Promise<bigint> {
  const count = await operatorsCount(ctx);
  if (count === 0n) throw new Error('@sm-lab/recipes: no node operators');
  return count - 1n;
}

export interface GateTree {
  selector: string;
  address: Hex;
  treeRoot: Hex;
  treeCid: string;
}

/**
 * Read a gate's current merkle tree params (root + cid) by selector (read-only). csm02 has no
 * typed gate ABI (its only gate, PermissionlessGate, carries no tree) — throws for csm02.
 */
export async function getGateTree(ctx: Ctx, opts: { selector: string }): Promise<GateTree> {
  if (!NAMED_GATE_MODULES.has(ctx.module)) {
    throw new Error(
      `@sm-lab/recipes: ${ctx.module} has no typed gate ABI (PermissionlessGate only, no tree) — getGateTree is unsupported`,
    );
  }
  const address = resolveGate(ctx, opts.selector);
  const abi = ctx.module === 'cm' ? curatedGateAbi : vettedGateAbi;
  const gate = { address, abi } as const;
  const treeRoot = (await ctx.client.readContract({ ...gate, functionName: 'treeRoot' })) as Hex;
  const treeCid = (await ctx.client.readContract({ ...gate, functionName: 'treeCid' })) as string;
  return { selector: opts.selector, address, treeRoot, treeCid };
}

/** Find the staking-module id whose registered address is `moduleAddress` (scans ALL ids). */
export async function findModuleId(ctx: Ctx, moduleAddress: Hex): Promise<bigint | undefined> {
  const sr = { address: ctx.addresses.stakingRouter, abi: stakingRouterAbi } as const;
  const ids = (await ctx.client.readContract({
    ...sr,
    functionName: 'getStakingModuleIds',
  })) as bigint[];
  const mods = (await Promise.all(
    ids.map((id) =>
      ctx.client.readContract({ ...sr, functionName: 'getStakingModule', args: [id] }),
    ),
  )) as { stakingModuleAddress: Hex }[];
  const idx = mods.findIndex(
    (mod) => mod.stakingModuleAddress.toLowerCase() === moduleAddress.toLowerCase(),
  );
  return idx === -1 ? undefined : ids[idx];
}

/** Resolve the staking-module id for `moduleAddress`. Throws when it isn't registered. */
export async function resolveModuleId(ctx: Ctx, moduleAddress: Hex): Promise<bigint> {
  const id = await findModuleId(ctx, moduleAddress);
  if (id === undefined)
    throw new Error(`@sm-lab/recipes: module ${moduleAddress} not registered in the StakingRouter`);
  return id;
}
