import {
  accountingAbi,
  addresses as DEFAULTS,
  csModuleAbi,
  curatedGateAbi,
  lidoLocatorAbi,
  vettedGateAbi,
} from '@csm-lab/receipts';
import type {
  AddressBook,
  ChainName,
  CmAddressBook,
  CsmAddressBook,
  Hex,
  ModuleName,
} from '@csm-lab/receipts';
import { makeClient, type RecipeClient } from './client';

/** Module-suite snapshot + the protocol addresses resolved on-chain by connect(). */
export type ResolvedAddresses = AddressBook & {
  stakingRouter: Hex;
  vebo: Hex;
  lido: Hex;
  withdrawalQueue: Hex;
  burner: Hex;
};

export interface Ctx {
  client: RecipeClient;
  module: ModuleName;
  addresses: ResolvedAddresses;
  clMockUrl?: string;
}

export interface ConnectOptions {
  module: ModuleName;
  /** Required unless `client` is injected. */
  rpcUrl?: string;
  /** Inject a prebuilt client (tests, or a shared client). */
  client?: RecipeClient;
  /** Override the module-suite snapshot; defaults to @csm-lab/receipts by chainId. */
  addresses?: AddressBook;
  clMockUrl?: string;
}

export type CsmGateSelector = 'ics' | 'idvtc';
export type CmGateSelector = 'po' | 'pto' | 'pgo' | 'do' | 'eeo' | 'iodc' | 'iodcp';
export type GateSelector = CsmGateSelector | CmGateSelector;

const CM_SELECTORS: Record<string, number> = {
  po: 0,
  pto: 1,
  pgo: 2,
  do: 3,
  eeo: 4,
  iodc: 5,
  iodcp: 6,
};

function defaultSnapshot(chainId: number, module: ModuleName): AddressBook {
  for (const chainKey of Object.keys(DEFAULTS) as ChainName[]) {
    const byModule = DEFAULTS[chainKey] as Partial<Record<ModuleName, AddressBook>>;
    const book = byModule[module];
    if (book && (book as { ChainId: number }).ChainId === chainId) return book;
  }
  throw new Error(
    `@csm-lab/recipes: no default snapshot for chainId=${chainId}, module=${module} — pass addresses explicitly`,
  );
}

/**
 * The only place chain / addresses / module resolve. Reads the five protocol addresses
 * from LidoLocator on-chain (they are absent from the vendored deploy snapshots) and
 * merges them onto the module-suite book.
 */
export async function connect(opts: ConnectOptions): Promise<Ctx> {
  const client = opts.client ?? makeClient(requireRpcUrl(opts));
  const chainId = await client.getChainId();
  const book = opts.addresses ?? defaultSnapshot(chainId, opts.module);
  const loc = { address: book.LidoLocator as Hex, abi: lidoLocatorAbi } as const;

  const [stakingRouter, vebo, lido, withdrawalQueue, burner] = await Promise.all([
    client.readContract({ ...loc, functionName: 'stakingRouter' }),
    client.readContract({ ...loc, functionName: 'validatorsExitBusOracle' }),
    client.readContract({ ...loc, functionName: 'lido' }),
    client.readContract({ ...loc, functionName: 'withdrawalQueue' }),
    client.readContract({ ...loc, functionName: 'burner' }),
  ]);

  return {
    client,
    module: opts.module,
    clMockUrl: opts.clMockUrl,
    addresses: { ...book, stakingRouter, vebo, lido, withdrawalQueue, burner } as ResolvedAddresses,
  };
}

function requireRpcUrl(opts: ConnectOptions): string {
  if (!opts.rpcUrl)
    throw new Error('@csm-lab/recipes: connect() needs rpcUrl (or an injected client)');
  return opts.rpcUrl;
}

const STATIC = {
  Accounting: accountingAbi,
  VettedGate: vettedGateAbi,
  CuratedGate: curatedGateAbi,
  LidoLocator: lidoLocatorAbi,
} as const;
type StaticName = keyof typeof STATIC;

export function contract(ctx: Ctx, name: 'module'): { address: Hex; abi: typeof csModuleAbi };
export function contract<N extends StaticName>(
  ctx: Ctx,
  name: N,
): { address: Hex; abi: (typeof STATIC)[N] };
export function contract(ctx: Ctx, name: StaticName | 'module') {
  if (name === 'module') {
    // csModuleAbi anchors the shared IBaseModule surface (getNodeOperator,
    // addValidatorKeysETH, …) for BOTH modules — those fragments are byte-identical
    // across CSModule/CuratedModule, so selectors and decoding match. Only the ADDRESS
    // switches by ctx.module.
    const address = (
      ctx.module === 'cm'
        ? (ctx.addresses as CmAddressBook).CuratedModule
        : (ctx.addresses as CsmAddressBook).CSModule
    ) as Hex;
    return { address, abi: csModuleAbi };
  }
  return { address: ctx.addresses[name] as Hex, abi: STATIC[name] };
}

/**
 * Resolve a gate selector to an address (the `_resolve-gate-addr` port). Accepted forms:
 * a raw `0x…` 40-hex address (any module); for csm — `ics` → VettedGate, `idvtc` →
 * IdentifiedDVTClusterGate (v3-only; throws on snapshots lacking it, e.g. mainnet/v2);
 * for cm — `po|pto|pgo|do|eeo|iodc|iodcp` or a numeric index → `CuratedGates[0..6]`.
 */
export function resolveGate(ctx: Ctx, selector: string): Hex {
  if (/^0x[0-9a-fA-F]{40}$/.test(selector)) return selector as Hex;
  if (ctx.module === 'cm') {
    const idx = CM_SELECTORS[selector] ?? (/^\d+$/.test(selector) ? Number(selector) : undefined);
    if (idx === undefined)
      throw new Error(`@csm-lab/recipes: unknown cm gate selector "${selector}"`);
    const gate = (ctx.addresses as CmAddressBook).CuratedGates[idx];
    if (!gate) throw new Error(`@csm-lab/recipes: cm gate index ${idx} out of range`);
    return gate;
  }
  if (selector === 'ics') return (ctx.addresses as CsmAddressBook).VettedGate;
  if (selector === 'idvtc') {
    const g = (ctx.addresses as CsmAddressBook).IdentifiedDVTClusterGate;
    if (!g)
      throw new Error(
        '@csm-lab/recipes: idvtc gate not in this snapshot (v3-only; absent on mainnet/v2)',
      );
    return g;
  }
  throw new Error(`@csm-lab/recipes: unknown csm gate selector "${selector}"`);
}
