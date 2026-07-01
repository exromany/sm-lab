import { buildIcsTree, buildRewardsTree, buildStrikesTree } from './tree';
import { readStrikesFile, writeJsonFile } from './io';
import { pinJsonToIpfs, shouldAttemptPin } from './ipfs';
import type { TreeConfig } from './io';
import type { TreeDump } from './tree';

/**
 * merkle's single job: build a Merkle tree from input, pin it to IPFS, and return the
 * root + CID. Pushing those on-chain (and resolving deploy addresses) is out of scope —
 * that belongs to `@sm-lab/receipts`. No `cast`, no `DEPLOY_JSON_PATH` here.
 */

export interface MakeResult {
  treeRoot: string;
  /** undefined when IPFS upload was skipped (--no-upload, or nothing configured). */
  treeCid?: string;
  /** set only when `configPath` was provided and a `{ treeRoot, treeCid }` file was written. */
  configPath?: string;
}

export interface MakeRewardsResult extends MakeResult {
  logCid?: string;
  /**
   * JSON-safe tree dump (bigint leaf values serialized as decimal strings).
   * Identical shape to OZ `StandardMerkleTree.dump()` but with string values, so
   * `JSON.stringify(treeDump)` is safe without a custom replacer.
   */
  treeDump: TreeDump;
}

export interface MakeOptions {
  /** Skip pinning to IPFS (build + return root only). */
  noUpload?: boolean;
  /** When set, also write `{ treeRoot, treeCid }` JSON here (a handoff seam for receipts/CI). */
  configPath?: string;
}

async function maybePin(
  data: unknown,
  name: string,
  noUpload?: boolean,
): Promise<string | undefined> {
  if (noUpload) return undefined;
  if (!shouldAttemptPin()) {
    console.warn(
      'Warning: IPFS upload skipped — set IPFS_API_URL pointing at real Pinata and supply PINATA_API_KEY/SECRET or PINATA_JWT. Unset IPFS_API_URL pins to local @sm-lab/ipfs (http://127.0.0.1:5001).',
    );
    return undefined;
  }
  return pinJsonToIpfs(data, name);
}

function finish(treeRoot: string, treeCid: string | undefined, configPath?: string): MakeResult {
  if (configPath) {
    const config: TreeConfig = { treeRoot, treeCid: treeCid ?? '' };
    writeJsonFile(configPath, config);
  }
  return { treeRoot, treeCid, configPath };
}

/**
 * ICS: build the address tree from a resolved address list, pin it, return `{ treeRoot, treeCid }`.
 * The CLI resolves file/inline/flag inputs to `string[]` before calling this — keeping this function
 * pure so it can be called directly from TS consumers without touching the filesystem.
 */
export async function makeIcs(addresses: string[], opts: MakeOptions = {}): Promise<MakeResult> {
  const tree = buildIcsTree(addresses);
  const treeCid = await maybePin(tree.dump(), 'merkle-tree-ics', opts.noUpload);
  return finish(tree.root, treeCid, opts.configPath);
}

/** Strikes: build the strikes tree, pin it, return `{ treeRoot, treeCid }`. */
export async function makeStrikes(
  strikesPath: string,
  opts: MakeOptions = {},
): Promise<MakeResult> {
  const tree = buildStrikesTree(readStrikesFile(strikesPath));
  const treeCid = await maybePin(tree.dump(), 'merkle-tree-strikes', opts.noUpload);
  return finish(tree.root, treeCid, opts.configPath);
}

const bigintReplacer = (_k: string, v: unknown): unknown =>
  typeof v === 'bigint' ? v.toString() : v;

/**
 * Rewards: build the cumulative rewards tree from `[nodeOperatorId, cumulativeShares]` leaves
 * (bigint values), optionally pin the tree dump and a log object, and return
 * `{ treeRoot, treeCid, logCid?, treeDump }`.
 *
 * Bigints in the tree dump and `opts.log` are serialized to decimal strings before pinning
 * (OZ `dump()` returns leaf values verbatim, which are bigints here). The returned `treeDump`
 * uses the same serialization so it is JSON-safe (string values, no BigInt).
 */
export async function makeRewards(
  leaves: [bigint, bigint][],
  opts: MakeOptions & { log?: unknown } = {},
): Promise<MakeRewardsResult> {
  const tree = buildRewardsTree(leaves);
  // Serialize bigints in the tree dump before pinning and before returning.
  // OZ dump() returns leaf values as bigints; JSON.stringify(dump) would throw without this.
  const treeDump: TreeDump = JSON.parse(JSON.stringify(tree.dump(), bigintReplacer));
  const treeCid = await maybePin(treeDump, 'merkle-tree-rewards', opts.noUpload);
  const logCid =
    opts.log !== undefined && !opts.noUpload
      ? await maybePin(JSON.parse(JSON.stringify(opts.log, bigintReplacer)), 'merkle-rewards-log')
      : undefined;
  const base = finish(tree.root, treeCid, opts.configPath);
  return logCid !== undefined ? { ...base, logCid, treeDump } : { ...base, treeDump };
}
