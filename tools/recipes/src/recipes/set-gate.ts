import {
  assertPinnable,
  buildAddressesTree,
  ipfsOptionsFromEnv,
  pinJsonToIpfs,
} from '@sm-lab/merkle';
import { curatedGateAbi, vettedGateAbi } from '@sm-lab/receipts';
import type { Hex } from '@sm-lab/receipts';
import { actAs, roleMember } from '../act-as';
import { resolveGate, type Ctx, type GateSelector } from '../context';
import { DEFAULT_ADMIN_ROLE, SET_TREE_ROLE } from '../roles';

export interface SetGateAddrsOptions {
  /** Whitelisted addresses to encode into the gate's merkle tree. */
  addresses: Hex[];
  /**
   * Gate selector passed to resolveGate. csm: 'ics' (default) | 'idvtc'; cm:
   * 'po'|'pto'|'pgo'|'do'|'eeo'|'iodc'|'iodcp' (default 'po') or a gate index; any: a raw 0x… address.
   */
  selector?: GateSelector | string;
  /** Skip IPFS pinning by supplying a precomputed cid (hermetic tests do this). */
  cid?: string;
}

export interface SetGateAddrsResult {
  treeRoot: Hex;
  treeCid: string;
}

/** Default gate selector per module: cm → 'po' (CuratedGatePO); csm → 'ics' (IcsGate). */
function defaultSelector(ctx: Ctx): string {
  return ctx.module === 'cm' ? 'po' : 'ics';
}

/**
 * Build a gate addresses tree (OZ ['address'], via @sm-lab/merkle) and install it on the gate
 * (`setTreeParams(root, cid)`), impersonating the gate admin. The cid is pinned to IPFS
 * (env-configured: a local @sm-lab/ipfs or Pinata) unless `cid` is supplied.
 *
 * Module-agnostic (port of fork.just `set-gate-addrs` + `update-gate-tree`, both selector-driven):
 * the csm VettedGate and cm CuratedGate share a byte-identical grantRole/setTreeParams/getRoleMember
 * surface, so the only per-module differences are the resolved address, the default selector, and
 * which gate ABI carries the fragments.
 */
export async function setGateAddrs(
  ctx: Ctx,
  opts: SetGateAddrsOptions,
): Promise<SetGateAddrsResult> {
  const selector = opts.selector ?? defaultSelector(ctx);
  // Both gate ABIs carry a byte-identical grantRole/setTreeParams/getRoleMember surface, so we use
  // the module's own ABI at runtime but pin the compile-time type to one constituent (viem can't
  // infer a union abi). Only those three fragments are ever called — sound for either gate.
  const abi = (ctx.module === 'cm' ? curatedGateAbi : vettedGateAbi) as typeof vettedGateAbi;
  const gate = { address: resolveGate(ctx, selector), abi } as const;
  const tree = buildAddressesTree(opts.addresses);
  const treeRoot = tree.root as Hex;
  const treeCid = opts.cid ?? (await pinTree(tree.dump(), selector));
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

async function pinTree(dump: unknown, selector: string): Promise<string> {
  // Fail loudly (with actionable guidance) BEFORE any pin so hermetic tests never hit the wire and
  // a missing IPFS backend can never leave the gate with a half-installed tree.
  await assertPinnable('pass --cid <cid>');
  return pinJsonToIpfs(dump, `gate-${selector}`, ipfsOptionsFromEnv());
}
