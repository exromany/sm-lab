import { describe, it, expect } from 'vitest';
import { addresses, manifest, csModuleAbi } from '../src/index';

describe('@sm-lab/receipts public surface', () => {
  it('exposes typed address books with real addresses', () => {
    expect(addresses.hoodi.csm.CSModule).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(addresses.mainnet.csm.CSModule).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(addresses.mainnet.csm.IcsGate).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(addresses.hoodi.cm.CuratedModule).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(addresses.mainnet.cm.CuratedModule).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(addresses.hoodi.cm.CuratedGatePO).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(addresses.mainnet.cm.CuratedGateIODCP).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('exposes non-empty as-const ABIs', () => {
    expect(csModuleAbi.length).toBeGreaterThan(0);
    expect(csModuleAbi.some((e) => e.type === 'function')).toBe(true);
  });

  it('records provenance in the manifest', () => {
    expect(manifest.abiGitRef).toMatch(/^[0-9a-f]{7,40}$/);
    expect(manifest.snapshots.length).toBeGreaterThanOrEqual(3);
    expect(Object.keys(manifest.abiHashes)).toContain('CSModule');
  });
});
