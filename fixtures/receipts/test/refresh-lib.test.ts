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
