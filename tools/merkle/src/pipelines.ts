import { buildIcsTree, buildStrikesTree } from './tree';
import { readAddressFile, readStrikesFile, writeJsonFile } from './io';
import { pinJsonToIpfs, shouldAttemptPin } from './ipfs';
import type { TreeConfig } from './io';

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
      'Warning: IPFS upload skipped — set IPFS_API_URL (e.g. a local @sm-lab/ipfs) or PINATA_API_KEY/SECRET / PINATA_JWT',
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

/** ICS: build the address tree, pin it, return `{ treeRoot, treeCid }`. */
export async function makeIcs(addressesPath: string, opts: MakeOptions = {}): Promise<MakeResult> {
  const tree = buildIcsTree(readAddressFile(addressesPath));
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
