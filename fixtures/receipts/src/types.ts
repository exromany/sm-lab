export type Hex = `0x${string}`;
export type ChainName = 'hoodi' | 'mainnet';
export type ModuleName = 'csm' | 'cm';

/** Protocol addresses resolved on-chain from LidoLocator during refresh (optional — present iff enriched). */
export interface ProtocolAddresses {
  stakingRouter: Hex;
  validatorsExitBusOracle: Hex;
  lido: Hex;
  withdrawalQueue: Hex;
  burner: Hex;
  withdrawalVault: Hex;
}

/** CSM deploy address book — slimmed to the contracts consumers use. */
export interface CsmAddressBook {
  CSModule: Hex;
  Accounting: Hex;
  FeeDistributor: Hex;
  FeeOracle: Hex;
  HashConsensus: Hex;
  ParametersRegistry: Hex;
  ValidatorStrikes: Hex;
  Verifier: Hex;
  Ejector: Hex;
  ExitPenalties: Hex;
  GateSeal: Hex;
  LidoLocator: Hex;
  VettedGate: Hex;
  PermissionlessGate: Hex;
  /** v3-only; absent on mainnet/v2. */
  IdentifiedDVTClusterGate?: Hex;
  ChainId: number;
  'git-ref': string;
  protocol?: ProtocolAddresses;
}

/** Curated-module deploy address book. */
export interface CmAddressBook {
  CuratedModule: Hex;
  Accounting: Hex;
  FeeDistributor: Hex;
  FeeOracle: Hex;
  HashConsensus: Hex;
  ParametersRegistry: Hex;
  ValidatorStrikes: Hex;
  Verifier: Hex;
  Ejector: Hex;
  ExitPenalties: Hex;
  MetaRegistry: Hex;
  CuratedGateFactory: Hex;
  LidoLocator: Hex;
  CuratedGates: Hex[];
  ChainId: number;
  'git-ref': string;
  protocol?: ProtocolAddresses;
}

/** Either module's book (generic consumers). */
export type AddressBook = CsmAddressBook | CmAddressBook;
