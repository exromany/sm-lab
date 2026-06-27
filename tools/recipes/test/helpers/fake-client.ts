import type { Hex } from '@csm-lab/receipts';
import type { RecipeClient } from '../../src/client';

export interface RecordedCall {
  method: string;
  args: unknown;
}

export interface FakeClientScript {
  /** value from getChainId() (default 560048 = hoodi) */
  chainId?: number;
  /** functionName → value returned by readContract */
  reads?: Record<string, unknown>;
  /** value returned by simulateContract */
  simulate?: { result: unknown; request: unknown };
  /** id returned by snapshot() (default '0x1') */
  snapshotId?: Hex;
}

export interface FakeClient {
  client: RecipeClient;
  calls: RecordedCall[];
  /** method names in call order */
  order(): string[];
  /** recorded args for each call of a method, in order */
  byMethod(method: string): unknown[];
}

/**
 * A hermetic stand-in for the viem client. Records every call and returns scripted
 * responses. Cast to RecipeClient (the real surface is far larger; recipes touch only
 * the recorded subset). Recorded args come back as `unknown` — tests cast with `as any`.
 */
export function makeFakeClient(script: FakeClientScript = {}): FakeClient {
  const calls: RecordedCall[] = [];
  const rec = (method: string, args: unknown): void => {
    calls.push({ method, args });
  };
  const client = {
    getChainId: async () => {
      rec('getChainId', undefined);
      return script.chainId ?? 560048;
    },
    readContract: async (a: { functionName: string }) => {
      rec('readContract', a);
      return script.reads?.[a.functionName];
    },
    simulateContract: async (a: unknown) => {
      rec('simulateContract', a);
      return script.simulate;
    },
    writeContract: async (a: unknown) => {
      rec('writeContract', a);
      return '0xtxhash' as Hex;
    },
    setBalance: async (a: unknown) => {
      rec('setBalance', a);
    },
    impersonateAccount: async (a: unknown) => {
      rec('impersonateAccount', a);
    },
    stopImpersonatingAccount: async (a: unknown) => {
      rec('stopImpersonatingAccount', a);
    },
    increaseTime: async (a: unknown) => {
      rec('increaseTime', a);
    },
    mine: async (a: unknown) => {
      rec('mine', a);
    },
    snapshot: async () => {
      rec('snapshot', undefined);
      return script.snapshotId ?? ('0x1' as Hex);
    },
    revert: async (a: unknown) => {
      rec('revert', a);
    },
  } as unknown as RecipeClient;

  return {
    client,
    calls,
    order: () => calls.map((c) => c.method),
    byMethod: (method) => calls.filter((c) => c.method === method).map((c) => c.args),
  };
}
