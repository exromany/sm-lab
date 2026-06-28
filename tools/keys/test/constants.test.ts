import { describe, expect, it } from 'vitest';
import { CHAINS, DEPOSIT_AMOUNT_GWEI } from '../src/constants';
import { bytesToHex, hexToBytes } from '../src/hex';

describe('constants', () => {
  it('exposes mainnet + hoodi with the SDK fork versions', () => {
    expect(CHAINS.mainnet.forkVersion).toBe('0x00000000');
    expect(CHAINS.hoodi.forkVersion).toBe('0x10000910');
    expect(CHAINS.hoodi.chainId).toBe(560048);
    expect(DEPOSIT_AMOUNT_GWEI).toBe(32_000_000_000);
  });
  it('vault addresses are 20 bytes', () => {
    expect(hexToBytes(CHAINS.mainnet.withdrawalVault).length).toBe(20);
    expect(hexToBytes(CHAINS.hoodi.withdrawalVault).length).toBe(20);
  });
});

describe('hex', () => {
  it('round-trips bytes <-> hex', () => {
    const bytes = new Uint8Array([0x00, 0x01, 0xab, 0xff]);
    expect(bytesToHex(bytes)).toBe('0x0001abff');
    expect([...hexToBytes('0x0001abff')]).toEqual([...bytes]);
    expect([...hexToBytes('0001abff')]).toEqual([...bytes]); // no-0x accepted
  });
});
