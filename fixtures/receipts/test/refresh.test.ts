import { describe, it, expect, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runRefresh } from '../scripts/refresh';
import type { ProtocolAddresses } from '../src/types';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, 'fixtures');

// Fake contracts checkout: out/ stubs an artifact for every CONTRACT_SOURCES entry
// (extractAbis requires the full set); artifacts/ holds the hoodi deploy snapshots.
// All writes go to a temp pkg dir to keep the suite hermetic.

const tmpPkg = fs.mkdtempSync(path.join(os.tmpdir(), 'receipts-pkg-'));
afterAll(() => fs.rmSync(tmpPkg, { recursive: true, force: true }));

describe('runRefresh', () => {
  it('refuses when HEAD != snapshot git-ref (no force)', async () => {
    await expect(
      runRefresh({
        contractsPath: fixtures,
        chain: 'hoodi',
        module: 'csm',
        pkgDir: tmpPkg,
        headRef: 'wrong',
        force: false,
        generatedAt: '2026-06-26T00:00:00.000Z',
      }),
    ).rejects.toThrow(/deadbeef/);
  });

  it('writes the address snapshot + manifest when refs match (no force needed)', async () => {
    // headRef matches the fixture git-ref 'deadbeef', so checkGitRef passes without force.
    const res = await runRefresh({
      contractsPath: fixtures,
      chain: 'hoodi',
      module: 'csm',
      pkgDir: tmpPkg,
      headRef: 'deadbeef',
      force: false,
      generatedAt: '2026-06-26T00:00:00.000Z',
    });
    const addr = JSON.parse(fs.readFileSync(res.addressFile, 'utf8'));
    expect(addr.CSModule).toBe('0x0000000000000000000000000000000000000001');
    const manifest = JSON.parse(fs.readFileSync(res.manifestFile, 'utf8'));
    expect(manifest.snapshots).toContainEqual({
      chain: 'hoodi',
      module: 'csm',
      gitRef: 'deadbeef',
    });
    expect(manifest.abiGitRef).toBe('deadbeef');
    expect(Object.keys(manifest.abiHashes).length).toBeGreaterThan(0);
  });

  it('uses --config override instead of default deploy-<chain>.json', async () => {
    // upgrade-test.json has CSModule=0x…beef and git-ref=cafebabe.
    // headRef matches, so checkGitRef passes without force.
    const res = await runRefresh({
      contractsPath: fixtures,
      chain: 'hoodi',
      module: 'csm',
      pkgDir: tmpPkg,
      headRef: 'cafebabe',
      force: false,
      generatedAt: '2026-06-26T00:00:00.000Z',
      configPath: 'artifacts/hoodi/upgrade-test.json',
    });
    const addr = JSON.parse(fs.readFileSync(res.addressFile, 'utf8'));
    expect(addr.CSModule).toBe('0x000000000000000000000000000000000000beef');
    const manifest = JSON.parse(fs.readFileSync(res.manifestFile, 'utf8'));
    expect(manifest.snapshots).toContainEqual({
      chain: 'hoodi',
      module: 'csm',
      gitRef: 'cafebabe',
    });
  });

  it('curates away non-allowlisted keys (no enrich → no protocol block)', async () => {
    const res = await runRefresh({
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
    const protocol: ProtocolAddresses = {
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

  it('carries a prior protocol block forward when enrich is absent', async () => {
    // The previous test wrote a file WITH protocol into tmpPkg; a no-enrich run must keep it.
    const res = await runRefresh({
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
});
