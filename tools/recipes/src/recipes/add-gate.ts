import {
  addressesFromDump,
  buildAddressesTree,
  fetchIpfsJson,
  type TreeDump,
} from '@sm-lab/merkle';
import type { Hex } from '@sm-lab/receipts';
import { getAddress } from 'viem';
import type { Ctx, GateSelector } from '../context';
import { getGateTree } from './reads';
import { defaultSelector, setGateAddrs } from './set-gate';

export interface AddGateAddrsOptions {
  /** Addresses to append to the gate's current whitelist. */
  addresses: Hex[];
  /** Gate selector (same semantics as set-gate). Defaults per module: cm → 'po', csm → 'ics'. */
  selector?: GateSelector | string;
  /** Read the current tree from this CID instead of the gate's on-chain `treeCid()`. */
  fromCid?: string;
  /** Skip pinning the merged tree by supplying its CID (also the hermetic-test bypass). */
  cid?: string;
}

export interface AddGateAddrsResult {
  treeRoot: Hex;
  treeCid: string;
  /** Addresses actually newly added (checksummed) — empty when all were already present. */
  added: Hex[];
  /** false when every new address was already whitelisted (no on-chain write performed). */
  changed: boolean;
}

/**
 * Append addresses to a gate's current merkle tree, preserving the existing members — the additive
 * counterpart of `setGateAddrs` (which replaces the whole tree). Flow: recover the current set
 * (gate `treeCid` → IPFS dump), union with the new addresses (case-insensitive dedup, checksummed
 * out), then delegate build+pin+install to `setGateAddrs`.
 *
 * No-op guard: if every new address is already whitelisted the union is unchanged, so the root is
 * unchanged — and the gate's `setTreeParams` reverts on an unchanged root. We detect that and
 * return `{ changed: false }` without any write. The unchanged root is recomputed locally
 * (`buildAddressesTree(union).root`); OZ trees are order-independent and every gate tree in this
 * lab is built by `buildAddressesTree`, so it equals the on-chain root — no extra `treeRoot()` read.
 */
export async function addGateAddrs(
  ctx: Ctx,
  opts: AddGateAddrsOptions,
): Promise<AddGateAddrsResult> {
  const selector = opts.selector ?? defaultSelector(ctx);
  const curCid = opts.fromCid ?? (await getGateTree(ctx, { selector })).treeCid;
  const current = curCid
    ? addressesFromDump(
        (await fetchIpfsJson(curCid, { skipHint: 'pass --from-cid <cid>' })) as TreeDump,
      )
    : [];

  // Case-insensitive dedup keyed by lowercase, values kept checksummed.
  const union = new Map<string, Hex>();
  for (const a of current) union.set(a.toLowerCase(), getAddress(a));
  const added: Hex[] = [];
  for (const a of opts.addresses) {
    const cs = getAddress(a);
    const key = cs.toLowerCase();
    if (!union.has(key)) {
      union.set(key, cs);
      added.push(cs);
    }
  }
  const addresses = [...union.values()].toSorted();

  if (added.length === 0) {
    return {
      treeRoot: buildAddressesTree(addresses).root as Hex,
      treeCid: curCid,
      added: [],
      changed: false,
    };
  }

  const { treeRoot, treeCid } = await setGateAddrs(ctx, { addresses, selector, cid: opts.cid });
  return { treeRoot, treeCid, added, changed: true };
}
