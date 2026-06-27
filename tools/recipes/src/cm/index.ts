import { buildIcsTree } from '@csm-lab/merkle';
import { curatedGateAbi, metaRegistryAbi } from '@csm-lab/receipts';
import type { CmAddressBook, Hex } from '@csm-lab/receipts';
import { keccak256, zeroAddress } from 'viem';
import { actAs, roleMember } from '../act-as';
import { resolveGate, type Ctx, type CmGateSelector } from '../context';
import { DEFAULT_ADMIN_ROLE, RESUME_ROLE, SET_TREE_ROLE } from '../roles';

/** An empty MetaRegistry OperatorGroup — used to reset a group to its zero state. */
const EMPTY_GROUP = { name: '', subNodeOperators: [], externalOperators: [] };

export interface CreateCuratedOperatorOptions {
  /** cm gate selector (po/pto/…) or a raw 0x… address. */
  selector: CmGateSelector | string;
  /** The new operator's address; also the merkle leaf proven into the temp tree. */
  operator: Hex;
  /** Second leaf for the N=2 temp tree; derived deterministically from `operator` if omitted. */
  extra?: Hex;
  name?: string;
  description?: string;
}

export interface CreateCuratedOperatorResult {
  noId: bigint;
}

/**
 * Create a node operator through a curated gate by temporarily installing a 2-leaf merkle
 * tree that admits `operator`, creating the operator, then restoring the gate's original
 * tree. (Port of `NodeOperators.createCuratedOperator`; no post-assertions — returns noId.)
 */
export async function createCuratedOperator(
  ctx: Ctx,
  opts: CreateCuratedOperatorOptions,
): Promise<CreateCuratedOperatorResult> {
  if (ctx.module !== 'cm') {
    throw new Error('@csm-lab/recipes/cm: createCuratedOperator requires ctx.module === "cm"');
  }
  const gate = { address: resolveGate(ctx, opts.selector), abi: curatedGateAbi } as const;
  const extra = opts.extra ?? deriveExtra(opts.operator);

  // Snapshot the original tree so we can restore it after creating the operator.
  const origRoot = await ctx.client.readContract({ ...gate, functionName: 'treeRoot' });
  const origCid = await ctx.client.readContract({ ...gate, functionName: 'treeCid' });
  const admin = await roleMember(ctx, gate, DEFAULT_ADMIN_ROLE);

  // N=2 OZ ['address'] tree; prove by value (OZ sorts leaves, so index is unreliable).
  const tree = buildIcsTree([opts.operator, extra]);
  const tmpRoot = tree.root as Hex;
  const proof = tree.getProof([opts.operator]) as Hex[];
  const tmpCid = `tmp-cid-${opts.operator.toLowerCase()}`;

  // Install the temp tree as the gate admin (grant SET_TREE_ROLE, resume if paused, set).
  await actAs(ctx, admin, async (from) => {
    await ctx.client.writeContract({
      ...gate,
      functionName: 'grantRole',
      args: [SET_TREE_ROLE, admin],
      account: from,
      chain: null,
    });
    const paused = await ctx.client.readContract({ ...gate, functionName: 'isPaused' });
    if (paused) {
      await ctx.client.writeContract({
        ...gate,
        functionName: 'grantRole',
        args: [RESUME_ROLE, admin],
        account: from,
        chain: null,
      });
      await ctx.client.writeContract({
        ...gate,
        functionName: 'resume',
        account: from,
        chain: null,
      });
    }
    await ctx.client.writeContract({
      ...gate,
      functionName: 'setTreeParams',
      args: [tmpRoot, tmpCid],
      account: from,
      chain: null,
    });
  });

  // Capture the returned noId via simulate, then send the real tx as the operator.
  // The restore runs in `finally` so a failed create never leaves the gate with the
  // temporary tree installed on the fork (matching actAs's stop-on-any-exit discipline).
  try {
    const { result, request } = await ctx.client.simulateContract({
      ...gate,
      functionName: 'createNodeOperator',
      args: [
        opts.name ?? 'fork-operator',
        opts.description ?? 'fork-test',
        zeroAddress,
        zeroAddress,
        proof,
      ],
      account: opts.operator,
    });
    const noId = result as bigint;
    await actAs(ctx, opts.operator, () => ctx.client.writeContract({ ...request, chain: null }));
    return { noId };
  } finally {
    // Restore the original tree as admin.
    await actAs(ctx, admin, (from) =>
      ctx.client.writeContract({
        ...gate,
        functionName: 'setTreeParams',
        args: [origRoot, origCid],
        account: from,
        chain: null,
      }),
    );
  }
}

