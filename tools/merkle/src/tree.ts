import { StandardMerkleTree } from '@openzeppelin/merkle-tree';

/**
 * Pure, deterministic tree construction. No I/O, no network — given the same inputs these
 * functions always produce the same root, which is exactly what the Vitest suite pins.
 *
 * Two OZ StandardMerkleTree shapes, one per CSM pipeline:
 *   - ICS:     leaf type ["address"]                       → VettedGate.setTreeParams
 *   - strikes: leaf type ["uint256","string","uint256[]"]  → CSStrikes.processOracleReport
 */

/** Leaf encoding for the ICS (vetted gate) tree: one address per leaf. */
export const ICS_LEAF_ENCODING = ['address'] as const;

/** Leaf encoding for the strikes tree: (nodeOperatorId, pubkey, strikes[]). */
export const STRIKES_LEAF_ENCODING = ['uint256', 'string', 'uint256[]'] as const;

/** A single node-operator strikes record, as stored in strikes.json. */
export interface StrikesEntry {
  nodeOperatorId: number;
  pubkey: string;
  strikes: number[];
}

/** The OZ tree dump shape we pin to IPFS (kept structural to avoid leaking OZ internals). */
export type TreeDump = ReturnType<StandardMerkleTree<unknown[]>['dump']>;

/** Build the ICS Merkle tree from a list of whitelisted addresses. */
export function buildIcsTree(addresses: string[]): StandardMerkleTree<[string]> {
  return StandardMerkleTree.of(
    addresses.map((address) => [address] as [string]),
    [...ICS_LEAF_ENCODING],
  );
}

/** Build the strikes Merkle tree from node-operator strike records. */
export function buildStrikesTree(
  entries: StrikesEntry[],
): StandardMerkleTree<[number, string, number[]]> {
  return StandardMerkleTree.of(
    entries.map(({ nodeOperatorId, pubkey, strikes }) => [nodeOperatorId, pubkey, strikes]),
    [...STRIKES_LEAF_ENCODING],
  );
}
