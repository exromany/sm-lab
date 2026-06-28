# @csm-lab/keys — BLS Deposit-Key Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@csm-lab/keys` — a pure-TypeScript tool (`csm-keys` bin + TS API) that generates real, valid BLS12-381 validator deposit data for mainnet/hoodi, replacing the external `eth-staking-smith` binary.

**Architecture:** A merkle-shaped `tools/keys` package, no chain/viem. EIP-2333 mnemonic derivation (`@chainsafe/bls-keygen`) → herumi-WASM signing (`@chainsafe/bls/herumi`) → SSZ roots + deposit domain (`@chainsafe/ssz`, transcribed from the CSM SDK's verify pipeline). Output is `{ mnemonic, keys[] }`; correctness is pinned by re-verifying every signature with the same BLS verify the widget uses.

**Tech Stack:** TypeScript (ESM, `moduleResolution: Bundler`), tsdown, vitest, `@chainsafe/bls` (herumi backend), `@chainsafe/bls-keygen`, `@chainsafe/ssz`, `@scure/bip39`, commander.

## Global Constraints

- **ESM + extensionless imports.** Write `from './x'`, never `'./x.js'`. Use `import type` for type-only imports.
- **No DOM lib** (`lib: ["ES2023"]`); `noUncheckedIndexedAccess` is on — guard array/record access and default destructures.
- **Package `tsconfig.json` uses a RELATIVE extends** (`../../packages/config/tsconfig.lib.json`), not the `@csm-lab/config` subpath.
- **Deps are version-pinned via the pnpm `catalog:`** in `pnpm-workspace.yaml`. New shared dep → add to catalog + reference `catalog:`. Run `pnpm install` after any dep change.
- **No viem, no chain, no `@csm-lab/*` runtime deps** — this package is pure crypto.
- **bin output is `.mjs`/`.d.mts`** (tsdown). `bin`/`exports`/`types` must point at `dist/*.mjs` / `dist/*.d.mts`.
- **Lint/format gates:** `oxlint <dir>` + `prettier --check` (single quotes, width 100, trailing commas). Prefer `Array#toSorted()` over `.sort()`.
- **Chains supported:** `mainnet` (chainId 1, fork_version `0x00000000`) and `hoodi` (chainId 560048, fork_version `0x10000910`). Default chain `hoodi`.
- **Per-package done-check (run in `tools/keys`):** `pnpm --filter @csm-lab/keys build` · `… types` · `… test` · `pnpm exec oxlint tools/keys` · `pnpm exec prettier --check "tools/keys/**/*.{ts,json,md}"`.

---

### Task 1: Scaffold package + deps + `hex.ts` + `constants.ts`

**Files:**

- Modify: `pnpm-workspace.yaml` (add catalog entries)
- Create: `tools/keys/package.json`
- Create: `tools/keys/tsconfig.json`
- Create: `tools/keys/tsdown.config.ts`
- Create: `tools/keys/src/hex.ts`
- Create: `tools/keys/src/constants.ts`
- Create: `tools/keys/src/index.ts` (temporary re-export, finalized in Task 5)
- Test: `tools/keys/test/constants.test.ts`

**Interfaces:**

- Produces (`hex.ts`): `type Hex = \`0x${string}\``; `hexToBytes(hex: string): Uint8Array`; `bytesToHex(bytes: Uint8Array): Hex`.
- Produces (`constants.ts`): `type ChainName = 'mainnet' | 'hoodi'`; `type WcType = '0x01' | '0x02'`; `interface ChainConfig { chainId: number; forkVersion: Hex; networkName: ChainName; withdrawalVault: Hex }`; `const CHAINS: Record<ChainName, ChainConfig>`; `const DOMAIN_DEPOSIT: Hex`; `const DEPOSIT_AMOUNT_GWEI: number`; `const DEPOSIT_CLI_VERSION: string`.

- [ ] **Step 1: Add catalog entries** — in `pnpm-workspace.yaml`, under `catalog:`, add a block (alphabetical-ish, after `@openzeppelin/merkle-tree`):

```yaml
# bls / deposit-key generation
'@chainsafe/bls': ^7.1.3
'@chainsafe/bls-keygen': ^0.4.0
'@chainsafe/ssz': ^1.3.0
'@scure/bip39': ^2.0.0
```

- [ ] **Step 2: Create `tools/keys/package.json`**

```json
{
  "name": "@csm-lab/keys",
  "version": "0.1.0",
  "type": "module",
  "description": "Real BLS12-381 validator deposit-data generator for Lido CSM (mainnet/hoodi)",
  "license": "MIT",
  "keywords": ["bls", "deposit", "validator", "csm", "lido", "eth2", "testing"],
  "bin": { "csm-keys": "dist/cli.mjs" },
  "types": "./dist/index.d.mts",
  "exports": {
    ".": {
      "types": "./dist/index.d.mts",
      "import": "./dist/index.mjs"
    }
  },
  "files": ["dist", "README.md"],
  "scripts": {
    "build": "tsdown",
    "dev": "tsdown --watch",
    "test": "vitest run",
    "types": "tsc --noEmit"
  },
  "dependencies": {
    "@chainsafe/bls": "catalog:",
    "@chainsafe/bls-keygen": "catalog:",
    "@chainsafe/ssz": "catalog:",
    "@scure/bip39": "catalog:",
    "commander": "catalog:"
  },
  "devDependencies": {
    "@csm-lab/config": "workspace:*",
    "tsdown": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:",
    "@types/node": "catalog:"
  },
  "engines": { "node": ">=20" }
}
```

- [ ] **Step 3: Create `tools/keys/tsconfig.json`**

```json
{
  "comment": "Relative extends (not the @csm-lab/config subpath) — tsdown's Rust tsconfig loader can't follow package-exports extends. tsc here is typecheck-only.",
  "extends": "../../packages/config/tsconfig.lib.json",
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: Create `tools/keys/tsdown.config.ts`** (mirrors merkle: two entries, ESM-only, Node)

```ts
import { libConfig } from '@csm-lab/config/tsdown';

// dist/index.mjs (library) + dist/cli.mjs (the `csm-keys` bin). ESM-only, Node platform.
export default libConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
  },
  format: ['esm'],
  platform: 'node',
});
```

- [ ] **Step 5: Create `tools/keys/src/hex.ts`**

```ts
export type Hex = `0x${string}`;

