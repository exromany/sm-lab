# receipts — slim / enrich / strict — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@csm-lab/receipts` commit a slim, strictly-typed, optionally on-chain-enriched address book per (chain, module), and stop two consumers from duplicating the missing protocol addresses.

**Architecture:** One runtime field schema in `refresh-lib.ts` drives curation (allowlist), a validation gate, and a drop-warning. `runRefresh` curates the deploy snapshot, then optionally enriches it with 6 LidoLocator-resolved addresses through an injected reader seam (real viem client in the script, fake in tests). `protocol` is optional; recipes `connect()` and the keys tool prefer it and fall back to today's behavior when absent.

**Tech Stack:** TypeScript (ESM, `moduleResolution: Bundler`), vitest, viem (devDependency, refresh script only), pnpm workspaces + catalog, tsdown, changesets.

## Global Constraints

- **ESM, extensionless imports.** Write `from './x'`, NOT `'./x.js'`. Use `import type` for type-only imports.
- **No DOM lib** (`lib: ["ES2023"]`); `noUncheckedIndexedAccess` is on — guard array/index access.
- **`@csm-lab/receipts` stays zero-runtime.** `viem` is a **devDependency**, imported ONLY by `scripts/refresh.ts` (not by `src/`). No runtime `import 'viem'` in shipped `dist/`.
- **Deps are pinned via pnpm `catalog:`** in `pnpm-workspace.yaml` (`viem: ^2.53.0` already present). After changing any deps run `pnpm install` (CI is `--frozen-lockfile`). **Never run two installs concurrently.**
- **Tests are hermetic** — no network, no chain. Inject readers/clients; pin deterministic outputs.
- **Lint/format:** oxlint + prettier (single quotes, width 100, trailing commas). Prefer `Array#toSorted()`.
- **Per-package done-check (run for each touched package):** `pnpm --filter <pkg> build` · `types` · `test` · `pnpm oxlint <dir>` · `pnpm prettier --check "<dir>/**/*.{ts,json}"`.
- **No Claude co-author in commits.**
- `protocol` keys use canonical LidoLocator getter names: `stakingRouter`, `validatorsExitBusOracle`, `lido`, `withdrawalQueue`, `burner`, `withdrawalVault`.

---

### Task 1: Curation schema + `curate()` + strict types

**Files:**

- Modify: `fixtures/receipts/src/types.ts` (add `ProtocolAddresses`; strict books; delete index signature + `AddressBookExtra`)
- Modify: `fixtures/receipts/scripts/refresh-lib.ts` (add `FieldSpec`, `CSM_SCHEMA`, `CM_SCHEMA`, `curate`)
- Test: `fixtures/receipts/test/refresh-lib.test.ts`

**Interfaces:**

- Produces:
  - `interface ProtocolAddresses { stakingRouter: Hex; validatorsExitBusOracle: Hex; lido: Hex; withdrawalQueue: Hex; burner: Hex; withdrawalVault: Hex }`
  - `type FieldKind = 'address' | 'address[]' | 'number' | 'string'`
  - `interface FieldSpec { kind: FieldKind; optional?: boolean }`
  - `const CSM_SCHEMA: Record<string, FieldSpec>` and `CM_SCHEMA` (insertion order = output key order)
  - `function curate(snapshot: Record<string, unknown>, schema: Record<string, FieldSpec>): { book: Record<string, unknown>; dropped: string[] }` — throws on required-missing / malformed.

- [ ] **Step 1: Write the failing tests**

Append to `fixtures/receipts/test/refresh-lib.test.ts` (add `curate`, `CSM_SCHEMA`, `CM_SCHEMA` to the existing import from `'../scripts/refresh-lib'`):

```ts
describe('curate', () => {
  const fullCsm = {
    CSModule: '0x0000000000000000000000000000000000000001',
    Accounting: '0x0000000000000000000000000000000000000002',
    FeeDistributor: '0x0000000000000000000000000000000000000003',
    FeeOracle: '0x0000000000000000000000000000000000000004',
    HashConsensus: '0x0000000000000000000000000000000000000005',
    ParametersRegistry: '0x0000000000000000000000000000000000000006',
    ValidatorStrikes: '0x0000000000000000000000000000000000000007',
    Verifier: '0x0000000000000000000000000000000000000008',
    Ejector: '0x0000000000000000000000000000000000000009',
    ExitPenalties: '0x000000000000000000000000000000000000000a',
    GateSeal: '0x000000000000000000000000000000000000000b',
    LidoLocator: '0x000000000000000000000000000000000000000c',
    VettedGate: '0x000000000000000000000000000000000000000d',
    PermissionlessGate: '0x000000000000000000000000000000000000000e',
    ChainId: 560048,
    'git-ref': 'abc123',
    DeployParams: '0xdeadbeef',
    CSModuleImpl: '0x00000000000000000000000000000000000000ff',
  };

  it('keeps allowlisted fields and reports dropped keys', () => {
    const { book, dropped } = curate(fullCsm, CSM_SCHEMA);
    expect(book.CSModule).toBe(fullCsm.CSModule);
    expect(book.ChainId).toBe(560048);
    expect(book['git-ref']).toBe('abc123');
    expect(book.DeployParams).toBeUndefined();
    expect(book.CSModuleImpl).toBeUndefined();
    expect(dropped.toSorted()).toEqual(['CSModuleImpl', 'DeployParams']);
  });

  it('emits keys in schema order (deterministic output)', () => {
    const { book } = curate(fullCsm, CSM_SCHEMA);
    expect(Object.keys(book)).toEqual(Object.keys(CSM_SCHEMA).filter((k) => k in fullCsm));
  });

  it('omits an absent optional field without throwing', () => {
    const { book } = curate(fullCsm, CSM_SCHEMA); // no IdentifiedDVTClusterGate
    expect('IdentifiedDVTClusterGate' in book).toBe(false);
  });

  it('throws when a required address is missing', () => {
    const { Verifier, ...missing } = fullCsm;
    expect(() => curate(missing, CSM_SCHEMA)).toThrow(/Verifier/);
  });

  it('throws when a required address is malformed', () => {
    expect(() => curate({ ...fullCsm, Verifier: '0xnothex' }, CSM_SCHEMA)).toThrow(/Verifier/);
  });

  it('curates the cm array field (CuratedGates) and number/string fields', () => {
    const cm = {
      CuratedModule: '0x0000000000000000000000000000000000000021',
      Accounting: '0x0000000000000000000000000000000000000022',
      FeeDistributor: '0x0000000000000000000000000000000000000023',
      FeeOracle: '0x0000000000000000000000000000000000000024',
      HashConsensus: '0x0000000000000000000000000000000000000025',
      ParametersRegistry: '0x0000000000000000000000000000000000000026',
      ValidatorStrikes: '0x0000000000000000000000000000000000000027',
      Verifier: '0x0000000000000000000000000000000000000028',
      Ejector: '0x0000000000000000000000000000000000000029',
      ExitPenalties: '0x000000000000000000000000000000000000002a',
      MetaRegistry: '0x000000000000000000000000000000000000002b',
      CuratedGateFactory: '0x000000000000000000000000000000000000002c',
      LidoLocator: '0x000000000000000000000000000000000000002d',
      CuratedGates: ['0x0000000000000000000000000000000000000030'],
      ChainId: 560048,
      'git-ref': 'abc123',
      'NOAddresses.sol': '0x00000000000000000000000000000000000000fe',
    };
    const { book, dropped } = curate(cm, CM_SCHEMA);
    expect(book.CuratedGates).toEqual(['0x0000000000000000000000000000000000000030']);
    expect(dropped).toEqual(['NOAddresses.sol']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @csm-lab/receipts test -- refresh-lib`
