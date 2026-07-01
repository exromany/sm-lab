// Typed ABIs (abitype `as const` — full function-name/arg narrowing for viem consumers).
export * from './abi';
// Default address books per (chain, module); override at the call site in @sm-lab/recipes.
export { addresses } from './addresses';
export type {
  AddressBook,
  CsmAddressBook,
  CmAddressBook,
  Hex,
  ChainName,
  ModuleName,
  ProtocolAddresses,
} from './types';
// Provenance: contracts git-ref(s) + per-ABI sha256.
export { default as manifest } from '../data/manifest.json';
