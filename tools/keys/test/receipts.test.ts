import { describe, it, expect } from 'vitest';
import { protocolWithdrawalVault } from '../src/receipts';

const FAKE = {
  hoodi: {
    csm: {
      ChainId: 560048,
      protocol: { withdrawalVault: '0x00000000000000000000000000000000000000aa' },
    },
    cm: { ChainId: 560048 },
  },
  mainnet: { csm: { ChainId: 1 } },
} as never;

describe('protocolWithdrawalVault', () => {
  it('returns the baked withdrawalVault for a matching chainId', () => {
    expect(protocolWithdrawalVault(560048, FAKE)).toBe(
      '0x00000000000000000000000000000000000000aa',
    );
  });
  it('returns undefined when no book for that chainId has a protocol block', () => {
    expect(protocolWithdrawalVault(1, FAKE)).toBeUndefined();
  });
  it('returns undefined for an unknown chainId', () => {
    expect(protocolWithdrawalVault(999, FAKE)).toBeUndefined();
  });
});