Expected: FAIL — `curate is not a function` / `CSM_SCHEMA` undefined.

- [ ] **Step 3: Add the strict types**

Replace the entire contents of `fixtures/receipts/src/types.ts` with:

```ts
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
```

- [ ] **Step 4: Add the schema + `curate` to refresh-lib**

Add to `fixtures/receipts/scripts/refresh-lib.ts` (after the existing imports; `Hex`-validation is a local regex — do NOT add a DOM/viem dep here):

```ts
export type FieldKind = 'address' | 'address[]' | 'number' | 'string';
export interface FieldSpec {
  kind: FieldKind;
  optional?: boolean;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

// Insertion order = output key order. Mirrors the TS interfaces in src/types.ts.
export const CSM_SCHEMA: Record<string, FieldSpec> = {
  CSModule: { kind: 'address' },
  Accounting: { kind: 'address' },
  FeeDistributor: { kind: 'address' },
  FeeOracle: { kind: 'address' },
  HashConsensus: { kind: 'address' },
  ParametersRegistry: { kind: 'address' },
  ValidatorStrikes: { kind: 'address' },
  Verifier: { kind: 'address' },
  Ejector: { kind: 'address' },
  ExitPenalties: { kind: 'address' },
  GateSeal: { kind: 'address' },
  LidoLocator: { kind: 'address' },
  VettedGate: { kind: 'address' },
  PermissionlessGate: { kind: 'address' },
  IdentifiedDVTClusterGate: { kind: 'address', optional: true },
  ChainId: { kind: 'number' },
  'git-ref': { kind: 'string' },
};

export const CM_SCHEMA: Record<string, FieldSpec> = {
  CuratedModule: { kind: 'address' },
  Accounting: { kind: 'address' },
  FeeDistributor: { kind: 'address' },
  FeeOracle: { kind: 'address' },
  HashConsensus: { kind: 'address' },
  ParametersRegistry: { kind: 'address' },
  ValidatorStrikes: { kind: 'address' },
  Verifier: { kind: 'address' },
  Ejector: { kind: 'address' },
  ExitPenalties: { kind: 'address' },
  MetaRegistry: { kind: 'address' },
  CuratedGateFactory: { kind: 'address' },
  LidoLocator: { kind: 'address' },
  CuratedGates: { kind: 'address[]' },
  ChainId: { kind: 'number' },
  'git-ref': { kind: 'string' },
};

function validateField(name: string, value: unknown, spec: FieldSpec): void {
  if (spec.kind === 'address') {
    if (typeof value !== 'string' || !ADDRESS_RE.test(value))
      throw new Error(`curate: field "${name}" is not a 20-byte address: ${String(value)}`);
  } else if (spec.kind === 'address[]') {
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !ADDRESS_RE.test(v)))
      throw new Error(`curate: field "${name}" is not an array of addresses`);
  } else if (spec.kind === 'number') {
    if (typeof value !== 'number')
      throw new Error(`curate: field "${name}" is not a number: ${String(value)}`);
  } else if (typeof value !== 'string') {
    throw new Error(`curate: field "${name}" is not a string: ${String(value)}`);
  }
}

/**
 * Allowlist-curate a deploy snapshot to the schema. Validates required fields,
 * emits in schema order, and returns the source keys that were dropped.
 */
export function curate(
  snapshot: Record<string, unknown>,
  schema: Record<string, FieldSpec>,
): { book: Record<string, unknown>; dropped: string[] } {
  const book: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(schema)) {
    const value = snapshot[name];
    if (value === undefined) {
      if (spec.optional) continue;
      throw new Error(`curate: required field "${name}" missing from snapshot`);
    }
    validateField(name, value, spec);
    book[name] = value;
  }
  const dropped = Object.keys(snapshot).filter((k) => !(k in schema));
  return { book, dropped };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @csm-lab/receipts test -- refresh-lib`
Expected: PASS (curate suite green; existing suites still green).

- [ ] **Step 6: Verify types compile**

Run: `pnpm --filter @csm-lab/receipts types`
Expected: PASS (no errors from removing the index signature).

- [ ] **Step 7: Lint + format + commit**

```bash
pnpm oxlint fixtures/receipts && \
pnpm prettier --check "fixtures/receipts/**/*.{ts,json}"
git add fixtures/receipts/src/types.ts fixtures/receipts/scripts/refresh-lib.ts fixtures/receipts/test/refresh-lib.test.ts
git commit -m "feat(receipts): allowlist curate() + strict address-book types"
```