export interface CreateOperatorGroupOptions {
  /** [nodeOperatorId, shareBps] pairs; shares in basis points (e.g. 6000 = 60%), must sum to 10000. */
  pairs: [bigint, bigint][];
  /** Optional group name (Solidity leaves it ''); default ''. */
  name?: string;
}

export interface CreateOperatorGroupResult {
  /** The sub-node-operators written into the NO_GROUP_ID group, in input order. */
  subNodeOperators: { nodeOperatorId: bigint; share: number }[];
  /** Group ids reset to EMPTY_GROUP first (operators previously in a group), de-duplicated. */
  resetGroupIds: bigint[];
}

/**
 * Create a node-operator group on the MetaRegistry: reset any pre-existing memberships of the
 * named operators, then write a fresh group under `NO_GROUP_ID`. Port of
 * `MetaRegistryHelpers.createOperatorGroup` (the `MANAGE_OPERATOR_GROUPS_ROLE` member acts).
 */
export async function createOperatorGroup(
  ctx: Ctx,
  opts: CreateOperatorGroupOptions,
): Promise<CreateOperatorGroupResult> {
  if (ctx.module !== 'cm') {
    throw new Error('@csm-lab/recipes/cm: createOperatorGroup requires ctx.module === "cm"');
  }
  // Validate input BEFORE any chain call — a precise error beats an opaque on-chain revert.
  if (opts.pairs.length < 1)
    throw new Error('@csm-lab/recipes/cm: createOperatorGroup needs ≥1 [noId, shareBps] pair');
  const shareSum = opts.pairs.reduce((acc, [, s]) => acc + s, 0n);
  if (shareSum !== 10000n)
    throw new Error(`@csm-lab/recipes/cm: shares must sum to 10000 bps (got ${shareSum})`);

  const mr = {
    address: (ctx.addresses as CmAddressBook).MetaRegistry as Hex,
    abi: metaRegistryAbi,
  } as const;
  const role = (await ctx.client.readContract({
    ...mr,
    functionName: 'MANAGE_OPERATOR_GROUPS_ROLE',
  })) as Hex;
  const manager = await roleMember(ctx, mr, role);

  const noGroupId = (await ctx.client.readContract({
    ...mr,
    functionName: 'NO_GROUP_ID',
  })) as bigint;

  // Resolve current memberships up front (parallel reads — order-independent), then de-dup the gids
  // to reset (a harmless divergence from Solidity's per-pair reset, which can double-reset an
  // already-emptied gid). A Set preserves insertion order, so resetGroupIds stays deterministic in
  // first-encounter order.
  const gids = (await Promise.all(
    opts.pairs.map(([noId]) =>
      ctx.client.readContract({ ...mr, functionName: 'getNodeOperatorGroupId', args: [noId] }),
    ),
  )) as bigint[];
  const toReset = new Set<bigint>();
  for (const gid of gids) {
    if (gid !== noGroupId) toReset.add(gid);
  }
  const resetGroupIds = [...toReset];

  const subNodeOperators = opts.pairs.map(([noId, share]) => ({
    nodeOperatorId: noId, // bigint (uint64)
    share: Number(share), // number (uint16)
  }));
  const group = { name: opts.name ?? '', subNodeOperators, externalOperators: [] };

  await actAs(ctx, manager, async (from) => {
    for (const gid of resetGroupIds) {
      // eslint-disable-next-line no-await-in-loop -- sequential by necessity (impersonation is global state)
      await ctx.client.writeContract({
        ...mr,
        functionName: 'createOrUpdateOperatorGroup',
        args: [gid, EMPTY_GROUP],
        account: from,
        chain: null,
      });
    }
    await ctx.client.writeContract({
      ...mr,
      functionName: 'createOrUpdateOperatorGroup',
      args: [noGroupId, group],
      account: from,
      chain: null,
    });
  });

  return { subNodeOperators, resetGroupIds };
}

