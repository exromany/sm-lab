import { buildIcsTree, ipfsOptionsFromEnv, pinJsonToIpfs, shouldAttemptPin } from '@csm-lab/merkle';
import { vettedGateAbi } from '@csm-lab/receipts';
import type { Hex } from '@csm-lab/receipts';
import { actAs, roleMember } from '../act-as';
import { resolveGate, type Ctx, type CsmGateSelector } from '../context';
import { DEFAULT_ADMIN_ROLE, SET_TREE_ROLE } from '../roles';

export interface SetGateAddrsOptions {
  /** Whitelisted addresses to encode into the gate's merkle tree. */
  addresses: Hex[];
  /** CSM gate selector; only 'ics' is supported in 6b (default 'ics'). */
  selector?: CsmGateSelector;
  /** Skip IPFS pinning by supplying a precomputed cid (hermetic tests do this). */
  cid?: string;
}

export interface SetGateAddrsResult {
  treeRoot: Hex;
  treeCid: string;
}

/**
 * Build the ICS address tree (OZ ['address'], via @csm-lab/merkle) and install it on the
 * VettedGate (`setTreeParams(root, cid)`), impersonating the gate admin. The cid is pinned
 * to IPFS (env-configured: a local @csm-lab/ipfs-mock or Pinata) unless `cid` is supplied.
 * (Port of fork.just `set-gate-addrs` + `update-gate-tree`.)
 */
export async function setGateAddrs(
  ctx: Ctx,
  opts: SetGateAddrsOptions,
): Promise<SetGateAddrsResult> {
  const gate = { address: resolveGate(ctx, opts.selector ?? 'ics'), abi: vettedGateAbi } as const;
  const tree = buildIcsTree(opts.addresses);
  const treeRoot = tree.root as Hex;
  const treeCid = opts.cid ?? (await pinTree(tree.dump()));
  const admin = await roleMember(ctx, gate, DEFAULT_ADMIN_ROLE);

  await actAs(ctx, admin, async (from) => {
    await ctx.client.writeContract({
      ...gate,
      functionName: 'grantRole',
      args: [SET_TREE_ROLE, admin],
      account: from,
      chain: null,
    });
    await ctx.client.writeContract({
      ...gate,
      functionName: 'setTreeParams',
      args: [treeRoot, treeCid],
      account: from,
      chain: null,
    });
  });

  return { treeRoot, treeCid };
}

async function pinTree(dump: unknown): Promise<string> {
  // Guard BEFORE any network call so hermetic tests (no IPFS env) never hit the wire.
  if (!shouldAttemptPin()) {
    throw new Error(
      '@csm-lab/recipes/csm: could not pin the gate tree — set IPFS_API_URL (a local @csm-lab/ipfs-mock) or PINATA_* credentials, or pass opts.cid',
    );
  }
  return pinJsonToIpfs(dump, 'gate-ics', ipfsOptionsFromEnv());
}
