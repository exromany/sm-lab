import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCompletionScript } from '@sm-lab/core';
import { buildProgram } from '../src/cli/program';
import type { DepositKey, MakeDepositKeysOptions, MakeDepositKeysResult } from '../src/keys';

const FAKE_KEY: DepositKey = {
  pubkey: '0xaabbcc',
  withdrawal_credentials: '0xddeeff',
  amount: 32_000_000_000,
  signature: '0x112233',
  deposit_message_root: '0xaabbcc',
  deposit_data_root: '0xddeeff',
  fork_version: '0x10000910',
  network_name: 'hoodi',
  deposit_cli_version: 'sm-keys/0.1.0',
};

const RESULT: MakeDepositKeysResult = { mnemonic: 'a b c', keys: [FAKE_KEY] };
const RESULT_EMPTY: MakeDepositKeysResult = { mnemonic: 'a b c', keys: [] };

/** buildProgram wired with a recording fake keygen + captured commander output. */
const harness = (result: MakeDepositKeysResult = RESULT_EMPTY) => {
  let out = '';
  const calls: MakeDepositKeysOptions[] = [];
  const prog = buildProgram({
    makeDepositKeys: async (o) => {
      calls.push(o ?? {});
      return result;
    },
  })
    .exitOverride()
    .configureOutput({ writeOut: (s) => (out += s), writeErr: () => undefined });
  return { prog, calls, get: () => out };
};

/** Silence the action's stdout/stderr (mnemonic + JSON) so test output stays pristine. */
const muteConsole = () => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
};

describe('sm-keys CLI', () => {
  afterEach(() => vi.restoreAllMocks());

  it('`help` prints the same output as `--help`', async () => {
    const viaFlag = harness();
    await viaFlag.prog.parseAsync(['--help'], { from: 'user' }).catch(() => undefined);
    const viaCmd = harness();
    await viaCmd.prog.parseAsync(['help'], { from: 'user' }).catch(() => undefined);

    expect(viaCmd.get()).toContain('Usage: sm-keys');
    expect(viaCmd.get()).toBe(viaFlag.get());
  });

  it('--help documents --json option AND includes a --json usage example', async () => {
    const h = harness();
    await h.prog.parseAsync(['--help'], { from: 'user' }).catch(() => undefined);
    const helpText = h.get();
    expect(helpText).toContain('--json');
    expect(helpText).toContain('Examples:');
    expect(helpText).toMatch(/sm-keys .+--json/);
  });

  it('accepts count as a positional alias for --count', async () => {
    muteConsole();
    const h = harness();
    await h.prog.parseAsync(['2'], { from: 'user' });
    expect(h.calls[0]?.count).toBe(2);
  });

  it('--count flag still works, and defaults to 1', async () => {
    muteConsole();
    const flag = harness();
    await flag.prog.parseAsync(['--count', '3'], { from: 'user' });
    expect(flag.calls[0]?.count).toBe(3);

    const dflt = harness();
    await dflt.prog.parseAsync([], { from: 'user' });
    expect(dflt.calls[0]?.count).toBe(1);
  });

  it('the positional count wins over --count when both are given', async () => {
    muteConsole();
    const h = harness();
    await h.prog.parseAsync(['5', '--count', '3'], { from: 'user' });
    expect(h.calls[0]?.count).toBe(5);
  });
});