/** Parse a hex string (with or without 0x) into bytes. */
export function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (h.length % 2 !== 0) throw new Error(`hex string has odd length: ${hex}`);
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Serialize bytes to a 0x-prefixed lowercase hex string. */
export function bytesToHex(bytes: Uint8Array): Hex {
  let s = '0x';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s as Hex;
}
```

- [ ] **Step 6: Create `tools/keys/src/constants.ts`**

```ts
import type { Hex } from './hex';

export type ChainName = 'mainnet' | 'hoodi';
export type WcType = '0x01' | '0x02';

export interface ChainConfig {
  chainId: number;
  forkVersion: Hex; // 4-byte genesis/current fork version used in the deposit domain
  networkName: ChainName;
  withdrawalVault: Hex; // 20-byte Lido WithdrawalVault address (LidoLocator.withdrawalVault())
}

/** SSZ deposit domain type (DOMAIN_DEPOSIT), per the consensus spec. */
export const DOMAIN_DEPOSIT: Hex = '0x03000000';

/** The only deposit amount the CSM SDK validator accepts: 32 ETH in gwei. */
export const DEPOSIT_AMOUNT_GWEI = 32_000_000_000;

/** Cosmetic deposit_data.json field; not validated on-chain or by the widget. */
export const DEPOSIT_CLI_VERSION = 'csm-keys/0.1.0';

// Addresses verified against LidoLocator.withdrawalVault() on each chain.
// mainnet: well-known Lido WithdrawalVault. hoodi: matches the current csm-widget
// keysGenerator default. Re-verify if a network is re-deployed.
export const CHAINS: Record<ChainName, ChainConfig> = {
  mainnet: {
    chainId: 1,
    forkVersion: '0x00000000',
    networkName: 'mainnet',
    withdrawalVault: '0xB9D7934878B5FB9610B3fE8A5e441e8fad7E293f',
  },
  hoodi: {
    chainId: 560048,
    forkVersion: '0x10000910',
    networkName: 'hoodi',
    withdrawalVault: '0x4473dCDDbf77679A643BdB654dbd86D67F8d32f2',
  },
};
```

- [ ] **Step 7: Create temporary `tools/keys/src/index.ts`** (finalized in Task 5)

```ts
export { CHAINS, DOMAIN_DEPOSIT, DEPOSIT_AMOUNT_GWEI } from './constants';
export type { ChainName, WcType, ChainConfig } from './constants';
export { bytesToHex, hexToBytes } from './hex';
export type { Hex } from './hex';
```

- [ ] **Step 7b: Create the `tools/keys/src/cli.ts` stub** (the `cli` tsdown entry must exist to build; replaced in Task 5)

```ts
export {};
```

- [ ] **Step 8: Write the failing test** `tools/keys/test/constants.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { CHAINS, DEPOSIT_AMOUNT_GWEI } from '../src/constants';
import { bytesToHex, hexToBytes } from '../src/hex';

