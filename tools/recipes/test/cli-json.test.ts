// tools/recipes/test/cli-json.test.ts
// Hermetic tests for the --json contract on real named commands via buildProgram.
//
// Contract: with --json → exactly one JSON value to stdout (2-space, bigints as strings).
//           without --json → human text to stdout.
//           errors → stderr only (exit 1); nothing to stdout.
import { describe, expect, it, vi } from 'vitest';
import { buildProgram } from '../src/cli/program';
import type { Ctx } from '../src/context';
import { csmBook } from './helpers/book';
import type { ResolvedAddresses } from '../src/context';
import { makeFakeClient } from './helpers/fake-client';

/**
 * run() in define.ts is fire-and-forget (returns void, not Promise), so commander's
 * parseAsync resolves before the action's async continuation runs. A setTimeout(0) tick
 * flushes the pending microtask queue so spies capture the console.log calls.
 */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const PROTOCOL = {
  stakingRouter: '0x' + 'f1'.repeat(20),
  vebo: '0x' + 'f2'.repeat(20),
  lido: '0x' + 'f3'.repeat(20),
  withdrawalQueue: '0x' + 'f4'.repeat(20),
  burner: '0x' + 'f5'.repeat(20),
};

// operator-info result: numbers/strings/bools only — no bigints (they'd need the replacer)
const OPERATOR_INFO = {
  totalAddedKeys: 3,
  totalWithdrawnKeys: 0,
  totalDepositedKeys: 2,
  totalVettedKeys: 3,
  stuckValidatorsCount: 0,
  depositableValidatorsCount: 1,
  targetLimit: 0,
  targetLimitMode: 0,
  totalExitedKeys: 0,
  enqueuedCount: 0,
  managerAddress: '0x' + 'aa'.repeat(20),
  proposedManagerAddress: '0x' + '00'.repeat(20),
  rewardAddress: '0x' + 'bb'.repeat(20),
  proposedRewardAddress: '0x' + '00'.repeat(20),
  extendedManagerPermissions: false,
  usedPriorityQueue: false,
};

// snapshot returns a Hex id
const SNAPSHOT_ID = '0xdeadbeef' as `0x${string}`;

// get-key-balance calls getKeyAllocatedBalances and returns balances[0] (bigint)
const KEY_BALANCE = 32_000_000_000_000_000_000n;

function makeProgram(reads: Record<string, unknown> = {}, snapshotId: `0x${string}` = SNAPSHOT_ID) {
  const { client } = makeFakeClient({ reads, snapshotId });
  const book = csmBook();
  const fakeCtx: Ctx = {
    client,
    module: 'csm',
    addresses: { ...book, ...PROTOCOL } as ResolvedAddresses,
  };
  const fakeConnect = vi.fn(async () => fakeCtx);
  const prog = buildProgram(fakeConnect)
    .exitOverride()
    .configureOutput({ writeOut: () => undefined, writeErr: () => undefined });
  return { prog };
}

describe('--json contract: operator-info', () => {
  it('with --json emits exactly one JSON object to stdout; bigintReplacer applies', async () => {
    const { prog } = makeProgram({ getNodeOperator: OPERATOR_INFO });
    const stdoutLines: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...a) => stdoutLines.push(a.join(' ')));

    await prog.parseAsync(
      ['--module', 'csm', '--json', 'operator-info', '--operator-id', '0'],
      { from: 'user' },
    );
    await tick();
    log.mockRestore();

    expect(stdoutLines).toHaveLength(1);
    const parsed = JSON.parse(stdoutLines[0]!);
    expect(parsed).toMatchObject({ totalAddedKeys: 3, managerAddress: OPERATOR_INFO.managerAddress });
    // exact 2-space-indent format (no bigints in this result, so null replacer same as bigintReplacer)
    expect(stdoutLines[0]).toBe(JSON.stringify(OPERATOR_INFO, null, 2));
  });

  it('without --json emits human-readable lines, not a JSON object', async () => {
    const { prog } = makeProgram({ getNodeOperator: OPERATOR_INFO });
    const stdoutLines: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...a) => stdoutLines.push(a.join(' ')));

    await prog.parseAsync(
      ['--module', 'csm', 'operator-info', '--operator-id', '0'],
      { from: 'user' },
    );
    await tick();
    log.mockRestore();

    // report() emits "operator 0:" + one "  key: val" line per field
    expect(stdoutLines.length).toBeGreaterThan(1);
    expect(stdoutLines[0]).toBe('operator 0:');
    // first line must NOT be valid JSON
    expect(() => JSON.parse(stdoutLines[0]!)).toThrow();
  });
});

describe('--json contract: get-key-balance (bigint result)', () => {
  it('with --json serialises a bigint scalar result as a decimal string', async () => {
    const { prog } = makeProgram({ getKeyAllocatedBalances: [KEY_BALANCE] });
    const stdoutLines: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...a) => stdoutLines.push(a.join(' ')));

    await prog.parseAsync(
      ['--module', 'csm', '--json', 'get-key-balance', '--operator-id', '0', '--key-index', '0'],
      { from: 'user' },
    );
    await tick();
    log.mockRestore();

    expect(stdoutLines).toHaveLength(1);
    // bigint JSON.stringify → string via bigintReplacer
    const parsed = JSON.parse(stdoutLines[0]!);
    expect(parsed).toBe(KEY_BALANCE.toString());
  });
});

describe('--json contract: snapshot (Hex string result)', () => {
  it('with --json emits the snapshot id as a JSON string', async () => {
    const { prog } = makeProgram({}, SNAPSHOT_ID);
    const stdoutLines: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...a) => stdoutLines.push(a.join(' ')));

    await prog.parseAsync(['--module', 'csm', '--json', 'snapshot'], { from: 'user' });
    await tick();
    log.mockRestore();

    expect(stdoutLines).toHaveLength(1);
    expect(JSON.parse(stdoutLines[0]!)).toBe(SNAPSHOT_ID);
  });

  it('without --json emits "snapshot id: <hex>" human text', async () => {
    const { prog } = makeProgram({}, SNAPSHOT_ID);
    const stdoutLines: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...a) => stdoutLines.push(a.join(' ')));

    await prog.parseAsync(['--module', 'csm', 'snapshot'], { from: 'user' });
    await tick();
    log.mockRestore();

    expect(stdoutLines).toHaveLength(1);
    expect(stdoutLines[0]).toBe(`snapshot id: ${SNAPSHOT_ID}`);
  });
});

describe('--json contract: errors must NOT appear on stdout', () => {
  it('a missing required option writes nothing to stdout; error text goes to stderr', async () => {
    const { prog } = makeProgram();
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...a) => stdoutLines.push(a.join(' ')));
    const err = vi.spyOn(console, 'error').mockImplementation((...a) => stderrLines.push(a.join(' ')));
    // Swallow process.exit — throwing from inside run()'s .catch() causes an unhandled rejection.
    const exitSpy = vi.spyOn(process, 'exit').mockReturnValue(undefined as never);

    // operator-info without --operator-id → run() catches "missing required option" → stderr + exit(1)
    await prog
      .parseAsync(['--module', 'csm', '--json', 'operator-info'], { from: 'user' })
      .catch(() => undefined);
    await tick();

    log.mockRestore();
    err.mockRestore();
    exitSpy.mockRestore();

    expect(stdoutLines).toHaveLength(0);
    expect(stderrLines.some((l) => l.includes('Error:'))).toBe(true);
  });
});
