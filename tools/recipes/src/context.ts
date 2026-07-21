import {
  accountingAbi,
  addresses as DEFAULTS,
  csModuleAbi,
  curatedGateAbi,
  lidoLocatorAbi,
  vettedGateAbi,
} from '@sm-lab/receipts';
import type {
  AddressBook,
  ChainName,
  CmAddressBook,
  CsmAddressBook,
  Hex,
  ModuleName,
} from '@sm-lab/receipts';
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
  /** Override the module-suite snapshot; defaults to @sm-lab/receipts by chainId. */
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

// Curated gate address-book keys, in selector/index order (po..iodcp).
const CM_GATE_KEYS = [
  'CuratedGatePO',
  'CuratedGatePTO',
  'CuratedGatePGO',
  'CuratedGateDO',
  'CuratedGateEEO',
  'CuratedGateIODC',
  'CuratedGateIODCP',
] as const satisfies readonly (keyof CmAddressBook)[];

function defaultSnapshot(chainId: number, module: ModuleName): AddressBook {
  for (const chainKey of Object.keys(DEFAULTS) as ChainName[]) {
    const byModule = DEFAULTS[chainKey] as Partial<Record<ModuleName, AddressBook>>;
    const book = byModule[module];
    if (book && (book as { ChainId: number }).ChainId === chainId) return book;
  }
  throw new Error(
    `@sm-lab/recipes: no default snapshot for chainId=${chainId}, module=${module} — pass addresses explicitly`,
  );
}

/**
 * The only place chain / addresses / module resolve. Prefers the baked `protocol` block
 * from the address book (zero on-chain reads) and falls back to reading the five protocol
 * addresses from LidoLocator when the block is absent.
 */
export async function connect(opts: ConnectOptions): Promise<Ctx> {
  const client = opts.client ?? makeClient(requireRpcUrl(opts));
  // Recipes assume anvil's default instant mining: they write then read/simulate the
  // result in the same call (e.g. install a gate tree, then prove against it). A fork
  // launched with automine off leaves those writes pending → stale reads. Force it on.
  if (typeof client.setAutomine === 'function') {
    await client.setAutomine(true);
  }
  const chainId = await client.getChainId();
  const book = opts.addresses ?? defaultSnapshot(chainId, opts.module);

  const protocol = book.protocol
    ? {
        stakingRouter: book.protocol.stakingRouter,
        vebo: book.protocol.validatorsExitBusOracle,
        lido: book.protocol.lido,
        withdrawalQueue: book.protocol.withdrawalQueue,
        burner: book.protocol.burner,
      }
    : await resolveProtocolFromLocator(client, book.LidoLocator as Hex);

  return {
    client,
    module: opts.module,
    clMockUrl: opts.clMockUrl,
    addresses: { ...book, ...protocol } as ResolvedAddresses,
  };
}

async function resolveProtocolFromLocator(
  client: RecipeClient,
  locator: Hex,
): Promise<{ stakingRouter: Hex; vebo: Hex; lido: Hex; withdrawalQueue: Hex; burner: Hex }> {
  const loc = { address: locator, abi: lidoLocatorAbi } as const;
  const [stakingRouter, vebo, lido, withdrawalQueue, burner] = await Promise.all([
    client.readContract({ ...loc, functionName: 'stakingRouter' }),
    client.readContract({ ...loc, functionName: 'validatorsExitBusOracle' }),
    client.readContract({ ...loc, functionName: 'lido' }),
    client.readContract({ ...loc, functionName: 'withdrawalQueue' }),
    client.readContract({ ...loc, functionName: 'burner' }),
  ]);
  return { stakingRouter, vebo, lido, withdrawalQueue, burner };
}

function requireRpcUrl(opts: ConnectOptions): string {
  if (!opts.rpcUrl)
    throw new Error('@sm-lab/recipes: connect() needs rpcUrl (or an injected client)');
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
  return { address: (ctx.addresses as unknown as Record<string, Hex>)[name], abi: STATIC[name] };
}

/**
 * Resolve a gate selector to an address (the `_resolve-gate-addr` port). Accepted forms:
 * a raw `0x…` 40-hex address (any module); for csm — `ics` → IcsGate, `idvtc` →
 * IdvtcGate (v3-only; throws on pre-v3 snapshots lacking it);
 * for cm — `po|pto|pgo|do|eeo|iodc|iodcp` or a numeric index → the named curated gates.
 */
export function resolveGate(ctx: Ctx, selector: string): Hex {
  if (/^0x[0-9a-fA-F]{40}$/.test(selector)) return selector as Hex;
  if (ctx.module === 'cm') {
    const idx = CM_SELECTORS[selector] ?? (/^\d+$/.test(selector) ? Number(selector) : undefined);
    if (idx === undefined)
      throw new Error(`@sm-lab/recipes: unknown cm gate selector "${selector}"`);
    const key = CM_GATE_KEYS[idx];
    if (!key) throw new Error(`@sm-lab/recipes: cm gate index ${idx} out of range`);
    return (ctx.addresses as CmAddressBook)[key];
  }
  if (selector === 'ics') return (ctx.addresses as CsmAddressBook).IcsGate;
  if (selector === 'idvtc') {
    const g = (ctx.addresses as CsmAddressBook).IdvtcGate;
    if (!g)
      throw new Error('@sm-lab/recipes: idvtc gate not in this snapshot (v3-only; absent pre-v3)');
    return g;
  }
  throw new Error(`@sm-lab/recipes: unknown csm gate selector "${selector}"`);
}