describe('constants', () => {
  it('exposes mainnet + hoodi with the SDK fork versions', () => {
    expect(CHAINS.mainnet.forkVersion).toBe('0x00000000');
    expect(CHAINS.hoodi.forkVersion).toBe('0x10000910');
    expect(CHAINS.hoodi.chainId).toBe(560048);
    expect(DEPOSIT_AMOUNT_GWEI).toBe(32_000_000_000);
  });
  it('vault addresses are 20 bytes', () => {
    expect(hexToBytes(CHAINS.mainnet.withdrawalVault).length).toBe(20);
    expect(hexToBytes(CHAINS.hoodi.withdrawalVault).length).toBe(20);
  });
});

describe('hex', () => {
  it('round-trips bytes <-> hex', () => {
    const bytes = new Uint8Array([0x00, 0x01, 0xab, 0xff]);
    expect(bytesToHex(bytes)).toBe('0x0001abff');
    expect([...hexToBytes('0x0001abff')]).toEqual([...bytes]);
    expect([...hexToBytes('0001abff')]).toEqual([...bytes]); // no-0x accepted
  });
});
```

- [ ] **Step 9: Install + run the test**

Run: `pnpm install && pnpm --filter @csm-lab/keys test`
Expected: PASS (3 tests). If `pnpm install` errors on a catalog version, adjust the version in `pnpm-workspace.yaml` to the nearest existing published version and re-run.

- [ ] **Step 10: Verify build + types**

Run: `pnpm --filter @csm-lab/keys build && pnpm --filter @csm-lab/keys types`
Expected: build emits `dist/index.mjs`, `dist/cli.mjs`, `dist/index.d.mts`; types clean. (The `cli.ts` stub from Step 7b satisfies the second tsdown entry.)

- [ ] **Step 11: Commit**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml tools/keys
git commit -m "feat(keys): scaffold @csm-lab/keys — constants + hex utils"
```

---

### Task 2: SSZ containers + deposit domain (`ssz.ts`)

**Files:**

- Create: `tools/keys/src/ssz.ts`
- Test: `tools/keys/test/ssz.test.ts`

**Interfaces:**

- Consumes: `DOMAIN_DEPOSIT` from `./constants`; `hexToBytes` from `./hex`.
- Produces: `DepositMessage`, `DepositData`, `ForkData`, `SigningData` (ssz `ContainerType`s); `computeForkDataRoot(currentVersion: Uint8Array, genesisValidatorsRoot: Uint8Array): Uint8Array`; `computeDomain(forkVersion: Uint8Array): Uint8Array`; `computeSigningRoot(objectRoot: Uint8Array, domain: Uint8Array): Uint8Array`.

- [ ] **Step 1: Write the failing test** `tools/keys/test/ssz.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { CHAINS } from '../src/constants';
import { hexToBytes } from '../src/hex';
import { DepositMessage, computeDomain, computeSigningRoot } from '../src/ssz';

describe('ssz', () => {
  it('computeDomain returns 32 bytes prefixed with the deposit domain type', () => {
    const domain = computeDomain(hexToBytes(CHAINS.hoodi.forkVersion));
    expect(domain.length).toBe(32);
    expect([...domain.slice(0, 4)]).toEqual([0x03, 0x00, 0x00, 0x00]);
  });

  it('different fork versions produce different domains', () => {
    const a = computeDomain(hexToBytes(CHAINS.hoodi.forkVersion));
    const b = computeDomain(hexToBytes(CHAINS.mainnet.forkVersion));
    expect([...a]).not.toEqual([...b]);
  });

  it('DepositMessage.hashTreeRoot is a deterministic 32-byte root', () => {
    const msg = {
      pubkey: new Uint8Array(48),
      withdrawal_credentials: new Uint8Array(32),
      amount: 32_000_000_000n,
    };
    const r1 = DepositMessage.hashTreeRoot(msg);
    const r2 = DepositMessage.hashTreeRoot(msg);
    expect(r1.length).toBe(32);
    expect([...r1]).toEqual([...r2]);
  });

  it('computeSigningRoot returns 32 bytes', () => {
    const domain = computeDomain(hexToBytes(CHAINS.hoodi.forkVersion));
    const root = computeSigningRoot(new Uint8Array(32), domain);
    expect(root.length).toBe(32);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @csm-lab/keys test ssz`
Expected: FAIL ("Cannot find module '../src/ssz'").

