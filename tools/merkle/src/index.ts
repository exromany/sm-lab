// Public library surface — pure, testable building blocks plus the build+pin pipeline.
// Lets consumers (SDK / integration tests) build trees and pin to IPFS in-process instead
// of shelling out to the `sm-merkle` binary (which lives in cli/).

// Pure deterministic core
export {
  buildAddressesTree,
  buildStrikesTree,
  buildRewardsTree,
  ADDRESSES_LEAF_ENCODING,
  STRIKES_LEAF_ENCODING,
  REWARDS_LEAF_ENCODING,
} from './tree';
export type { StrikesEntry, TreeDump } from './tree';

// File I/O helpers
export {
  parseAddresses,
  readAddressFile,
  readStrikesFile,
  readJsonFile,
  writeJsonFile,
} from './io';
export type { TreeConfig } from './io';

// IPFS pinning client (env-switchable endpoint: real Pinata or @sm-lab/ipfs)
export {
  pinJsonToIpfs,
  hasPinataCredentials,
  hasCustomIpfsEndpoint,
  shouldAttemptPin,
  resolveIpfsApiUrl,
  ipfsOptionsFromEnv,
  DEFAULT_IPFS_API_URL,
  LOCAL_IPFS_API_URL,
} from './ipfs';
export type { IpfsClientOptions, PinResponse } from './ipfs';

// Build + pin pipeline (root + CID; on-chain work belongs to @sm-lab/receipts)
export { makeAddresses, makeStrikes, makeRewards } from './pipelines';
export type { MakeResult, MakeOptions, MakeRewardsResult } from './pipelines';
