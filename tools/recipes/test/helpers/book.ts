import type { CmAddressBook, CsmAddressBook, Hex, ModuleName } from '@csm-lab/receipts';
import type { Ctx, ResolvedAddresses } from '../../src/context';
import type { RecipeClient } from '../../src/client';

/** Deterministic test address from a small integer. */
export const A = (n: number): Hex => `0x${n.toString(16).padStart(40, '0')}` as Hex;

export function csmBook(overrides: Partial<CsmAddressBook> = {}): CsmAddressBook {
  return {
    CSModule: A(0x01),
    Accounting: A(0x02),
    FeeDistributor: A(0x03),
    FeeOracle: A(0x04),
    HashConsensus: A(0x05),
    ParametersRegistry: A(0x06),
    ValidatorStrikes: A(0x07),
    Verifier: A(0x08),
    Ejector: A(0x09),
    ExitPenalties: A(0x0a),
    GateSeal: A(0x0b),
    LidoLocator: A(0x0c),
    VettedGate: A(0x0d),
    PermissionlessGate: A(0x0e),
    ChainId: 560048,
    ...overrides,
  };
}

export function cmBook(overrides: Partial<CmAddressBook> = {}): CmAddressBook {
  return {
    CuratedModule: A(0x21),
    Accounting: A(0x22),
    FeeDistributor: A(0x23),
    FeeOracle: A(0x24),
    HashConsensus: A(0x25),
    ParametersRegistry: A(0x26),
    ValidatorStrikes: A(0x27),
    Verifier: A(0x28),
    Ejector: A(0x29),
    ExitPenalties: A(0x2a),
    MetaRegistry: A(0x2b),
    CuratedGateFactory: A(0x2c),
    LidoLocator: A(0x2d),
    CuratedGates: [A(0x30), A(0x31), A(0x32), A(0x33), A(0x34), A(0x35), A(0x36)],
    ChainId: 560048,
    ...overrides,
  };
}

const PROTOCOL = {
  stakingRouter: A(0xf1),
  vebo: A(0xf2),
  lido: A(0xf3),
  withdrawalQueue: A(0xf4),
  burner: A(0xf5),
};

/** Build a ctx directly (bypassing connect) for recipe unit tests. */
export function fakeCtx(
  module: ModuleName,
  client: RecipeClient,
  bookOverrides: Partial<CsmAddressBook & CmAddressBook> = {},
): Ctx {
  const book = module === 'cm' ? cmBook(bookOverrides) : csmBook(bookOverrides);
  return {
    client,
    module,
    addresses: { ...book, ...PROTOCOL } as ResolvedAddresses,
  };
}