- [ ] **Step 3: Create `tools/keys/src/ssz.ts`** (transcribed from the CSM SDK `deposit-data-sdk/signature.mjs`, with `DepositData` extended to the 4-field container)

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @csm-lab/keys test ssz`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add tools/keys/src/ssz.ts tools/keys/test/ssz.test.ts
git commit -m "feat(keys): SSZ containers + deposit domain (mirrors SDK verify pipeline)"
```

---

### Task 3: Key generation core (`keys.ts`)

**Files:**

- Create: `tools/keys/src/keys.ts`
- Test: `tools/keys/test/keys.test.ts`

**Interfaces:**

- Consumes: `CHAINS`, `DEPOSIT_AMOUNT_GWEI`, `DEPOSIT_CLI_VERSION`, `ChainName`, `WcType` from `./constants`; `DepositMessage`, `DepositData`, `computeDomain`, `computeSigningRoot` from `./ssz`; `bytesToHex`, `hexToBytes`, `Hex` from `./hex`.
- Produces:
  - `interface MakeDepositKeysOptions { chain?: ChainName; count?: number; mnemonic?: string; type?: WcType; withdrawalAddress?: Hex; startIndex?: number }`
  - `interface DepositKey { pubkey: Hex; withdrawal_credentials: Hex; amount: number; signature: Hex; deposit_message_root: Hex; deposit_data_root: Hex; fork_version: Hex; network_name: ChainName; deposit_cli_version: string }`
  - `interface MakeDepositKeysResult { mnemonic: string; keys: DepositKey[] }`
  - `function withdrawalCredentials(type: WcType, address: Hex): Uint8Array`
  - `function makeDepositKeys(opts?: MakeDepositKeysOptions): Promise<MakeDepositKeysResult>`

- [ ] **Step 1: Write the failing test** `tools/keys/test/keys.test.ts` (the round-trip verify is the correctness oracle — it re-runs the exact BLS verification the widget performs)

