import { concat, keccak256, toHex } from 'viem';
import { describe, expect, it } from 'vitest';
import { deriveAddress } from '../src/derive';

describe('deriveAddress', () => {
  it('is deterministic, label- and seed-sensitive', () => {
    const seed = `0x${'01'.repeat(32)}` as const;
    const a = deriveAddress(seed, 'csm-operator');
    expect(a).toBe(deriveAddress(seed, 'csm-operator'));
    expect(a).toMatch(/^0x[0-9a-f]{40}$/);
    expect(deriveAddress(seed, 'other')).not.toBe(a);
    expect(deriveAddress(`0x${'02'.repeat(32)}`, 'csm-operator')).not.toBe(a);
  });

  it('matches the former cm deriveOperatorAddress formula (seedCm compat)', () => {
    const seed = `0x${'aa'.repeat(32)}` as const;
    const h = keccak256(concat([seed, toHex('cm-operator-0')]));
    expect(deriveAddress(seed, 'cm-operator-0')).toBe(`0x${h.slice(-40)}`);
  });
});
