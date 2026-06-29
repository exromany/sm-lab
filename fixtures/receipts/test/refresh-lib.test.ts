import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import {
  CONTRACT_SOURCES,
  readAbi,
  abiHash,
  abiVarName,
  renderAbiModule,
  checkGitRef,
  readDeploySnapshot,
  mergeManifest,
  curate,
  assertProtocol,
  CSM_SCHEMA,
  CM_SCHEMA,
  type Manifest,
} from '../scripts/refresh-lib';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'fixtures', 'out');
const deploy = path.join(here, 'fixtures', 'artifacts', 'hoodi', 'deploy-hoodi.json');

describe('CONTRACT_SOURCES', () => {
  it('maps upstream contracts to their interface artifacts', () => {
    expect(CONTRACT_SOURCES.VEBO).toBe('IVEBO');
    expect(CONTRACT_SOURCES.StakingRouter).toBe('IStakingRouter');
    expect(CONTRACT_SOURCES.Lido).toBe('ILido');
    expect(CONTRACT_SOURCES.LidoLocator).toBe('ILidoLocator');
  });
  it('maps module/suite contracts to their impl artifacts', () => {
    expect(CONTRACT_SOURCES.CSModule).toBe('CSModule');
    expect(CONTRACT_SOURCES.CuratedModule).toBe('CuratedModule');
  });
});

describe('readAbi / extractAbis', () => {
  it('reads the .abi field from out/<src>.sol/<src>.json', () => {
    const abi = readAbi(outDir, 'Foo');
    expect(abi).toEqual([
      { type: 'function', name: 'foo', inputs: [], outputs: [], stateMutability: 'view' },
    ]);
  });
  it('throws a path-bearing error when the artifact is missing', () => {
    expect(() => readAbi(outDir, 'Missing')).toThrow(/Missing\.sol\/Missing\.json/);
  });
});

describe('abiHash / abiVarName / renderAbiModule', () => {
  it('hashes deterministically (sha256 hex)', () => {
    expect(abiHash([])).toBe(abiHash([]));
    expect(abiHash([{ a: 1 }])).toMatch(/^[0-9a-f]{64}$/);
  });
  it('derives a camelCase var name', () => {
    expect(abiVarName('CSModule')).toBe('csModuleAbi');
    expect(abiVarName('VEBO')).toBe('vEBOAbi');
  });
  it('renders an as-const module', () => {
    const src = renderAbiModule('fooAbi', [{ type: 'function', name: 'foo' }]);
    expect(src).toContain('export const fooAbi =');
    expect(src.trimEnd().endsWith('as const;')).toBe(true);
  });
});

describe('checkGitRef', () => {
  it('passes when refs match', () => {
    expect(() => checkGitRef('abc', 'abc', false)).not.toThrow();
  });
  it('throws on mismatch without force', () => {
    expect(() => checkGitRef('abc', 'def', false)).toThrow(/def/);
  });
  it('passes on mismatch with force', () => {
    expect(() => checkGitRef('abc', 'def', true)).not.toThrow();
  });
});

describe('readDeploySnapshot', () => {
  it('reads the deploy json incl. git-ref', () => {
    const snap = readDeploySnapshot(deploy);
    expect(snap['git-ref']).toBe('deadbeef');
    expect(snap.CSModule).toBe('0x0000000000000000000000000000000000000001');
  });
});

describe('mergeManifest', () => {
  const base = { abiGitRef: 'r1', abiHashes: { CSModule: 'h1' }, generatedAt: 't1' };
  it('creates a manifest from null', () => {
    const m = mergeManifest(null, {
      ...base,
      snapshot: { chain: 'hoodi', module: 'csm', gitRef: 'r1' },
    });
    expect(m.snapshots).toEqual([{ chain: 'hoodi', module: 'csm', gitRef: 'r1' }]);
    expect(m.abiHashes).toEqual({ CSModule: 'h1' });
  });
  it('upserts a snapshot by (chain,module) and refreshes abi fields', () => {
    const prev: Manifest = {
      abiGitRef: 'r0',
      abiHashes: { CSModule: 'h0' },
      snapshots: [{ chain: 'hoodi', module: 'csm', gitRef: 'r0' }],
      generatedAt: 't0',
    };
    const m = mergeManifest(prev, {
      abiGitRef: 'r1',
      abiHashes: { CSModule: 'h1' },
      snapshot: { chain: 'hoodi', module: 'csm', gitRef: 'r1' },
      generatedAt: 't1',
    });
    expect(m.snapshots).toHaveLength(1);
    const snap = m.snapshots[0];
    expect(snap).toEqual({ chain: 'hoodi', module: 'csm', gitRef: 'r1' });
    expect(m.abiGitRef).toBe('r1');
  });
  it('appends a new (chain,module) snapshot', () => {
    const prev: Manifest = {
      abiGitRef: 'r1',
      abiHashes: { CSModule: 'h1' },
      snapshots: [{ chain: 'hoodi', module: 'csm', gitRef: 'r1' }],
      generatedAt: 't1',
    };
    const m = mergeManifest(prev, {
      abiGitRef: 'r1',
      abiHashes: { CSModule: 'h1' },
      snapshot: { chain: 'mainnet', module: 'csm', gitRef: 'r2' },
      generatedAt: 't2',
    });
    expect(m.snapshots).toHaveLength(2);
  });
});

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
    const { Verifier: _verifier, ...missing } = fullCsm;
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
    const { lido: _lido, ...missing } = good;
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