---

### Task 2: Enrichment helper + manifest provenance

**Files:**

- Modify: `fixtures/receipts/scripts/refresh-lib.ts` (add `assertProtocol`; extend `Manifest` + `mergeManifest`)
- Test: `fixtures/receipts/test/refresh-lib.test.ts`

**Interfaces:**

- Consumes: `ProtocolAddresses` (from `../src/types`).
- Produces:
  - `function assertProtocol(raw: Record<string, unknown>): ProtocolAddresses` — validates the 6 keys are present non-zero addresses; throws otherwise.
  - `Manifest` gains `protocolResolvedAt?: Record<string, { chainId: number; block: number }>`.
  - `mergeManifest` accepts optional `protocolResolvedAt?: { key: string; chainId: number; block: number }` and carries the map forward (replace one key on enrich, preserve on skip).

- [ ] **Step 1: Write the failing tests**

Append to `fixtures/receipts/test/refresh-lib.test.ts` (add `assertProtocol` to the import):

```ts
describe('assertProtocol', () => {
  const good = {
    stakingRouter: '0x0000000000000000000000000000000000000a01',
    validatorsExitBusOracle: '0x0000000000000000000000000000000000000a02',
    lido: '0x0000000000000000000000000000000000000a03',
    withdrawalQueue: '0x0000000000000000000000000000000000000a04',
    burner: '0x0000000000000000000000000000000000000a05',
    withdrawalVault: '0x0000000000000000000000000000000000000a06',
  };
  it('returns the 6 typed protocol addresses', () => {
    expect(assertProtocol(good)).toEqual(good);
  });
  it('throws when a getter returned the zero address', () => {
    expect(() =>
      assertProtocol({ ...good, burner: '0x0000000000000000000000000000000000000000' }),
    ).toThrow(/burner/);
  });
  it('throws when a key is missing', () => {
    const { lido, ...missing } = good;
    expect(() => assertProtocol(missing)).toThrow(/lido/);
  });
});

describe('mergeManifest protocolResolvedAt', () => {
  it('records the resolved block on enrich', () => {
    const m = mergeManifest(null, {
      abiGitRef: 'r1',
      abiHashes: { CSModule: 'h1' },
      snapshot: { chain: 'hoodi', module: 'csm', gitRef: 'r1' },
      generatedAt: 't1',
      protocolResolvedAt: { key: 'hoodi/csm', chainId: 560048, block: 123 },
    });
    expect(m.protocolResolvedAt).toEqual({ 'hoodi/csm': { chainId: 560048, block: 123 } });
  });
  it('preserves a prior entry when skipped (no protocolResolvedAt passed)', () => {
    const prev: Manifest = {
      abiGitRef: 'r1',
      abiHashes: { CSModule: 'h1' },
      snapshots: [{ chain: 'hoodi', module: 'csm', gitRef: 'r1' }],
      protocolResolvedAt: { 'hoodi/csm': { chainId: 560048, block: 123 } },
      generatedAt: 't1',
    };
    const m = mergeManifest(prev, {
      abiGitRef: 'r2',
      abiHashes: { CSModule: 'h2' },
      snapshot: { chain: 'hoodi', module: 'csm', gitRef: 'r2' },
      generatedAt: 't2',
    });
    expect(m.protocolResolvedAt).toEqual({ 'hoodi/csm': { chainId: 560048, block: 123 } });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @csm-lab/receipts test -- refresh-lib`
Expected: FAIL — `assertProtocol is not a function`; `protocolResolvedAt` undefined.

- [ ] **Step 3: Implement `assertProtocol` + extend the manifest**

In `fixtures/receipts/scripts/refresh-lib.ts`, add an import of the type at the top:

```ts
import type { ProtocolAddresses } from '../src/types';
```

Add `assertProtocol` (reuse the module-level `ADDRESS_RE`):

```ts
const PROTOCOL_KEYS = [
  'stakingRouter',
  'validatorsExitBusOracle',
  'lido',
  'withdrawalQueue',
  'burner',
  'withdrawalVault',
] as const;

const ZERO = '0x0000000000000000000000000000000000000000';

/** Validate a raw locator-read map into a typed ProtocolAddresses (non-zero addresses). */
export function assertProtocol(raw: Record<string, unknown>): ProtocolAddresses {
  const out = {} as Record<string, string>;
  for (const key of PROTOCOL_KEYS) {
    const v = raw[key];
    if (typeof v !== 'string' || !ADDRESS_RE.test(v) || v.toLowerCase() === ZERO)
      throw new Error(`assertProtocol: "${key}" is not a non-zero address: ${String(v)}`);
    out[key] = v;
  }
  return out as unknown as ProtocolAddresses;
}
```

Replace the `Manifest` interface and `mergeManifest` with:

```ts
export interface Manifest {
  abiGitRef: string;
  abiHashes: Record<string, string>;
  snapshots: SnapshotRef[];
  protocolResolvedAt?: Record<string, { chainId: number; block: number }>;
  generatedAt: string;
}

export function mergeManifest(
  prev: Manifest | null,
  next: {
    abiGitRef: string;
    abiHashes: Record<string, string>;
    snapshot: SnapshotRef;
    generatedAt: string;
    protocolResolvedAt?: { key: string; chainId: number; block: number };
  },
): Manifest {
  const snapshots = (prev?.snapshots ?? []).filter(
    (s) => !(s.chain === next.snapshot.chain && s.module === next.snapshot.module),
  );
  snapshots.push(next.snapshot);

  const resolved = { ...(prev?.protocolResolvedAt ?? {}) };
  if (next.protocolResolvedAt) {
    resolved[next.protocolResolvedAt.key] = {
      chainId: next.protocolResolvedAt.chainId,
      block: next.protocolResolvedAt.block,
    };
  }

  return {
    abiGitRef: next.abiGitRef,
    abiHashes: next.abiHashes,
    snapshots: snapshots.toSorted((a, b) => {
      const ka = `${a.chain}/${a.module}`;
      const kb = `${b.chain}/${b.module}`;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    }),
    ...(Object.keys(resolved).length > 0 ? { protocolResolvedAt: resolved } : {}),
    generatedAt: next.generatedAt,
  };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @csm-lab/receipts test -- refresh-lib`
