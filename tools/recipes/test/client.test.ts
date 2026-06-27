import { describe, expect, it } from 'vitest';
import { makeClient } from '../src/client';

describe('makeClient', () => {
  it('builds a viem client exposing the read/write/test actions recipes need', () => {
    const client = makeClient('http://127.0.0.1:8545');
    for (const method of [
      'getChainId',
      'readContract',
      'simulateContract',
      'writeContract',
      'setBalance',
      'impersonateAccount',
      'stopImpersonatingAccount',
      'increaseTime',
      'mine',
      'snapshot',
      'revert',
    ] as const) {
      expect(typeof (client as Record<string, unknown>)[method]).toBe('function');
    }
  });
});
