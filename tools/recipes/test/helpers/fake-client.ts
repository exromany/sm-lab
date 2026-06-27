import type { Hex } from '@csm-lab/receipts';
import type { RecipeClient } from '../../src/client';

export interface RecordedCall {
  method: string;
  args: unknown;
}

export interface FakeClientScript {
  /** value from getChainId() (default 560048 = hoodi) */
  chainId?: number;
  /**
   * functionName → value returned by readContract, OR a function `(args) => value` for reads that
   * must vary by call args (e.g. `getNodeOperator(0n)` vs `getNodeOperator(1n)`).
   */
  reads?: Record<string, unknown>;
  /**
   * value returned by simulateContract, OR a function `(args) => value` for simulates that must
   * vary by call (e.g. seedCm's 3 `createNodeOperator` calls returning distinct noIds).
   */
  simulate?:
    | { result: unknown; request: unknown }
    | ((a?: unknown) => { result: unknown; request: unknown });
  /** id returned by snapshot() (default '0x1') */
  snapshotId?: Hex;
  /**
   * unix seconds returned by getBlock().timestamp (default 1_700_000_000n). An array is
   * ADVANCEABLE: each getBlock() pops the next entry, and the last entry sticks for further calls —
   * lets a test assert a second warp against the post-first-warp timestamp.
   */
  blockTimestamp?: bigint | bigint[];
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
  // Advanceable block timestamps: pop per getBlock() call, last value sticky.
  const timestamps = Array.isArray(script.blockTimestamp)
    ? [...script.blockTimestamp]
    : script.blockTimestamp !== undefined
      ? [script.blockTimestamp]
      : [1_700_000_000n];
  const nextTimestamp = (): bigint =>
    timestamps.length > 1 ? timestamps.shift()! : timestamps[0]!;
  const client = {
    getChainId: async () => {
      rec('getChainId', undefined);
      return script.chainId ?? 560048;
    },
    readContract: async (a: { functionName: string; args?: unknown[] }) => {
      rec('readContract', a);
      const r = script.reads?.[a.functionName];
      return typeof r === 'function' ? r(a.args) : r;
    },
    simulateContract: async (a: unknown) => {
      rec('simulateContract', a);
      return typeof script.simulate === 'function' ? script.simulate(a) : script.simulate;
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
    setNextBlockTimestamp: async (a: unknown) => {
      rec('setNextBlockTimestamp', a);
    },
    getBlock: async () => {
      rec('getBlock', undefined);
      return { timestamp: nextTimestamp() };
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