Expected: PASS (incl. the unchanged existing `mergeManifest` tests).

- [ ] **Step 5: Types + lint + format + commit**

```bash
pnpm --filter @csm-lab/receipts types && \
pnpm oxlint fixtures/receipts && \
pnpm prettier --check "fixtures/receipts/**/*.{ts,json}"
git add fixtures/receipts/scripts/refresh-lib.ts fixtures/receipts/test/refresh-lib.test.ts
git commit -m "feat(receipts): assertProtocol + manifest protocolResolvedAt provenance"
```

---

### Task 3: Wire curation + enrichment into `runRefresh` (+ viem devDep, expanded fixtures)

**Files:**

- Modify: `fixtures/receipts/scripts/refresh.ts` (curate, enrich seam, carry-forward, `--rpc`/env, real viem client)
- Modify: `fixtures/receipts/package.json` (add `viem` devDependency)
- Modify: `fixtures/receipts/test/fixtures/artifacts/hoodi/deploy-hoodi.json` (full required csm set)
- Modify: `fixtures/receipts/test/fixtures/artifacts/hoodi/upgrade-test.json` (full required csm set)
- Test: `fixtures/receipts/test/refresh.test.ts`

**Interfaces:**

- Consumes: `curate`, `CSM_SCHEMA`, `CM_SCHEMA`, `assertProtocol`, `mergeManifest` (Task 1–2); `ProtocolAddresses` (types).
- Produces:
  - `type EnrichFn = (locator: string) => Promise<{ protocol: ProtocolAddresses; chainId: number; block: number }>`
  - `RefreshOptions` gains optional `enrich?: EnrichFn`.
  - `runRefresh` writes the curated+enriched book; carries the prior file's `protocol` forward when `enrich` is absent.

- [ ] **Step 1: Expand the test fixtures**

Replace `fixtures/receipts/test/fixtures/artifacts/hoodi/deploy-hoodi.json` with the full required csm set (keep `CSModule=0x…01` and `git-ref=deadbeef` so existing assertions hold; add a dropped key to prove curation drops it):

```json
{
  "CSModule": "0x0000000000000000000000000000000000000001",
  "Accounting": "0x0000000000000000000000000000000000000002",
  "FeeDistributor": "0x0000000000000000000000000000000000000003",
  "FeeOracle": "0x0000000000000000000000000000000000000004",
  "HashConsensus": "0x0000000000000000000000000000000000000005",
  "ParametersRegistry": "0x0000000000000000000000000000000000000006",
  "ValidatorStrikes": "0x0000000000000000000000000000000000000007",
  "Verifier": "0x0000000000000000000000000000000000000008",
  "Ejector": "0x0000000000000000000000000000000000000009",
  "ExitPenalties": "0x000000000000000000000000000000000000000a",
  "GateSeal": "0x000000000000000000000000000000000000000b",
  "LidoLocator": "0x000000000000000000000000000000000000000c",
  "VettedGate": "0x000000000000000000000000000000000000000d",
  "PermissionlessGate": "0x000000000000000000000000000000000000000e",
  "ChainId": 560048,
  "DeployParams": "0xdeadbeef",
  "git-ref": "deadbeef"
}
```

Replace `fixtures/receipts/test/fixtures/artifacts/hoodi/upgrade-test.json` (keep `CSModule=0x…beef` and `git-ref=cafebabe`):

```json
{
  "CSModule": "0x000000000000000000000000000000000000beef",
  "Accounting": "0x0000000000000000000000000000000000000002",
  "FeeDistributor": "0x0000000000000000000000000000000000000003",
  "FeeOracle": "0x0000000000000000000000000000000000000004",
  "HashConsensus": "0x0000000000000000000000000000000000000005",
  "ParametersRegistry": "0x0000000000000000000000000000000000000006",
  "ValidatorStrikes": "0x0000000000000000000000000000000000000007",
  "Verifier": "0x0000000000000000000000000000000000000008",
  "Ejector": "0x0000000000000000000000000000000000000009",
  "ExitPenalties": "0x000000000000000000000000000000000000000a",
  "GateSeal": "0x000000000000000000000000000000000000000b",
  "LidoLocator": "0x000000000000000000000000000000000000000c",
  "VettedGate": "0x000000000000000000000000000000000000000d",
  "PermissionlessGate": "0x000000000000000000000000000000000000000e",
  "ChainId": 560048,
  "git-ref": "cafebabe"
}
```

- [ ] **Step 2: Write the failing tests**

Replace the body of `fixtures/receipts/test/refresh.test.ts` `describe('runRefresh', …)` by adding these two tests (keep the three existing ones; they still pass — the address file is now curated but `CSModule` is unchanged):