describe('sm-keys CLI --json', () => {
  afterEach(() => vi.restoreAllMocks());

  it('--json: emits exactly one JSON value to stdout, 2-space indent', async () => {
    const logged: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => logged.push(String(args[0])));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const h = harness(RESULT);
    await h.prog.parseAsync(['--json'], { from: 'user' });

    expect(logged).toHaveLength(1);
    const parsed = JSON.parse(logged[0]!);
    expect(parsed).toMatchObject({
      mnemonic: 'a b c',
      keys: [expect.objectContaining({ pubkey: '0xaabbcc' })],
    });
    expect(logged[0]).toBe(JSON.stringify(RESULT, undefined, 2));
  });

  it('--json: keys retain 0x-prefixed hex fields', async () => {
    const logged: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => logged.push(String(args[0])));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const h = harness(RESULT);
    await h.prog.parseAsync(['--json'], { from: 'user' });

    const parsed = JSON.parse(logged[0]!) as { keys: DepositKey[] };
    const key = parsed.keys[0]!;
    expect(key.pubkey).toMatch(/^0x/);
    expect(key.withdrawal_credentials).toMatch(/^0x/);
    expect(key.signature).toMatch(/^0x/);
  });

  it('--json: does NOT print mnemonic or any extra text to stdout', async () => {
    const stdoutLines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => stdoutLines.push(String(args[0])));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const h = harness(RESULT);
    await h.prog.parseAsync(['--json'], { from: 'user' });

    expect(stdoutLines).toHaveLength(1);
    expect(stdoutLines[0]).not.toContain('mnemonic:');
  });

  it('--json: errors go to stderr, not stdout, and cause exit 1', async () => {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];

    // Use a gate that resolves once process.exit is called inside run()'s .catch.
    let resolveGate!: () => void;
    const gate = new Promise<void>((res) => {
      resolveGate = res;
    });

    vi.spyOn(console, 'log').mockImplementation((...args) => stdoutLines.push(String(args[0])));
    // console.error('Error:', message) → capture all args joined
    vi.spyOn(console, 'error').mockImplementation((...args) =>
      stderrLines.push(args.map(String).join(' ')),
    );
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      resolveGate();
      void code;
      return undefined as never;
    });

    const prog = buildProgram({
      makeDepositKeys: async () => {
        throw new Error('keygen failed');
      },
    }).exitOverride();

    await prog.parseAsync(['--json'], { from: 'user' }).catch(() => undefined);
    await gate; // wait for run()'s .catch to reach process.exit

    // stdout must be empty — no JSON error object
    expect(stdoutLines).toHaveLength(0);
    expect(stderrLines.some((l) => l.includes('keygen failed'))).toBe(true);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('--json: empty keys array is still valid JSON', async () => {
    const logged: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => logged.push(String(args[0])));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const h = harness(RESULT_EMPTY);
    await h.prog.parseAsync(['--json'], { from: 'user' });

    const parsed = JSON.parse(logged[0]!) as { mnemonic: string; keys: unknown[] };
    expect(parsed.keys).toEqual([]);
    expect(parsed.mnemonic).toBe('a b c');
  });

  it('without --json: human output goes to stdout (toDepositDataJson format, no 0x prefix)', async () => {
    const stdoutLines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => stdoutLines.push(String(args[0])));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const h = harness(RESULT);
    await h.prog.parseAsync([], { from: 'user' });

    expect(stdoutLines).toHaveLength(1);
    const parsed = JSON.parse(stdoutLines[0]!) as Array<{ pubkey: string }>;
    // toDepositDataJson strips 0x prefix
    expect(parsed[0]?.pubkey).not.toMatch(/^0x/);
    expect(parsed[0]?.pubkey).toBe('aabbcc');
  });
});

describe('sm-keys CLI completion + option validation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('`completion fish` prints a static script covering the bin, a subcommand, and flags', async () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });

    const h = harness();
    await h.prog.parseAsync(['completion', 'fish'], { from: 'user' });

    const script = writes.join('');
    expect(script).toContain('complete -c sm-keys');
    expect(script).toContain('-a completion');
    expect(script).toContain('-l json');
    expect(script).toBe(buildCompletionScript(h.prog, 'fish'));
  });

  it('completion script offers the --chain / --type choices', () => {
    const script = buildCompletionScript(harness().prog, 'fish');
    expect(script).toContain("-l chain -x -a 'mainnet hoodi'");
    expect(script).toContain("-l type -x -a '0x01 0x02'");
  });

  it('invalid --chain / --type values are native commander usage errors', async () => {
    const chain = harness();
    await expect(chain.prog.parseAsync(['--chain', 'sepolia'], { from: 'user' })).rejects.toThrow(
      /--chain/,
    );
    expect(chain.calls).toHaveLength(0);

    const type = harness();
    await expect(type.prog.parseAsync(['--type', '0x03'], { from: 'user' })).rejects.toThrow(
      /--type/,
    );
    expect(type.calls).toHaveLength(0);
  });
});
