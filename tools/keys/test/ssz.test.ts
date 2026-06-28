import { describe, expect, it } from 'vitest';
import { CHAINS } from '../src/constants';
import { hexToBytes } from '../src/hex';
import { DepositMessage, computeDomain, computeSigningRoot } from '../src/ssz';

describe('ssz', () => {
  it('computeDomain returns 32 bytes prefixed with the deposit domain type', () => {
    const domain = computeDomain(hexToBytes(CHAINS.hoodi.forkVersion));
    expect(domain.length).toBe(32);
    expect(domain.slice(0, 4)).toEqual(new Uint8Array([0x03, 0x00, 0x00, 0x00]));
  });

  it('different fork versions produce different domains', () => {
    const a = computeDomain(hexToBytes(CHAINS.hoodi.forkVersion));
    const b = computeDomain(hexToBytes(CHAINS.mainnet.forkVersion));
    expect([...a]).not.toEqual([...b]);
  });

  it('DepositMessage.hashTreeRoot is a deterministic 32-byte root', () => {
    const msg = {
      pubkey: new Uint8Array(48),
      withdrawal_credentials: new Uint8Array(32),
      amount: 32_000_000_000n,
    };
    const r1 = DepositMessage.hashTreeRoot(msg);
    const r2 = DepositMessage.hashTreeRoot(msg);
    expect(r1.length).toBe(32);
    expect([...r1]).toEqual([...r2]);
  });

  it('computeSigningRoot returns 32 bytes', () => {
    const domain = computeDomain(hexToBytes(CHAINS.hoodi.forkVersion));
    const root = computeSigningRoot(new Uint8Array(32), domain);
    expect(root.length).toBe(32);
  });
});
