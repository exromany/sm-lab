import { describe, it, expect, vi, afterEach } from 'vitest';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import {
  buildAddressesTree,
  buildStrikesTree,
  buildRewardsTree,
  ADDRESSES_LEAF_ENCODING,
  STRIKES_LEAF_ENCODING,
  REWARDS_LEAF_ENCODING,
  type StrikesEntry,
} from '../src/tree';
import { makeRewards } from '../src/pipelines';

const ADDRESSES = [
  '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
];

const STRIKES: StrikesEntry[] = [
  {
    nodeOperatorId: 4,
    pubkey:
      '0x8a1c6881aa97ac4e31694e42f837cd510355fed4760ac2495bb4d4b0df4ce2ce78bb27ee145e284563cb8582f7ee14e7',
    strikes: [0, 0, 0, 0, 0, 1],
  },
  {
    nodeOperatorId: 7,
    pubkey:
      '0xb2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1',
    strikes: [1, 0, 2],
  },
];

// Pinned against `@openzeppelin/merkle-tree` output — regenerate only on a deliberate
// algorithm change, never to "make the test pass".
const ADDRESSES_ROOT = '0xff0cbba3ac8dfd35745552844b38c43c278b824d5bf0f52a51bc81d5e4e02931';
const STRIKES_ROOT = '0x773efb050b1f9108d3f18adee2a21b71faa1d05c375230d639e31be0d9cd8d38';
const REWARDS_ROOT = '0x1d08fbbe3c5d6f757c8eb1d8a1f1481ef3508fa7b8d8cdeeba724282918d61ba';

const REWARDS: [bigint, bigint][] = [
  [0n, 1000n],
  [1n, 2000n],
];
const PAD_NO_ID = (1n << 64n) - 1n; // type(uint64).max — the FeeDistributor pad-leaf id

describe('buildAddressesTree', () => {
  it('produces a stable root for fixed addresses', () => {
    expect(buildAddressesTree(ADDRESSES).root).toBe(ADDRESSES_ROOT);
  });

  it('uses the ["address"] leaf encoding', () => {
    const tree = buildAddressesTree(ADDRESSES);
    expect(ADDRESSES_LEAF_ENCODING).toEqual(['address']);
    // dump() records the leaf-value encoding the tree was built with
    expect(tree.dump().leafEncoding).toEqual(['address']);
  });

  it('round-trips: a leaf proof verifies against the root', () => {
    const tree = buildAddressesTree(ADDRESSES);
    const [entry] = ADDRESSES;
    const proof = tree.getProof([entry!]);
    expect(StandardMerkleTree.verify(tree.root, ['address'], [entry!], proof)).toBe(true);
  });

  it('is order-independent in root (OZ sorts leaves)', () => {
    const reversed = ADDRESSES.toReversed();
    expect(buildAddressesTree(reversed).root).toBe(ADDRESSES_ROOT);
  });
});

describe('buildStrikesTree', () => {
  it('produces a stable root for fixed strike records', () => {
    expect(buildStrikesTree(STRIKES).root).toBe(STRIKES_ROOT);
  });

  it('uses the ["uint256","string","uint256[]"] leaf encoding', () => {
    const tree = buildStrikesTree(STRIKES);
    expect(STRIKES_LEAF_ENCODING).toEqual(['uint256', 'string', 'uint256[]']);
    expect(tree.dump().leafEncoding).toEqual(['uint256', 'string', 'uint256[]']);
  });

  it('round-trips: a strikes leaf proof verifies against the root', () => {
    const tree = buildStrikesTree(STRIKES);
    const first = STRIKES[0]!;
    const leaf = [first.nodeOperatorId, first.pubkey, first.strikes];
    const proof = tree.getProof(leaf);
    expect(
      StandardMerkleTree.verify(tree.root, ['uint256', 'string', 'uint256[]'], leaf, proof),
    ).toBe(true);
  });
});

describe('buildRewardsTree', () => {
  it('produces a stable root for a fixed [noId, cumulativeShares] input', () => {
    expect(buildRewardsTree(REWARDS).root).toBe(REWARDS_ROOT);
  });

  it('uses the ["uint256","uint256"] leaf encoding', () => {
    const tree = buildRewardsTree(REWARDS);
    expect(REWARDS_LEAF_ENCODING).toEqual(['uint256', 'uint256']);
    expect(tree.dump().leafEncoding).toEqual(['uint256', 'uint256']);
  });

  it('round-trips: a rewards leaf proof verifies against the root', () => {
    const tree = buildRewardsTree(REWARDS);
    const leaf = [0n, 1000n];
    const proof = tree.getProof(leaf);
    expect(StandardMerkleTree.verify(tree.root, ['uint256', 'uint256'], leaf, proof)).toBe(true);
  });

  it('accepts the uint64-max pad leaf (a lone real operator + pad)', () => {
    const tree = buildRewardsTree([
      [5n, 100n],
      [PAD_NO_ID, 0n],
    ]);
    expect(tree.dump().values).toHaveLength(2);
  });
});

describe('makeRewards pipeline treeDump', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('returns a JSON-safe treeDump (leaf values are strings, not bigints)', async () => {
    // noUpload: true avoids any network calls; local-first default would attempt a fetch
    const result = await makeRewards(
      [
        [0n, 1000n],
        [1n, 2000n],
      ],
      { noUpload: true },
    );

    expect(result.treeDump).toBeDefined();
    // Values must be strings (JSON-safe), not bigints
    const firstValue = result.treeDump.values[0]?.value[0];
    expect(typeof firstValue).toBe('string');
    // JSON.stringify must not throw (the critical contract)
    expect(() => JSON.stringify(result.treeDump)).not.toThrow();
  });

  it('treeDump has the expected OZ dump shape (format + leafEncoding + values)', async () => {
    const result = await makeRewards(
      [
        [0n, 1000n],
        [1n, 2000n],
      ],
      { noUpload: true },
    );
    expect(result.treeDump).toHaveProperty('format');
    expect(result.treeDump).toHaveProperty('leafEncoding');
    expect(result.treeDump.values).toHaveLength(2);
  });
});