```ts
import bls from '@chainsafe/bls/herumi';
import { describe, expect, it } from 'vitest';
import { CHAINS } from '../src/constants';
import { hexToBytes } from '../src/hex';
import { makeDepositKeys, withdrawalCredentials } from '../src/keys';
import { DepositMessage, computeDomain, computeSigningRoot } from '../src/ssz';

const MNEMONIC =
  'impact exit example acquire drastic cement usage float mesh source private bulb twenty guitar neglect';

describe('makeDepositKeys', () => {
  it('produces signatures that pass BLS verification against the deposit domain', async () => {
    const { keys } = await makeDepositKeys({ chain: 'hoodi', count: 3, mnemonic: MNEMONIC });
    expect(keys).toHaveLength(3);
    const domain = computeDomain(hexToBytes(CHAINS.hoodi.forkVersion));
    for (const k of keys) {
      const pubkey = hexToBytes(k.pubkey);
      const wc = hexToBytes(k.withdrawal_credentials);
      const sig = hexToBytes(k.signature);
      expect(pubkey.length).toBe(48);
      expect(wc.length).toBe(32);
      expect(sig.length).toBe(96);
      expect(k.amount).toBe(32_000_000_000);
      expect(k.fork_version).toBe('0x10000910');
      expect(k.network_name).toBe('hoodi');

      const messageRoot = DepositMessage.hashTreeRoot({
        pubkey,
        withdrawal_credentials: wc,
        amount: 32_000_000_000n,
      });
      // deposit_message_root must match the SDK's recomputation
      expect(k.deposit_message_root).toBe(`0x${Buffer.from(messageRoot).toString('hex')}`);
      const signingRoot = computeSigningRoot(messageRoot, domain);
      expect(bls.verify(pubkey, signingRoot, sig)).toBe(true);
    }
  });

  it('is deterministic for a given mnemonic + index, and random otherwise', async () => {
    const a = await makeDepositKeys({ chain: 'hoodi', count: 2, mnemonic: MNEMONIC });
    const b = await makeDepositKeys({ chain: 'hoodi', count: 2, mnemonic: MNEMONIC });
    expect(b.keys.map((k) => k.pubkey)).toEqual(a.keys.map((k) => k.pubkey));

    const r = await makeDepositKeys({ chain: 'hoodi', count: 1 });
    expect(r.mnemonic.split(' ')).toHaveLength(12);
    expect(r.keys[0]!.pubkey).not.toBe(a.keys[0]!.pubkey);
  });

  it('startIndex shifts the derived keys', async () => {
    const a = await makeDepositKeys({
      chain: 'hoodi',
      count: 1,
      mnemonic: MNEMONIC,
      startIndex: 0,
    });
    const b = await makeDepositKeys({
      chain: 'hoodi',
      count: 1,
      mnemonic: MNEMONIC,
      startIndex: 5,
    });
    expect(b.keys[0]!.pubkey).not.toBe(a.keys[0]!.pubkey);
  });

  it('binds withdrawal credentials to the Lido vault with the chosen type', async () => {
    const { keys } = await makeDepositKeys({ chain: 'hoodi', count: 1, mnemonic: MNEMONIC });
    const vault = CHAINS.hoodi.withdrawalVault.slice(2).toLowerCase();
    expect(keys[0]!.withdrawal_credentials.toLowerCase()).toBe(`0x01${'00'.repeat(11)}${vault}`);

    const comp = await makeDepositKeys({
      chain: 'hoodi',
      count: 1,
      mnemonic: MNEMONIC,
      type: '0x02',
    });
    expect(comp.keys[0]!.withdrawal_credentials.startsWith('0x02')).toBe(true);

    const custom = '0x000000000000000000000000000000000000dEaD';
    const ov = await makeDepositKeys({
      chain: 'hoodi',
      count: 1,
      mnemonic: MNEMONIC,
      withdrawalAddress: custom,
    });
    expect(ov.keys[0]!.withdrawal_credentials.toLowerCase().endsWith('dead')).toBe(true);
  });

  it('computes a self-consistent deposit_data_root', async () => {
    const { keys } = await makeDepositKeys({ chain: 'mainnet', count: 1, mnemonic: MNEMONIC });
    const k = keys[0]!;
    expect(k.deposit_data_root).toMatch(/^0x[0-9a-f]{64}$/);
    expect(k.fork_version).toBe('0x00000000');
    expect(k.network_name).toBe('mainnet');
  });

  it('rejects bad input', async () => {
    await expect(makeDepositKeys({ count: 0 })).rejects.toThrow();
    await expect(makeDepositKeys({ mnemonic: 'not a real mnemonic' })).rejects.toThrow();
    // @ts-expect-error unknown chain
    await expect(makeDepositKeys({ chain: 'goerli', count: 1 })).rejects.toThrow();
  });
});

describe('withdrawalCredentials', () => {
  it('builds a 32-byte 0x01 credential', () => {
    const wc = withdrawalCredentials('0x01', '0x000000000000000000000000000000000000dEaD');
    expect(wc.length).toBe(32);
    expect(wc[0]).toBe(0x01);
    expect(wc.slice(1, 12).every((b) => b === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @csm-lab/keys test keys`
Expected: FAIL ("Cannot find module '../src/keys'").

- [ ] **Step 3: Create `tools/keys/src/keys.ts`**

