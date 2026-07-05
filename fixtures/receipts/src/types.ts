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
  LidoLocator: Hex;
  /** ICS gate (a VettedGate contract instance). */
  IcsGate: Hex;
  PermissionlessGate: Hex;
  /** IDVTC gate (a VettedGate contract instance); v3-only, absent on pre-v3 snapshots. */
  IdvtcGate?: Hex;
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
  /** Curated gates, flattened from the deploy config's `CuratedGates` array by role. */
  CuratedGatePO: Hex;
  CuratedGatePTO: Hex;
  CuratedGatePGO: Hex;
  CuratedGateDO: Hex;
  CuratedGateEEO: Hex;
  CuratedGateIODC: Hex;
  CuratedGateIODCP: Hex;
  ChainId: number;
  'git-ref': string;
  protocol?: ProtocolAddresses;
}

/** Either module's book (generic consumers). */
export type AddressBook = CsmAddressBook | CmAddressBook;