```ts
it('curates away non-allowlisted keys (no enrich → no protocol block)', () => {
  const res = runRefresh({
    contractsPath: fixtures,
    chain: 'hoodi',
    module: 'csm',
    pkgDir: tmpPkg,
    headRef: 'deadbeef',
    force: false,
    generatedAt: '2026-06-26T00:00:00.000Z',
  });
  const addr = JSON.parse(fs.readFileSync(res.addressFile, 'utf8'));
  expect(addr.DeployParams).toBeUndefined();
  expect(addr.protocol).toBeUndefined();
  expect(addr.FeeOracle).toBe('0x0000000000000000000000000000000000000004');
});

it('bakes the protocol block + manifest provenance when an enrich fn is provided', async () => {
  const protocol = {
    stakingRouter: '0x0000000000000000000000000000000000000a01',
    validatorsExitBusOracle: '0x0000000000000000000000000000000000000a02',
    lido: '0x0000000000000000000000000000000000000a03',
    withdrawalQueue: '0x0000000000000000000000000000000000000a04',
    burner: '0x0000000000000000000000000000000000000a05',
    withdrawalVault: '0x0000000000000000000000000000000000000a06',
  };
  const res = await runRefresh({
    contractsPath: fixtures,
    chain: 'hoodi',
    module: 'csm',
    pkgDir: tmpPkg,
    headRef: 'deadbeef',
    force: false,
    generatedAt: '2026-06-26T00:00:00.000Z',
    enrich: async (locator) => {
      expect(locator).toBe('0x000000000000000000000000000000000000000c'); // curated LidoLocator
      return { protocol, chainId: 560048, block: 42 };
    },
  });
  const addr = JSON.parse(fs.readFileSync(res.addressFile, 'utf8'));
  expect(addr.protocol).toEqual(protocol);
  const manifest = JSON.parse(fs.readFileSync(res.manifestFile, 'utf8'));
  expect(manifest.protocolResolvedAt['hoodi/csm']).toEqual({ chainId: 560048, block: 42 });
});

it('carries a prior protocol block forward when enrich is absent', () => {
  // The previous test wrote a file WITH protocol into tmpPkg; a no-enrich run must keep it.
  const res = runRefresh({
    contractsPath: fixtures,
    chain: 'hoodi',
    module: 'csm',
    pkgDir: tmpPkg,
    headRef: 'deadbeef',
    force: false,
    generatedAt: '2026-06-26T00:00:00.000Z',
  });
  const addr = JSON.parse(fs.readFileSync(res.addressFile, 'utf8'));
  expect(addr.protocol?.burner).toBe('0x0000000000000000000000000000000000000a05');
});
```

Note: `runRefresh` becomes `async`. Update the existing synchronous calls in this file to `await` (wrap their `it` callbacks in `async`), and the git-ref-mismatch test to `await expect(runRefresh({...})).rejects.toThrow(/deadbeef/)`.

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm --filter @csm-lab/receipts test -- refresh.test`
Expected: FAIL — `enrich` not used / `protocol` undefined / `runRefresh` not awaitable.

- [ ] **Step 4: Rewrite `runRefresh` (curate + enrich + carry-forward)**

In `fixtures/receipts/scripts/refresh.ts`, update the import block to pull the new helpers and the type:

```ts
import {
  extractAbis,
  abiHash,
  abiVarName,
  renderAbiModule,
  renderAbiIndex,
  checkGitRef,
  readDeploySnapshot,
  mergeManifest,
  curate,
  assertProtocol,
  CSM_SCHEMA,
  CM_SCHEMA,
  type Manifest,
  type ContractName,
} from './refresh-lib';
import type { Hex, ProtocolAddresses } from '../src/types';
```

Add the seam type and extend `RefreshOptions`:

```ts
export type EnrichFn = (
  locator: string,
) => Promise<{ protocol: ProtocolAddresses; chainId: number; block: number }>;

export interface RefreshOptions {
  contractsPath: string;
  chain: string;
  module: 'csm' | 'cm';
  pkgDir: string;
  headRef: string;
  force: boolean;
  generatedAt: string;
  configPath?: string;
  enrich?: EnrichFn;
}
```

Make `runRefresh` async and replace its step 3 + step 4 (the address write + manifest) with curation, enrichment, carry-forward, and provenance:

```ts
export async function runRefresh(opts: RefreshOptions): Promise<RefreshResult> {
  const { contractsPath, chain, module, pkgDir, headRef, force, generatedAt } = opts;

  // 1. git-ref guard.
  const snapPath = opts.configPath
    ? path.resolve(contractsPath, opts.configPath)
    : deployJsonPath(contractsPath, chain, module);
  const snapshot = readDeploySnapshot(snapPath);
  const deployRef = snapshot['git-ref'] ?? '';
  checkGitRef(headRef, deployRef, force);

  // 2. ABIs → src/abi/<name>.ts + index, and hashes for the manifest.
  const abis = extractAbis(path.join(contractsPath, 'out'));
  const abiDir = path.join(pkgDir, 'src', 'abi');
  fs.rmSync(abiDir, { recursive: true, force: true });
  const abiFiles: string[] = [];
  const abiHashes: Record<string, string> = {};
  const names = Object.keys(abis) as ContractName[];
  for (const name of names) {
    const file = path.join(abiDir, `${name}.ts`);
    writeFile(file, renderAbiModule(abiVarName(name), abis[name]));
    abiFiles.push(file);
    abiHashes[name] = abiHash(abis[name]);
  }
  writeFile(path.join(abiDir, 'index.ts'), renderAbiIndex(names));

  // 3. Curate the snapshot to the allowlist; warn on dropped keys.
  const schema = module === 'cm' ? CM_SCHEMA : CSM_SCHEMA;
  const { book, dropped } = curate(snapshot, schema);
  if (dropped.length > 0) console.warn(`  dropped ${dropped.length} key(s): ${dropped.join(', ')}`);

  // 4. Enrich protocol addresses (or carry forward the prior file's block).
  const addressFile = path.join(pkgDir, 'data', chain, `${module}.json`);
  let protocolResolvedAt: { key: string; chainId: number; block: number } | undefined;
  if (opts.enrich) {
    const { protocol, chainId, block } = await opts.enrich(book.LidoLocator as string);
    book.protocol = assertProtocol(protocol as unknown as Record<string, unknown>);
    protocolResolvedAt = { key: `${chain}/${module}`, chainId, block };
  } else {
    const prior = readPriorProtocol(addressFile);
    if (prior) book.protocol = prior;
    else console.warn('  no RPC/enrich — protocol block omitted (consumers fall back at runtime)');
  }

  // 5. Write curated+enriched book.
  writeFile(addressFile, JSON.stringify(book, null, 2) + '\n');

  // 6. Manifest (+ provenance).
  const manifestFile = path.join(pkgDir, 'data', 'manifest.json');
  const manifest = mergeManifest(readManifest(manifestFile), {
    abiGitRef: headRef,
    abiHashes,
    snapshot: { chain, module, gitRef: deployRef },
    generatedAt,
    protocolResolvedAt,
  });
  writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');

  return { abiFiles, addressFile, manifestFile };
}

