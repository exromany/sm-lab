import { StandardMerkleTree } from '@openzeppelin/merkle-tree';

/**
 * Pure, deterministic tree construction. No I/O, no network — given the same inputs these
 * functions always produce the same root, which is exactly what the Vitest suite pins.
 *
 * Three OZ StandardMerkleTree shapes, one per CSM pipeline:
 *   - addresses (vetted gate): ["address"]                      → VettedGate.setTreeParams
 *   - strikes:                 ["uint256","string","uint256[]"] → CSStrikes.processOracleReport
 *   - rewards:                 ["uint256","uint256"]            → FeeDistributor cumulative tree
 */

/** Leaf encoding for the addresses (vetted gate) tree: one address per leaf. */
export const ADDRESSES_LEAF_ENCODING = ['address'] as const;

/** Leaf encoding for the strikes tree: (nodeOperatorId, pubkey, strikes[]). */
export const STRIKES_LEAF_ENCODING = ['uint256', 'string', 'uint256[]'] as const;

/** Leaf encoding for the rewards tree: (nodeOperatorId, cumulativeShares). */
export const REWARDS_LEAF_ENCODING = ['uint256', 'uint256'] as const;

/** A single node-operator strikes record, as stored in strikes.json. */
export interface StrikesEntry {
  nodeOperatorId: number;
  pubkey: string;
  strikes: number[];
}

/** The OZ tree dump shape we pin to IPFS (kept structural to avoid leaking OZ internals). */
export type TreeDump = ReturnType<StandardMerkleTree<unknown[]>['dump']>;

/** Build the addresses (vetted gate) Merkle tree from a list of whitelisted addresses. */
export function buildAddressesTree(addresses: string[]): StandardMerkleTree<[string]> {
  return StandardMerkleTree.of(
    addresses.map((address) => [address] as [string]),
    [...ADDRESSES_LEAF_ENCODING],
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

/**
 * Build the cumulative rewards tree: one [nodeOperatorId, cumulativeShares] leaf per operator.
 *
 * Leaf values are `bigint` (not `number` like buildStrikesTree) because cumulative reward shares
 * are wei amounts that routinely overflow `Number.MAX_SAFE_INTEGER`. OZ serializes them as decimal
 * strings in `dump()` (JSON-safe). Callers shape the leaves — e.g. the FeeDistributor non-empty-proof
 * pad leaf is appended by the caller, not here (same division of labor as the addresses/strikes builders).
 */
export function buildRewardsTree(leaves: [bigint, bigint][]): StandardMerkleTree<[bigint, bigint]> {
  return StandardMerkleTree.of(leaves, [...REWARDS_LEAF_ENCODING]);
}
