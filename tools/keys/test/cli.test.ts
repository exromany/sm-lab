import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildProgram } from '../src/cli/program';
import type { MakeDepositKeysOptions, MakeDepositKeysResult } from '../src/keys';

const RESULT: MakeDepositKeysResult = { mnemonic: 'a b c', keys: [] };

/** buildProgram wired with a recording fake keygen + captured commander output. */
const harness = () => {
  let out = '';
  const calls: MakeDepositKeysOptions[] = [];
  const prog = buildProgram({
    makeDepositKeys: async (o) => {
      calls.push(o ?? {});
      return RESULT;
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
