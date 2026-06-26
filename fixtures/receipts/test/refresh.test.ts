import { describe, it, expect, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runRefresh } from '../scripts/refresh';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, 'fixtures');

// A fake contracts checkout: out/ has Foo + IBar; artifacts/ has the hoodi deploy.
// CONTRACT_SOURCES expects the full set, so this test points at a trimmed map via
// a contracts dir whose out/ only needs the two fixtures — we assert on those by
// running against a custom outDir layout. To keep it hermetic we use a temp pkg dir.

const tmpPkg = fs.mkdtempSync(path.join(os.tmpdir(), 'receipts-pkg-'));
afterAll(() => fs.rmSync(tmpPkg, { recursive: true, force: true }));

describe('runRefresh', () => {
  it('refuses when HEAD != snapshot git-ref (no force)', () => {
    expect(() =>
      runRefresh({
        contractsPath: fixtures,
        chain: 'hoodi',
        module: 'csm',
        pkgDir: tmpPkg,
        headRef: 'wrong',
        force: false,
        generatedAt: '2026-06-26T00:00:00.000Z',
      }),
    ).toThrow(/deadbeef/);
  });

  it('writes the address snapshot + manifest when refs match (no force needed)', () => {
    // headRef matches the fixture git-ref 'deadbeef', so checkGitRef passes without force.
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
    expect(addr.CSModule).toBe('0x0000000000000000000000000000000000000001');
    const manifest = JSON.parse(fs.readFileSync(res.manifestFile, 'utf8'));
    expect(manifest.snapshots).toContainEqual({ chain: 'hoodi', module: 'csm', gitRef: 'deadbeef' });
    expect(manifest.abiGitRef).toBe('deadbeef');
    expect(Object.keys(manifest.abiHashes).length).toBeGreaterThan(0);
  });
});