```ts
import bls from '@chainsafe/bls/herumi';
import { deriveEth2ValidatorKeys, deriveKeyFromMnemonic } from '@chainsafe/bls-keygen';
import { generateMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import {
  CHAINS,
  DEPOSIT_AMOUNT_GWEI,
  DEPOSIT_CLI_VERSION,
  type ChainName,
  type WcType,
} from './constants';
import { bytesToHex, hexToBytes, type Hex } from './hex';
import { DepositData, DepositMessage, computeDomain, computeSigningRoot } from './ssz';

export interface MakeDepositKeysOptions {
  chain?: ChainName;
  count?: number;
  mnemonic?: string;
  type?: WcType;
  withdrawalAddress?: Hex;
  startIndex?: number;
}

export interface DepositKey {
  pubkey: Hex;
  withdrawal_credentials: Hex;
  amount: number;
  signature: Hex;
  deposit_message_root: Hex;
  deposit_data_root: Hex;
  fork_version: Hex;
  network_name: ChainName;
  deposit_cli_version: string;
}

export interface MakeDepositKeysResult {
  mnemonic: string;
  keys: DepositKey[];
}

/** type_byte ++ 11 zero bytes ++ 20-byte eth1 address = 32-byte 0x01/0x02 credential. */
export function withdrawalCredentials(type: WcType, address: Hex): Uint8Array {
  const addr = hexToBytes(address);
  if (addr.length !== 20) {
    throw new Error(`withdrawal address must be 20 bytes, got ${addr.length}`);
  }
  const wc = new Uint8Array(32);
  wc[0] = type === '0x02' ? 0x02 : 0x01;
  wc.set(addr, 12);
  return wc;
}

export async function makeDepositKeys(
  opts: MakeDepositKeysOptions = {},
): Promise<MakeDepositKeysResult> {
  const chain = opts.chain ?? 'hoodi';
  const count = opts.count ?? 1;
  const type = opts.type ?? '0x01';
  const startIndex = opts.startIndex ?? 0;

  const cfg = CHAINS[chain];
  if (!cfg) throw new Error(`unknown chain: ${String(chain)} (expected mainnet | hoodi)`);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`count must be a positive integer, got ${count}`);
  }
  if (type !== '0x01' && type !== '0x02') {
    throw new Error(`type must be 0x01 or 0x02, got ${String(type)}`);
  }

  const mnemonic = opts.mnemonic ?? generateMnemonic(wordlist, 128);
  if (!validateMnemonic(mnemonic, wordlist)) throw new Error('invalid BIP-39 mnemonic');

  const wc = withdrawalCredentials(type, opts.withdrawalAddress ?? cfg.withdrawalVault);
  const amount = BigInt(DEPOSIT_AMOUNT_GWEI);
  const domain = computeDomain(hexToBytes(cfg.forkVersion));

  const master = deriveKeyFromMnemonic(mnemonic);
  const keys: DepositKey[] = [];
  for (let i = 0; i < count; i++) {
    const { signing } = deriveEth2ValidatorKeys(master, startIndex + i);
    const sk = bls.SecretKey.fromBytes(signing);
    const pubkey = sk.toPublicKey().toBytes();
    const messageRoot = DepositMessage.hashTreeRoot({
      pubkey,
      withdrawal_credentials: wc,
      amount,
    });
    const signingRoot = computeSigningRoot(messageRoot, domain);
    const signature = sk.sign(signingRoot).toBytes();
    const dataRoot = DepositData.hashTreeRoot({
      pubkey,
      withdrawal_credentials: wc,
      amount,
      signature,
    });
    keys.push({
      pubkey: bytesToHex(pubkey),
      withdrawal_credentials: bytesToHex(wc),
      amount: DEPOSIT_AMOUNT_GWEI,
      signature: bytesToHex(signature),
      deposit_message_root: bytesToHex(messageRoot),
      deposit_data_root: bytesToHex(dataRoot),
      fork_version: cfg.forkVersion,
      network_name: cfg.networkName,
      deposit_cli_version: DEPOSIT_CLI_VERSION,
    });
  }

  return { mnemonic, keys };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @csm-lab/keys test keys`
Expected: PASS (7 tests).

**If `import bls from '@chainsafe/bls/herumi'` fails to resolve or init** (export-map or WASM-init error), use the switchable singleton instead — replace the import and add an init before first use:

```ts
import bls, { init } from '@chainsafe/bls/switchable';
// at the top of makeDepositKeys, before any bls.* call:
await init('herumi');
```

(Same API surface; `init` is idempotent. The round-trip test is unaffected — update its import the same way.)

- [ ] **Step 5: Commit**

```bash
git add tools/keys/src/keys.ts tools/keys/test/keys.test.ts
git commit -m "feat(keys): makeDepositKeys — EIP-2333 derivation + BLS deposit signing"
```

---

### Task 4: deposit_data.json serializer (`io.ts`)

**Files:**

- Create: `tools/keys/src/io.ts`
- Test: `tools/keys/test/io.test.ts`

**Interfaces:**

- Consumes: `DepositKey` from `./keys`.
- Produces: `toDepositDataJson(keys: DepositKey[]): string`; `writeDepositDataFile(path: string, keys: DepositKey[]): void`.

- [ ] **Step 1: Write the failing test** `tools/keys/test/io.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { makeDepositKeys } from '../src/keys';
import { toDepositDataJson } from '../src/io';

const MNEMONIC =
  'impact exit example acquire drastic cement usage float mesh source private bulb twenty guitar neglect';

describe('toDepositDataJson', () => {
  it('emits an array with eth-staking-smith fields and NO 0x prefixes', async () => {
    const { keys } = await makeDepositKeys({ chain: 'hoodi', count: 2, mnemonic: MNEMONIC });
    const json = JSON.parse(toDepositDataJson(keys)) as Array<Record<string, unknown>>;
    expect(json).toHaveLength(2);
    const first = json[0]!;
    expect(first.pubkey).toMatch(/^[0-9a-f]{96}$/); // 48 bytes, no 0x
    expect(first.signature).toMatch(/^[0-9a-f]{192}$/);
    expect(first.withdrawal_credentials).toMatch(/^[0-9a-f]{64}$/);
    expect(first.amount).toBe(32_000_000_000);
    expect(first.network_name).toBe('hoodi');
    expect(first.fork_version).toBe('10000910'); // no 0x
    expect(first.deposit_cli_version).toBeTypeOf('string');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @csm-lab/keys test io`
