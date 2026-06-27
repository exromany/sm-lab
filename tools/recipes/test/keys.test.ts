import { describe, expect, it } from 'vitest';
import { randomKeys } from '../src/keys';

describe('randomKeys', () => {
  it('produces well-formed, correctly sized keys', () => {
    const k = randomKeys(2, '0x01');
    expect(k.publicKeys).toHaveLength(2);
    expect(k.signatures).toHaveLength(2);
    // hex string length = 2 ('0x') + 2 * byteLength
    for (const pk of k.publicKeys) expect(pk.length).toBe(2 + 2 * 48);
    for (const sig of k.signatures) expect(sig.length).toBe(2 + 2 * 96);
    expect(k.packedKeys.length).toBe(2 + 2 * 48 * 2);
    expect(k.packedSignatures.length).toBe(2 + 2 * 96 * 2);
  });

  it('is deterministic per seed and varies across seeds', () => {
    expect(randomKeys(2, '0x01').packedKeys).toBe(randomKeys(2, '0x01').packedKeys);
    expect(randomKeys(2, '0x02').packedKeys).not.toBe(randomKeys(2, '0x01').packedKeys);
  });
});
