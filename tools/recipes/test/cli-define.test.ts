// tools/recipes/test/cli-define.test.ts
import { describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import {
  toBigInt,
  toNumber,
  toEth,
  toHexValue,
  toAddressValue,
  toPairs,
  toAddresses,
  flagProp,
  bigintReplacer,
  defineCommand,
  type RecipeCommand,
} from '../src/cli/define';

describe('coercers', () => {
  it('toBigInt parses, throws on garbage', () => {
    expect(toBigInt('42')).toBe(42n);
    expect(() => toBigInt('x')).toThrow();
  });
  it('toNumber parses, throws on NaN', () => {
    expect(toNumber('3')).toBe(3);
    expect(() => toNumber('x')).toThrow('not a number');
  });
  it('toEth: 1 wei round-trips (string parse, not float)', () => {
    expect(toEth('0.000000000000000001')).toBe(1n);
    expect(toEth('1')).toBe(10n ** 18n);
    expect(toEth('1.5')).toBe(1_500_000_000_000_000_000n);
  });
  it('toHexValue / toAddressValue validate', () => {
    expect(toHexValue('0xabcd')).toBe('0xabcd');
    expect(() => toHexValue('nope')).toThrow();
    expect(() => toAddressValue('0x123')).toThrow();
  });
  it('toPairs / toAddresses map repeatable input', () => {
    expect(toPairs(['0:3400', '1:6600'])).toEqual([[0n, 3400n], [1n, 6600n]]);
    expect(toAddresses(['0x' + '1'.repeat(40)])).toEqual(['0x' + '1'.repeat(40)]);
  });
});

describe('flagProp', () => {
  it('camelCases the long flag name', () => {
    expect(flagProp('--operator-id <id>')).toBe('operatorId');
    expect(flagProp('-s, --seed <hex>')).toBe('seed');
    expect(flagProp('--max-amount <eth>')).toBe('maxAmount');
  });
});

describe('bigintReplacer', () => {
  it('stringifies bigints', () => {
    expect(JSON.parse(JSON.stringify({ a: 5n }, bigintReplacer))).toEqual({ a: '5' });
  });
});

describe('defineCommand', () => {
  const fakeCtx = { module: 'csm' } as never;
  const fakeConnect = vi.fn(async () => fakeCtx);

  const desc: RecipeCommand<{ noId: bigint }, { ok: bigint }> = {
    name: 'demo',
    summary: 'demo',
    options: [{ flag: '--operator-id <id>', key: 'noId', coerce: toBigInt, required: true }],
    run: async (_ctx, opts) => ({ ok: opts.noId }),
    report: (r) => [`ok ${r.ok}`],
  };

  function program(connect = fakeConnect) {
    const p = new Command()
      .option('--rpc-url <url>')
      .option('--module <m>')
      .option('--cl-mock-url <url>')
      .option('--json')
      .exitOverride();
    p.addCommand(defineCommand(desc, connect));
    return p;
  }

  it('builds ctx from globals, coerces opts, prints human output', async () => {
    fakeConnect.mockClear();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await program().parseAsync(
      ['--rpc-url', 'http://x', '--module', 'csm', 'demo', '--operator-id', '7'],
      { from: 'user' },
    );
    expect(fakeConnect).toHaveBeenCalledWith({ module: 'csm', rpcUrl: 'http://x', clMockUrl: undefined });
    expect(log).toHaveBeenCalledWith('ok 7');
    log.mockRestore();
  });

  it('--json emits the raw result with bigints as strings', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await program().parseAsync(
      ['--rpc-url', 'http://x', '--module', 'csm', '--json', 'demo', '--operator-id', '7'],
      { from: 'user' },
    );
    expect(log).toHaveBeenCalledWith(JSON.stringify({ ok: '7' }, null, 2));
    log.mockRestore();
  });

  it('exits non-zero when --rpc-url and RPC_URL are both missing', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    delete process.env.RPC_URL;
    await program().parseAsync(['--module', 'csm', 'demo', '--operator-id', '7'], { from: 'user' });
    expect(err).toHaveBeenCalledWith('Error:', expect.stringContaining('--rpc-url'));
    expect(exit).toHaveBeenCalledWith(1);
    err.mockRestore();
    exit.mockRestore();
  });
});
