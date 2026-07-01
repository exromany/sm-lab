import { buildIcsTree } from '@sm-lab/merkle';
import { curatedGateAbi, metaRegistryAbi } from '@sm-lab/receipts';
import type { CmAddressBook, Hex } from '@sm-lab/receipts';
import { concat, keccak256, toHex, zeroAddress } from 'viem';
import { actAs, roleMember } from '../act-as';
import { resolveGate, type Ctx, type CmGateSelector } from '../context';
import { randomSeed } from '../random';
import { addKeys } from '../recipes/add-keys';
import { deposit } from '../recipes/deposit';
import { topUpActiveKeys } from '../recipes/topup';
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
    throw new Error('@sm-lab/recipes/cm: createCuratedOperator requires ctx.module === "cm"');
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
    throw new Error('@sm-lab/recipes/cm: createOperatorGroup requires ctx.module === "cm"');
  }
  // Validate input BEFORE any chain call — a precise error beats an opaque on-chain revert.
  if (opts.pairs.length < 1)
    throw new Error('@sm-lab/recipes/cm: createOperatorGroup needs ≥1 [noId, shareBps] pair');
  const shareSum = opts.pairs.reduce((acc, [, s]) => acc + s, 0n);
  if (shareSum !== 10000n)
    throw new Error(`@sm-lab/recipes/cm: shares must sum to 10000 bps (got ${shareSum})`);

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
    throw new Error('@sm-lab/recipes/cm: resetOperatorGroup requires ctx.module === "cm"');
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
  if (gid === noGroupId) throw new Error('@sm-lab/recipes/cm: operator not in a group');

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
    throw new Error('@sm-lab/recipes/cm: setBondCurveWeight requires ctx.module === "cm"');
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

export interface SeedCmOptions {
  /** cm gate selector for the 3 created operators (default 'po' = CuratedGates[0]). */
  selector?: CmGateSelector | string;
  /** Deterministic seed for the operator addresses + key material. Omit → fresh random. */
  seed?: Hex;
}

export interface SeedCmResult {
  /** The 3 created operators' noIds, in creation order (a/b/c). */
  noIds: [bigint, bigint, bigint];
  /** The operator addresses generated for the gate, parallel to `noIds`. */
  operators: [Hex, Hex, Hex];
}

/** A deterministic address from a seed + label (low 20 bytes of keccak — mirrors deriveExtra). */
function deriveOperatorAddress(seed: Hex, i: number): Hex {
  const h = keccak256(concat([seed, toHex(`cm-operator-${i}`)]));
  return `0x${h.slice(-40)}` as Hex;
}

/** A deterministic key seed from a seed + label (so the 7 addKeys calls never collide on pubkeys). */
function keySeed(seed: Hex, label: string): Hex {
  return keccak256(concat([seed, toHex(label)]));
}

/**
 * Seed a realistic cm fork in one call: create 3 gate operators, group them 34/33/33, then key /
 * deposit / top-up across 3 rounds (and add a final key to two of them). Port of `fork.just
 * seed-cm`. Composes already-tested recipes; uses the noIds returned by `createCuratedOperator`
 * (not hardcoded 0/1/2) so it is correct on a non-fresh fork too. Deterministic when `seed` is set.
 */
export async function seedCm(ctx: Ctx, opts: SeedCmOptions = {}): Promise<SeedCmResult> {
  if (ctx.module !== 'cm') {
    throw new Error('@sm-lab/recipes/cm: seedCm requires ctx.module === "cm"');
  }

  const selector = opts.selector ?? 'po';
  const seed = opts.seed ?? randomSeed();
  const operators: [Hex, Hex, Hex] = [
    deriveOperatorAddress(seed, 0),
    deriveOperatorAddress(seed, 1),
    deriveOperatorAddress(seed, 2),
  ];

  // Sequential by necessity: each createCuratedOperator installs/restores the gate temp tree and
  // every later step reads fork state mutated by the prior ones.
  const { noId: na } = await createCuratedOperator(ctx, { selector, operator: operators[0] });
  const { noId: nb } = await createCuratedOperator(ctx, { selector, operator: operators[1] });
  const { noId: nc } = await createCuratedOperator(ctx, { selector, operator: operators[2] });
  const noIds: [bigint, bigint, bigint] = [na, nb, nc];

  await createOperatorGroup(ctx, {
    pairs: [
      [na, 3400n],
      [nb, 3300n],
      [nc, 3300n],
    ],
  });

  // 3 add/deposit/topup rounds, mapping the source's operator indices 0/1/0 to na/nb/na. Each
  // addKeys gets a distinct per-call label (r0..r4) so na's three calls draw different key material
  // — a shared label would regenerate the same pubkeys and collide.
  await addKeys(ctx, { noId: na, count: 4, seed: keySeed(seed, 'r0') });
  await deposit(ctx, { count: 100 });
  await topUpActiveKeys(ctx, { noId: na });

  await addKeys(ctx, { noId: nb, count: 5, seed: keySeed(seed, 'r1') });
  await deposit(ctx, { count: 100 });
  await topUpActiveKeys(ctx, { noId: nb });

  await addKeys(ctx, { noId: na, count: 6, seed: keySeed(seed, 'r2') });
  await deposit(ctx, { count: 100 });
  await topUpActiveKeys(ctx, { noId: na });

  // Final keys, no deposit/topup.
  await addKeys(ctx, { noId: na, count: 1, seed: keySeed(seed, 'r3') });
  await addKeys(ctx, { noId: nb, count: 1, seed: keySeed(seed, 'r4') });

  return { noIds, operators };
}
