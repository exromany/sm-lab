import { ByteVectorType, ContainerType, UintBigintType } from '@chainsafe/ssz';
import { DOMAIN_DEPOSIT } from './constants';
import { hexToBytes } from './hex';

export const DepositMessage = new ContainerType({
  pubkey: new ByteVectorType(48),
  withdrawal_credentials: new ByteVectorType(32),
  amount: new UintBigintType(8),
});

export const DepositData = new ContainerType({
  pubkey: new ByteVectorType(48),
  withdrawal_credentials: new ByteVectorType(32),
  amount: new UintBigintType(8),
  signature: new ByteVectorType(96),
});

export const ForkData = new ContainerType({
  current_version: new ByteVectorType(4),
  genesis_validators_root: new ByteVectorType(32),
});

export const SigningData = new ContainerType({
  object_root: new ByteVectorType(32),
  domain: new ByteVectorType(32),
});

export function computeForkDataRoot(
  currentVersion: Uint8Array,
  genesisValidatorsRoot: Uint8Array,
): Uint8Array {
  return ForkData.hashTreeRoot({
    current_version: currentVersion,
    genesis_validators_root: genesisValidatorsRoot,
  });
}

/** compute_domain(DOMAIN_DEPOSIT, forkVersion, genesisValidatorsRoot=zeros). */
export function computeDomain(forkVersion: Uint8Array): Uint8Array {
  const forkDataRoot = computeForkDataRoot(forkVersion, new Uint8Array(32));
  const domain = new Uint8Array(32);
  domain.set(hexToBytes(DOMAIN_DEPOSIT), 0);
  domain.set(forkDataRoot.slice(0, 28), 4);
  return domain;
}

export function computeSigningRoot(objectRoot: Uint8Array, domain: Uint8Array): Uint8Array {
  return SigningData.hashTreeRoot({ object_root: objectRoot, domain });
}