export interface ResetOperatorGroupResult {
  groupId: bigint;
}

/**
 * Reset the operator group that contains `noId` to its empty state. Port of
 * `MetaRegistryHelpers.resetOperatorGroup`; throws if the operator is in no group.
 */
export async function resetOperatorGroup(
  ctx: Ctx,
  opts: { noId: bigint },
): Promise<ResetOperatorGroupResult> {
  if (ctx.module !== 'cm') {
    throw new Error('@csm-lab/recipes/cm: resetOperatorGroup requires ctx.module === "cm"');
  }
  const mr = {
    address: (ctx.addresses as CmAddressBook).MetaRegistry as Hex,
    abi: metaRegistryAbi,
  } as const;
  const role = (await ctx.client.readContract({
    ...mr,
    functionName: 'MANAGE_OPERATOR_GROUPS_ROLE',
  })) as Hex;
  const manager = await roleMember(ctx, mr, role);

  const gid = (await ctx.client.readContract({
    ...mr,
    functionName: 'getNodeOperatorGroupId',
    args: [opts.noId],
  })) as bigint;
  const noGroupId = (await ctx.client.readContract({
    ...mr,
    functionName: 'NO_GROUP_ID',
  })) as bigint;
  if (gid === noGroupId) throw new Error('@csm-lab/recipes/cm: operator not in a group');

  await actAs(ctx, manager, (from) =>
    ctx.client.writeContract({
      ...mr,
      functionName: 'createOrUpdateOperatorGroup',
      args: [gid, EMPTY_GROUP],
      account: from,
      chain: null,
    }),
  );

  return { groupId: gid };
}

/**
 * Set a bond-curve weight on the MetaRegistry. Port of
 * `MetaRegistryHelpers.setBondCurveWeight` (the `SET_BOND_CURVE_WEIGHT_ROLE` member acts).
 */
export async function setBondCurveWeight(
  ctx: Ctx,
  opts: { curveId: bigint; weight: bigint },
): Promise<{ curveId: bigint; weight: bigint }> {
  if (ctx.module !== 'cm') {
    throw new Error('@csm-lab/recipes/cm: setBondCurveWeight requires ctx.module === "cm"');
  }
  const mr = {
    address: (ctx.addresses as CmAddressBook).MetaRegistry as Hex,
    abi: metaRegistryAbi,
  } as const;
  const role = (await ctx.client.readContract({
    ...mr,
    functionName: 'SET_BOND_CURVE_WEIGHT_ROLE',
  })) as Hex;
  const setter = await roleMember(ctx, mr, role);

  await actAs(ctx, setter, (from) =>
    ctx.client.writeContract({
      ...mr,
      functionName: 'setBondCurveWeight',
      args: [opts.curveId, opts.weight],
      account: from,
      chain: null,
    }),
  );

  return { curveId: opts.curveId, weight: opts.weight };
}

/** A deterministic address distinct from `operator` (low 20 bytes of its keccak hash). */
function deriveExtra(operator: Hex): Hex {
  const h = keccak256(operator); // 0x + 64 hex chars
  return `0x${h.slice(-40)}` as Hex; // low 20 bytes → a valid, distinct address
}