Expected: FAIL ("Cannot find module '../src/io'").

- [ ] **Step 3: Create `tools/keys/src/io.ts`**

```ts
import { writeFileSync } from 'node:fs';
import type { DepositKey } from './keys';

const strip = (hex: string): string => (hex.startsWith('0x') ? hex.slice(2) : hex);

/**
 * Serialize keys to the eth-staking-smith / staking-deposit-cli JSON shape: a JSON array
 * with hex fields rendered WITHOUT a 0x prefix. The CSM SDK parser normalizes both forms;
 * matching the binary's exact shape keeps fixtures / diffs clean.
 */
export function toDepositDataJson(keys: DepositKey[]): string {
  const out = keys.map((k) => ({
    pubkey: strip(k.pubkey),
    withdrawal_credentials: strip(k.withdrawal_credentials),
    amount: k.amount,
    signature: strip(k.signature),
    deposit_message_root: strip(k.deposit_message_root),
    deposit_data_root: strip(k.deposit_data_root),
    fork_version: strip(k.fork_version),
    network_name: k.network_name,
    deposit_cli_version: k.deposit_cli_version,
  }));
  return JSON.stringify(out, null, 2);
}

export function writeDepositDataFile(path: string, keys: DepositKey[]): void {
  writeFileSync(path, toDepositDataJson(keys));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @csm-lab/keys test io`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add tools/keys/src/io.ts tools/keys/test/io.test.ts
git commit -m "feat(keys): deposit_data.json serializer (eth-staking-smith shape)"
```

---

### Task 5: CLI + final public surface + README + changeset

**Files:**

- Create/replace: `tools/keys/src/cli.ts` (replaces the Task 1 stub)
- Replace: `tools/keys/src/index.ts` (final public surface)
- Create: `tools/keys/README.md`
- Create: `.changeset/csm-lab-keys.md`

**Interfaces:**

- Consumes: `makeDepositKeys`, `ChainName`, `WcType`, `Hex`, `DepositKey` from `./index`/`./keys`; `toDepositDataJson`, `writeDepositDataFile` from `./io`.
- Produces: the `csm-keys` bin; the final `@csm-lab/keys` export surface.

- [ ] **Step 1: Replace `tools/keys/src/index.ts`** with the final surface

```ts
export { makeDepositKeys, withdrawalCredentials } from './keys';
export type { DepositKey, MakeDepositKeysOptions, MakeDepositKeysResult } from './keys';
export { CHAINS, DOMAIN_DEPOSIT, DEPOSIT_AMOUNT_GWEI } from './constants';
export type { ChainName, WcType, ChainConfig } from './constants';
export { toDepositDataJson, writeDepositDataFile } from './io';
export { bytesToHex, hexToBytes } from './hex';
export type { Hex } from './hex';
```

- [ ] **Step 2: Create `tools/keys/src/cli.ts`** (flat commander program — generation is the default action)

```ts
#!/usr/bin/env node

import { Command } from 'commander';
import { makeDepositKeys } from './keys';
import type { ChainName, WcType } from './constants';
import { toDepositDataJson, writeDepositDataFile } from './io';

const program = new Command()
  .name('csm-keys')
  .description('Generate real BLS validator deposit data for Lido CSM (mainnet/hoodi)')
  .option('--chain <name>', 'mainnet | hoodi', 'hoodi')
  .option('--count <n>', 'number of validators', '1')
  .option('--type <wc>', 'withdrawal credentials type: 0x01 | 0x02', '0x01')
  .option('--mnemonic <phrase>', 'BIP-39 mnemonic (random if omitted)')
  .option('--wc <address>', 'override withdrawal address (default: Lido vault)')
  .option('--start-index <n>', 'first validator index', '0')
  .option('-o, --out <path>', 'write deposit_data.json to <path> (else stdout)')
  .action(
    async (opts: {
      chain: string;
      count: string;
      type: string;
      mnemonic?: string;
      wc?: string;
      startIndex: string;
      out?: string;
    }) => {
      const { mnemonic, keys } = await makeDepositKeys({
        chain: opts.chain as ChainName,
        count: Number(opts.count),
        type: opts.type as WcType,
        mnemonic: opts.mnemonic,
        withdrawalAddress: opts.wc as `0x${string}` | undefined,
        startIndex: Number(opts.startIndex),
      });
      // Mnemonic to stderr so stdout / -o stays clean JSON.
      console.error(`mnemonic: ${mnemonic}`);
      if (opts.out) {
        writeDepositDataFile(opts.out, keys);
        console.error(`wrote ${keys.length} key(s) to ${opts.out}`);
      } else {
        console.log(toDepositDataJson(keys));
      }
    },
  );

