export type Hex = `0x${string}`;
export type ChainName = 'hoodi' | 'mainnet';
export type ModuleName = 'csm' | 'cm';

/** Catch-all for keys not explicitly modeled (e.g. *Impl, DeployParams, git-ref). */
type AddressBookExtra = Hex | Hex[] | number | string | Record<string, unknown> | undefined;

/** CSM (and csm0x02) deploy address book. Known contracts typed as Hex. */
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
  ChainId: number;
  [key: string]: AddressBookExtra;
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
  [key: string]: AddressBookExtra;
}

/** Either module's book (generic consumers). */
export type AddressBook = CsmAddressBook | CmAddressBook;
