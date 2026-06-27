import { buildIcsTree } from '@csm-lab/merkle';
import { curatedGateAbi } from '@csm-lab/receipts';
import type { Hex } from '@csm-lab/receipts';
import { keccak256, zeroAddress } from 'viem';
import { actAs, roleMember } from '../act-as';
import { resolveGate, type Ctx, type CmGateSelector } from '../context';
import { DEFAULT_ADMIN_ROLE, RESUME_ROLE, SET_TREE_ROLE } from '../roles';

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
      await ctx.client.writeContract({ ...gate, functionName: 'resume', account: from, chain: null });
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
  const { result, request } = await ctx.client.simulateContract({
    ...gate,
    functionName: 'createNodeOperator',
    args: [opts.name ?? 'fork-operator', opts.description ?? 'fork-test', zeroAddress, zeroAddress, proof],
    account: opts.operator,
  });
  const noId = result as bigint;
  await actAs(ctx, opts.operator, () => ctx.client.writeContract({ ...request, chain: null }));

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

  return { noId };
}

/** A deterministic address distinct from `operator` (low 20 bytes of its keccak hash). */
function deriveExtra(operator: Hex): Hex {
  const h = keccak256(operator); // 0x + 64 hex chars
  return `0x${h.slice(-40)}` as Hex; // low 20 bytes → a valid, distinct address
}
