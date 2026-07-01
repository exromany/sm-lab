import { describe, expect, it } from 'vitest';
import { randomKeys } from '../src/keys';

describe('randomKeys', () => {
  it('produces well-formed, correctly sized keys (real BLS)', async () => {
    const k = await randomKeys(2, '0x01');
    expect(k.publicKeys).toHaveLength(2);
    expect(k.signatures).toHaveLength(2);
    // hex string length = 2 ('0x') + 2 * byteLength
    for (const pk of k.publicKeys) expect(pk.length).toBe(2 + 2 * 48);
    for (const sig of k.signatures) expect(sig.length).toBe(2 + 2 * 96);
    expect(k.packedKeys.length).toBe(2 + 2 * 48 * 2);
    expect(k.packedSignatures.length).toBe(2 + 2 * 96 * 2);
  });

  it('is deterministic per seed and varies across seeds', async () => {
    const a = await randomKeys(2, '0x01');
    const b = await randomKeys(2, '0x01');
    const c = await randomKeys(2, '0x02');
    expect(a.packedKeys).toBe(b.packedKeys);
    expect(c.packedKeys).not.toBe(a.packedKeys);
  });
});