function readPriorProtocol(addressFile: string): ProtocolAddresses | undefined {
  if (!fs.existsSync(addressFile)) return undefined;
  const prior = JSON.parse(fs.readFileSync(addressFile, 'utf8')) as {
    protocol?: ProtocolAddresses;
  };
  return prior.protocol;
}
```

- [ ] **Step 5: Add the RPC plumbing + real viem enrich in `main()`**

In `parseArgs`, also read the RPC and return it:

```ts
const rpcUrl =
  get('--rpc') ?? process.env[`${chain.toUpperCase()}_RPC_URL`] ?? process.env.ETH_RPC_URL;
```

Add `rpcUrl` to the return type and object. Then in `main()`, build the real `enrich` only when an RPC is present (import viem + the locator ABI lazily so non-enrich runs need neither network nor viem):

```ts
async function main(): Promise<void> {
  const { chain, module, contractsPath, force, pkgDir, configPath, rpcUrl } = parseArgs(
    process.argv.slice(2),
  );
  const headRef = execFileSync('git', ['-C', contractsPath, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();

  let enrich: EnrichFn | undefined;
  if (rpcUrl) {
    const { createPublicClient, http } = await import('viem');
    const { lidoLocatorAbi } = await import('../src/abi/LidoLocator');
    const client = createPublicClient({ transport: http(rpcUrl) });
    enrich = async (locator) => {
      const loc = { address: locator as Hex, abi: lidoLocatorAbi } as const;
      const fns = [
        'stakingRouter',
        'validatorsExitBusOracle',
        'lido',
        'withdrawalQueue',
        'burner',
        'withdrawalVault',
      ] as const;
      const values = await Promise.all(
        fns.map((functionName) => client.readContract({ ...loc, functionName })),
      );
      const protocol = assertProtocol(Object.fromEntries(fns.map((k, i) => [k, values[i]])));
      const [chainId, block] = await Promise.all([client.getChainId(), client.getBlockNumber()]);
      return { protocol, chainId, block: Number(block) };
    };
  } else {
    console.warn('⚠ no --rpc / *_RPC_URL — skipping protocol enrichment');
  }

  const res = await runRefresh({
    contractsPath,
    chain,
    module,
    pkgDir,
    headRef,
    force,
    generatedAt: new Date().toISOString(),
    configPath,
    enrich,
  });
  console.log(`refreshed ${chain}/${module}:`);
  console.log(`  ${res.abiFiles.length} abi modules`);
  console.log(`  addresses → ${res.addressFile}`);
  console.log(`  manifest  → ${res.manifestFile}`);
}
```

Update the bottom guard to await: `main().catch((e) => { console.error(e); process.exit(1); });` inside the `if (process.argv[1] && …)` block.

- [ ] **Step 6: Add viem as a devDependency + install**

Edit `fixtures/receipts/package.json` — add to `devDependencies` (alphabetical-ish, matching the existing `catalog:` style):

```json
    "viem": "catalog:",
```

Then:

```bash
pnpm install
```

Expected: lockfile updates; no errors.

- [ ] **Step 7: Run the refresh tests to verify they pass**

Run: `pnpm --filter @csm-lab/receipts test -- refresh.test`
Expected: PASS (all five tests, including curate-drop, enrich-bake, carry-forward).

- [ ] **Step 8: Full gate + commit**

```bash
pnpm --filter @csm-lab/receipts build && \
pnpm --filter @csm-lab/receipts types && \
pnpm --filter @csm-lab/receipts test && \
pnpm oxlint fixtures/receipts && \
pnpm prettier --check "fixtures/receipts/**/*.{ts,json}"
```

Verify no runtime viem leak in shipped output:

```bash
grep -rn "from 'viem'" fixtures/receipts/dist/ || echo "OK: no viem in dist"
```

Expected: `OK: no viem in dist`.

```bash
git add fixtures/receipts/scripts/refresh.ts fixtures/receipts/package.json \
  fixtures/receipts/test/refresh.test.ts \
  fixtures/receipts/test/fixtures/artifacts/hoodi/deploy-hoodi.json \
  fixtures/receipts/test/fixtures/artifacts/hoodi/upgrade-test.json \
  pnpm-lock.yaml
git commit -m "feat(receipts): curate+enrich in runRefresh; optional --rpc protocol baking"
```

---

### Task 4: Re-slim the committed data files

**Files:**

- Modify: `fixtures/receipts/data/hoodi/csm.json`
- Modify: `fixtures/receipts/data/mainnet/csm.json`
- Modify: `fixtures/receipts/data/hoodi/cm.json`
- Temp (not committed): `fixtures/receipts/scripts/_reslim.ts`

**Interfaces:**

- Consumes: `curate`, `CSM_SCHEMA`, `CM_SCHEMA` (Task 1). No network — re-curates the already-committed JSON (each committed file is itself a valid snapshot).

- [ ] **Step 1: Write the one-off re-slim script**

Create `fixtures/receipts/scripts/_reslim.ts`:

```ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { curate, CSM_SCHEMA, CM_SCHEMA } from './refresh-lib';

const pkgDir = path.dirname(fileURLToPath(new URL('.', import.meta.url)));
const targets = [
  ['data/hoodi/csm.json', CSM_SCHEMA],
  ['data/mainnet/csm.json', CSM_SCHEMA],
  ['data/hoodi/cm.json', CM_SCHEMA],
] as const;

for (const [rel, schema] of targets) {
  const file = path.join(pkgDir, rel);
  const snap = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  const existingProtocol = (snap as { protocol?: unknown }).protocol;
  const { book, dropped } = curate(snap, schema);
  if (existingProtocol) book.protocol = existingProtocol; // preserve any prior enrichment
  fs.writeFileSync(file, JSON.stringify(book, null, 2) + '\n');
  console.log(`${rel}: dropped ${dropped.length} -> ${dropped.join(', ')}`);
}
```

- [ ] **Step 2: Run it**

Run: `cd fixtures/receipts && node --import tsx scripts/_reslim.ts && cd -`
Expected: three lines listing dropped keys (e.g. `data/hoodi/csm.json: dropped 23 -> DeployParams, AccountingImpl, …`). No throw (all required fields present in every committed file).

- [ ] **Step 3: Verify the slim result**

```bash
grep -rnE "DeployParams|Impl\"|Lib\"|CircuitBreaker|NOAddresses" fixtures/receipts/data/ || echo "OK: no noise keys remain"
```

Expected: `OK: no noise keys remain`.

Confirm the books still import and tests pass:

Run: `pnpm --filter @csm-lab/receipts test && pnpm --filter @csm-lab/receipts types`
Expected: PASS.

- [ ] **Step 4: Delete the temp script + commit only the data**

```bash
rm fixtures/receipts/scripts/_reslim.ts
pnpm prettier --check "fixtures/receipts/data/**/*.json"
git add fixtures/receipts/data/hoodi/csm.json fixtures/receipts/data/mainnet/csm.json fixtures/receipts/data/hoodi/cm.json
git commit -m "chore(receipts): re-slim committed address data to the allowlist"
```

---

### Task 5: recipes `connect()` prefers the baked protocol block

**Files:**

- Modify: `tools/recipes/src/context.ts` (prefer `book.protocol`, runtime fallback)
- Modify: `tools/recipes/test/context.test.ts` (prefer-baked + fallback assertions)

**Interfaces:**

- Consumes: `CsmAddressBook.protocol` / `CmAddressBook.protocol` (`ProtocolAddresses`, Task 1).
- Produces: `connect()` behavior unchanged in shape (`ResolvedAddresses` still exposes the 5: `stakingRouter`, `vebo`, `lido`, `withdrawalQueue`, `burner`).

- [ ] **Step 1: Write the failing test (prefer-baked)**

In `tools/recipes/test/context.test.ts`, add to `describe('connect', …)`:

```ts
it('prefers the baked protocol block and performs zero locator reads', async () => {
  const { client, byMethod } = makeFakeClient({ chainId: 560048, reads: LOCATOR_READS });
  const ctx = await connect({
    module: 'csm',
    client,
    addresses: csmBook({
      protocol: {
        stakingRouter: A(0xb1),
        validatorsExitBusOracle: A(0xb2),
        lido: A(0xb3),
        withdrawalQueue: A(0xb4),
        burner: A(0xb5),
        withdrawalVault: A(0xb6),
      },
    }),
  });
  expect(ctx.addresses.stakingRouter).toBe(A(0xb1));
  expect(ctx.addresses.vebo).toBe(A(0xb2)); // validatorsExitBusOracle → vebo
  expect(ctx.addresses.withdrawalQueue).toBe(A(0xb4));
  expect(byMethod('readContract')).toHaveLength(0);
});
```

(The existing test "resolves protocol addresses from LidoLocator …" already covers the fallback path — `csmBook()` has no `protocol`, so it must still perform exactly 5 reads. Leave it unchanged.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @csm-lab/recipes test -- context`
Expected: FAIL — `readContract` called 5 times (baked block ignored), `vebo` is `A(0xa2)` not `A(0xb2)`.

- [ ] **Step 3: Implement prefer-baked in `connect()`**

In `tools/recipes/src/context.ts`, replace the body of `connect` (the `loc`/`Promise.all`/return block) with:

```ts
export async function connect(opts: ConnectOptions): Promise<Ctx> {
  const client = opts.client ?? makeClient(requireRpcUrl(opts));
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @csm-lab/recipes test -- context`
Expected: PASS (prefer-baked = 0 reads; fallback = 5 reads).

- [ ] **Step 5: Full gate + commit**

```bash
pnpm --filter @csm-lab/recipes build && \
pnpm --filter @csm-lab/recipes types && \
pnpm --filter @csm-lab/recipes test && \
pnpm oxlint tools/recipes && \
pnpm prettier --check "tools/recipes/**/*.{ts,json}"
git add tools/recipes/src/context.ts tools/recipes/test/context.test.ts
git commit -m "feat(recipes): connect() prefers baked receipts protocol block, runtime fallback"
```

---

### Task 6: keys tool prefers the baked withdrawalVault

**Files:**

- Create: `tools/keys/src/receipts.ts` (chainId → baked `withdrawalVault` lookup)
- Modify: `tools/keys/src/keys.ts` (use baked vault, fall back to constant)
- Modify: `tools/keys/package.json` (add `@csm-lab/receipts` dependency)
- Test: `tools/keys/test/receipts.test.ts` (create)

**Interfaces:**

- Consumes: `addresses`, `AddressBook` from `@csm-lab/receipts`; `CHAINS[chain].chainId` (constants).
- Produces: `function protocolWithdrawalVault(chainId: number, books?): Hex | undefined`.

- [ ] **Step 1: Add the receipts dependency + install**

Edit `tools/keys/package.json` — add to `dependencies`:

```json
    "@csm-lab/receipts": "workspace:*",
```

Then:

```bash
pnpm install
```

Expected: lockfile updates; no errors.

- [ ] **Step 2: Write the failing test**

Create `tools/keys/test/receipts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { protocolWithdrawalVault } from '../src/receipts';

const FAKE = {
  hoodi: {
    csm: {
      ChainId: 560048,
      protocol: { withdrawalVault: '0x00000000000000000000000000000000000000aa' },
    },
    cm: { ChainId: 560048 },
  },
  mainnet: { csm: { ChainId: 1 } },
} as never;

describe('protocolWithdrawalVault', () => {
  it('returns the baked withdrawalVault for a matching chainId', () => {
    expect(protocolWithdrawalVault(560048, FAKE)).toBe(
      '0x00000000000000000000000000000000000000aa',
    );
  });
  it('returns undefined when no book for that chainId has a protocol block', () => {
    expect(protocolWithdrawalVault(1, FAKE)).toBeUndefined();
  });
  it('returns undefined for an unknown chainId', () => {
    expect(protocolWithdrawalVault(999, FAKE)).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @csm-lab/keys test -- receipts`
Expected: FAIL — cannot find module `../src/receipts`.

- [ ] **Step 4: Implement the lookup**

Create `tools/keys/src/receipts.ts`:

```ts
import { addresses as RECEIPTS, type AddressBook } from '@csm-lab/receipts';
import type { Hex } from './hex';

/** The baked Lido WithdrawalVault for a chainId, or undefined if no receipts book has been enriched. */
export function protocolWithdrawalVault(
  chainId: number,
  books: typeof RECEIPTS = RECEIPTS,
): Hex | undefined {
  const all = Object.values(books).flatMap((m) => Object.values(m)) as AddressBook[];
  const match = all.find((b) => b.ChainId === chainId);
  return match?.protocol?.withdrawalVault;
}
```

Wire it into `tools/keys/src/keys.ts` — add the import and use it in `makeDepositKeys`:

```ts
import { protocolWithdrawalVault } from './receipts';
```

Replace the `const wc = …` line in `makeDepositKeys` with:

```ts
const baked = protocolWithdrawalVault(cfg.chainId);
const wc = withdrawalCredentials(type, opts.withdrawalAddress ?? baked ?? cfg.withdrawalVault);
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @csm-lab/keys test -- receipts`
Expected: PASS.

- [ ] **Step 6: Full gate + commit**

```bash
pnpm --filter @csm-lab/keys build && \
pnpm --filter @csm-lab/keys types && \
pnpm --filter @csm-lab/keys test && \
pnpm oxlint tools/keys && \
pnpm prettier --check "tools/keys/**/*.{ts,json}"
git add tools/keys/src/receipts.ts tools/keys/src/keys.ts tools/keys/package.json tools/keys/test/receipts.test.ts pnpm-lock.yaml
git commit -m "feat(keys): prefer baked receipts withdrawalVault, fall back to chain constant"
```

---

### Task 7: Docs + changeset

**Files:**

- Modify: `fixtures/receipts/README.md`
- Modify: `CLAUDE.md` (the receipts "Status" bullet)
- Create: `.changeset/receipts-slim-enrich.md`

- [ ] **Step 1: Update the receipts README**

In `fixtures/receipts/README.md`, document: (a) the curated data shape (allowlist; `DeployParams`/`*Impl`/libs dropped with a warning); (b) the optional `protocol` block + its 6 keys (canonical LidoLocator getter names); (c) running enrichment — `pnpm --filter @csm-lab/receipts refresh --chain hoodi --module csm --rpc <url>` (or `HOODI_RPC_URL` / `ETH_RPC_URL`); without an RPC, enrichment is skipped and any prior `protocol` is preserved; (d) `manifest.protocolResolvedAt` records `{ chainId, block }` per snapshot. Match the existing README's tone/sections.

- [ ] **Step 2: Update the CLAUDE.md status bullet**

In `CLAUDE.md`, edit the `6a @csm-lab/receipts` bullet to note the data is now an allowlist-curated, strictly-typed book with an optional on-chain `protocol` block (6 LidoLocator addresses, `--rpc`-gated, skip-and-carry-forward) and `manifest.protocolResolvedAt` provenance; and that recipes `connect()` and the keys tool prefer the baked block.

- [ ] **Step 3: Add the changeset**

Create `.changeset/receipts-slim-enrich.md`:

```markdown
---
'@csm-lab/receipts': minor
'@csm-lab/recipes': patch
'@csm-lab/keys': patch
---

receipts: slim committed address data to a strictly-typed allowlist (drop DeployParams, \*Impl,
linked libs), and optionally bake LidoLocator-resolved protocol addresses into a `protocol` block
during `--rpc`-gated refresh (with `manifest.protocolResolvedAt` provenance). recipes `connect()`
and the keys tool now prefer the baked block and fall back to their previous behavior when absent.
```

- [ ] **Step 4: Verify changeset status + repo-wide gates**

```bash
pnpm changeset status && \
pnpm turbo run build types test && \
pnpm format:check
```

Expected: changeset recognized; all builds/types/tests pass; format clean.

- [ ] **Step 5: Commit**

```bash
git add fixtures/receipts/README.md CLAUDE.md .changeset/receipts-slim-enrich.md
git commit -m "docs(receipts): document slim/enrich data shape + changeset"
```

---

## Follow-up (human, not part of this plan)

Once a chain RPC is available, a maintainer runs enrichment to populate the `protocol` blocks in the committed data and the `manifest.protocolResolvedAt` provenance:

```bash
HOODI_RPC_URL=… pnpm --filter @csm-lab/receipts refresh --chain hoodi --module csm
HOODI_RPC_URL=… pnpm --filter @csm-lab/receipts refresh --chain hoodi --module cm
ETH_RPC_URL=…   pnpm --filter @csm-lab/receipts refresh --chain mainnet --module csm
```

(Requires the matching `community-staking-module` checkout for the git-ref guard + ABIs, or `--force` + `--config`.) Until then, consumers fall back to runtime resolution / the keys chain constant — no breakage.

## Self-Review

**Spec coverage:** Constraint 1 (allowlist+strict) → T1. Constraint 2 (used-only 6) → T1 types + T2/T3 enrich. Constraint 3 (RPC optional, skip+carry-forward) → T3 steps 4–5. Constraint 4 (update both consumers) → T5 (connect), T6 (keys). Constraint 5 (validation gate) → T1 `curate`. Constraint 6 (provenance block) → T2 + T3. Constraint 7 (zero-runtime; viem devDep) → T3 step 6 + step 8 grep. Constraint 8 (non-breaking) → optional `protocol` + fallbacks in T5/T6 + carry-forward in T3. Data re-slim → T4. Docs/changeset → T7.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every command has an expected result.

**Type consistency:** `ProtocolAddresses` (6 keys, canonical getter names) defined in T1, consumed identically in T2 (`assertProtocol`), T3 (`EnrichFn`), T5 (`book.protocol.*`), T6 (`.protocol?.withdrawalVault`). `curate`/`CSM_SCHEMA`/`CM_SCHEMA`/`assertProtocol`/`mergeManifest` signatures match between definition (T1/T2) and use (T3/T4). `runRefresh` becomes `async` in T3 and all its call sites (tests) are updated to await in the same task.
