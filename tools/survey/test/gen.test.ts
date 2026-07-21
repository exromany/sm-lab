import { describe, it, expect } from 'vitest';
import { getAddress } from 'viem';
import { randomAddress, placeholderSignature, resolveAddress, assertAddress } from '../src/gen';

describe('gen', () => {
  it('randomAddress: lowercased valid 42-char address', () => {
    const a = randomAddress();
    expect(a).toMatch(/^0x[0-9a-f]{40}$/);
    expect(getAddress(a)).toBeDefined();
  });
  it('randomAddress: distinct across calls', () => {
    expect(randomAddress()).not.toEqual(randomAddress());
  });
  it('placeholderSignature: 65-byte hex', () => {
    expect(placeholderSignature()).toMatch(/^0x[0-9a-f]{130}$/);
  });
  it('resolveAddress: lowercases explicit checksum address', () => {
    const c = getAddress('0x' + '1'.repeat(40));
    expect(resolveAddress(c)).toEqual(c.toLowerCase());
  });
  it('resolveAddress: random when none given', () => {
    expect(resolveAddress()).toMatch(/^0x[0-9a-f]{40}$/);
  });
  it('assertAddress: throws on malformed', () => {
    expect(() => assertAddress('0xnope')).toThrow();
  });
});