program.parseAsync().catch((err: unknown) => {
  console.error('Error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

- [ ] **Step 3: Create `tools/keys/README.md`**

````markdown
# @csm-lab/keys

Real BLS12-381 validator **deposit-data** generator for Lido CSM (mainnet / hoodi).
Pure TypeScript — no chain, no Foundry, no external binary. Replaces `eth-staking-smith`
for csm-lab / consumer test suites.

Keys are EIP-2333/2334 derived from a BIP-39 mnemonic and signed against the deposit
domain, so they pass the CSM SDK's on-upload BLS validation.

## CLI

```bash
csm-keys --count 5                       # hoodi, 0x01 (all defaults) → JSON to stdout
csm-keys --chain mainnet --count 1
csm-keys --count 1 --type 0x02           # compounding (CM)
csm-keys --count 3 --mnemonic "..."      # reproducible
csm-keys --count 2 --wc 0xCustomAddress  # withdrawal address override
csm-keys --count 5 -o deposit_data.json  # write file (mnemonic → stderr)
```

| flag                       | default    | notes                                  |
| -------------------------- | ---------- | -------------------------------------- |
| `--chain <mainnet\|hoodi>` | `hoodi`    |                                        |
| `--count <n>`              | `1`        |                                        |
| `--type <0x01\|0x02>`      | `0x01`     | `0x02` = compounding                   |
| `--mnemonic <phrase>`      | random     | BIP-39 (128-bit when omitted)          |
| `--wc <address>`           | Lido vault | eth1 address override                  |
| `--start-index <n>`        | `0`        | first validator index                  |
| `-o, --out <path>`         | —          | write `deposit_data.json`; else stdout |

## TS API

```ts
import { makeDepositKeys, writeDepositDataFile } from '@csm-lab/keys';

const { mnemonic, keys } = await makeDepositKeys({ chain: 'hoodi', count: 5 });
writeDepositDataFile('deposit_data.json', keys);
```
````

- [ ] **Step 4: Create `.changeset/csm-lab-keys.md`**

```markdown
---
'@csm-lab/keys': minor
---

feat: @csm-lab/keys — real BLS12-381 deposit-key generator (csm-keys bin + TS API) for mainnet/hoodi, replacing the eth-staking-smith binary
```

- [ ] **Step 5: Build, then smoke-test the bin**

Run:

```bash
pnpm --filter @csm-lab/keys build
node tools/keys/dist/cli.mjs --count 1 --chain hoodi
```

Expected: a one-element JSON array on stdout (no-0x hex fields), and `mnemonic: <12 words>` on stderr.

- [ ] **Step 6: Full per-package gates**

Run:

```bash
pnpm --filter @csm-lab/keys build \
  && pnpm --filter @csm-lab/keys types \
  && pnpm --filter @csm-lab/keys test \
  && pnpm exec oxlint tools/keys \
  && pnpm exec prettier --check "tools/keys/**/*.{ts,json,md}"
```

Expected: all pass. Fix any lint/format issues (`pnpm exec prettier --write "tools/keys/**/*.{ts,json,md}"`) and re-run.

- [ ] **Step 7: Commit**

```bash
git add tools/keys/src/cli.ts tools/keys/src/index.ts tools/keys/README.md .changeset/csm-lab-keys.md
git commit -m "feat(keys): csm-keys CLI + public API + README + changeset"
```

---

## Verification (whole feature)

- [ ] `pnpm turbo run build` — all packages build (no regression).
- [ ] `pnpm turbo run test` — all packages pass.
- [ ] `node tools/keys/dist/cli.mjs --count 2 --chain hoodi -o /tmp/dd.json` writes a 2-key file; the mnemonic prints to stderr.
- [ ] Spot-check: the round-trip-verify test is green (proves widget acceptance without a chain or the binary).

## Out of scope (follow-ups, separate plans)

- Wiring `@csm-lab/recipes` `addKeys` to call `makeDepositKeys` (replaces `randomKeys`; enables real on-fork `deposit`). Needs its own verification of the CSM deposit-amount path.
- csm-widget e2e adoption (different repo): replace `tests/shared/services/keysGenerator.service.ts` + delete `tests/scripts/set_up_keys_generator.sh`.
- Optional `eth-staking-smith` cross-check fixture and a live `--rpc` withdrawal-vault resolver.

```

```
