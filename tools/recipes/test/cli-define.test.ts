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
  identity,
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
    expect(toPairs(['0:3400', '1:6600'])).toEqual([
      [0n, 3400n],
      [1n, 6600n],
    ]);
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

const arrayOf = (raw: string | string[]): string[] => raw as string[];

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
    expect(fakeConnect).toHaveBeenCalledWith({
      module: 'csm',
      rpcUrl: 'http://x',
      clMockUrl: undefined,
    });
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

  it('defaults rpcUrl to the anvil default when --rpc-url and RPC_URL are both missing', async () => {
    fakeConnect.mockClear();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    delete process.env.RPC_URL;
    await program().parseAsync(['--module', 'csm', 'demo', '--operator-id', '7'], { from: 'user' });
    expect(fakeConnect).toHaveBeenCalledWith({
      module: 'csm',
      rpcUrl: 'http://127.0.0.1:8545',
      clMockUrl: undefined,
    });
    log.mockRestore();
  });

  it('accepts a required option positionally (no flag)', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await program().parseAsync(['--module', 'csm', 'demo', '7'], { from: 'user' });
    expect(log).toHaveBeenCalledWith('ok 7');
    log.mockRestore();
  });

  describe('positional arguments', () => {
    // required (operator-id, count) → positional in declaration order; optional (seed) stays a flag.
    const multi: RecipeCommand<
      { noId: bigint; count: bigint; seed?: string },
      { noId: bigint; count: bigint; seed?: string }
    > = {
      name: 'multi',
      summary: 'multi',
      options: [
        { flag: '--operator-id <id>', key: 'noId', coerce: toBigInt, required: true },
        { flag: '--count <n>', key: 'count', coerce: toBigInt, required: true },
        { flag: '--seed <hex>', key: 'seed', coerce: identity },
      ],
      run: async (_ctx, o) => o,
      report: (r) => [`${r.noId}/${r.count}/${r.seed ?? '-'}`],
    };
    const multiProgram = () => {
      const p = new Command().option('--module <m>').exitOverride();
      p.addCommand(defineCommand(multi, fakeConnect));
      return p;
    };

    it('maps multiple positionals in declaration order; optional flag stays a flag', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      await multiProgram().parseAsync(['--module', 'csm', 'multi', '3', '5', '--seed', '0xab'], {
        from: 'user',
      });
      expect(log).toHaveBeenCalledWith('3/5/0xab');
      log.mockRestore();
    });

    it('mixes a positional with a flag for the other required option', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      await multiProgram().parseAsync(['--module', 'csm', 'multi', '3', '--count', '9'], {
        from: 'user',
      });
      expect(log).toHaveBeenCalledWith('3/9/-');
      log.mockRestore();
    });

    it('declares positionals only for required, non-repeatable options', () => {
      const cmd = defineCommand(
        {
          name: 'rep',
          summary: 'rep',
          options: [
            { flag: '--operator-id <id>', key: 'noId', coerce: toBigInt, required: true },
            { flag: '--seed <hex>', key: 'seed', coerce: identity }, // optional → flag only
            {
              flag: '--address <a>',
              key: 'addresses',
              coerce: toAddresses,
              repeatable: true,
              required: true, // repeatable → flag only
            },
          ],
          run: async () => ({}),
          report: () => [],
        },
        fakeConnect,
      );
      expect(cmd.registeredArguments.map((a) => a.name())).toEqual(['operator-id']);
    });

    // The set-gate shape: a leading optional positional, then a repeatable required option
    // accepted as the trailing variadic positional — `gate <selector> <address...>`.
    const gate: RecipeCommand<
      { selector?: string; addresses: string[] },
      { selector?: string; addresses: string[] }
    > = {
      name: 'gate',
      summary: 'gate',
      options: [
        { flag: '--selector <name>', key: 'selector', coerce: identity, positional: true },
        {
          flag: '--address <addr>',
          key: 'addresses',
          coerce: arrayOf,
          repeatable: true,
          required: true,
          positional: true,
        },
      ],
      run: async (_ctx, o) => o,
      report: (r) => [`${r.selector ?? '-'}:${r.addresses.join(',')}`],
    };
    const gateProgram = () => {
      const p = new Command().option('--module <m>').exitOverride();
      p.addCommand(defineCommand(gate, fakeConnect));
      return p;
    };

    it('declares an opt-in positional + a repeatable variadic, in declaration order', () => {
      const args = defineCommand(gate, fakeConnect).registeredArguments;
      expect(args.map((a) => a.name())).toEqual(['selector', 'address']);
      expect(args.map((a) => a.variadic)).toEqual([false, true]);
    });

    it('maps a leading positional then a trailing variadic positional', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      await gateProgram().parseAsync(['--module', 'csm', 'gate', 'idvtc', '0xa', '0xb'], {
        from: 'user',
      });
      expect(log).toHaveBeenCalledWith('idvtc:0xa,0xb');
      log.mockRestore();
    });

    it('falls back to flags when no positional values are given for either', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      await gateProgram().parseAsync(
        ['--module', 'csm', 'gate', '--selector', 'ics', '--address', '0xc'],
        { from: 'user' },
      );
      expect(log).toHaveBeenCalledWith('ics:0xc');
      log.mockRestore();
    });

    it('throws at build time when a repeatable positional is not declared last', () => {
      expect(() =>
        defineCommand(
          {
            name: 'bad',
            summary: 'bad',
            options: [
              {
                flag: '--address <a>',
                key: 'addresses',
                coerce: toAddresses,
                repeatable: true,
                required: true,
                positional: true,
              },
              { flag: '--selector <s>', key: 'selector', coerce: identity, positional: true },
            ],
            run: async () => ({}),
            report: () => [],
          },
          fakeConnect,
        ),
      ).toThrow(/repeatable positional/);
    });
  });

  describe('order-free positionals (match)', () => {
    const omni: RecipeCommand<
      { selector?: string; keysCount?: number },
      { selector?: string; keysCount?: number }
    > = {
      name: 'omni',
      summary: 'omni',
      options: [
        {
          flag: '--selector <name>',
          key: 'selector',
          coerce: identity,
          positional: true,
          match: (t) => !/^\d+$/.test(t),
        },
        {
          flag: '--keys <n>',
          key: 'keysCount',
          coerce: toNumber,
          positional: true,
          match: (t) => /^\d+$/.test(t),
        },
      ],
      run: async (_ctx, o) => o,
      report: (r) => [`${r.selector ?? '-'}/${r.keysCount ?? '-'}`],
    };
    const omniProgram = () => {
      const p = new Command().option('--module <m>').exitOverride();
      p.addCommand(defineCommand(omni, fakeConnect));
      return p;
    };
    const runOmni = async (...args: string[]): Promise<string> => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      await omniProgram().parseAsync(['--module', 'csm', 'omni', ...args], { from: 'user' });
      const out = log.mock.calls[0]![0] as string;
      log.mockRestore();
      return out;
    };

    it('assigns tokens by predicate in either order', async () => {
      expect(await runOmni('idvtc', '10')).toBe('idvtc/10');
      expect(await runOmni('10', 'idvtc')).toBe('idvtc/10');
      expect(await runOmni('10')).toBe('-/10');
      expect(await runOmni('idvtc')).toBe('idvtc/-');
      expect(await runOmni()).toBe('-/-');
    });

    it('rejects a token no unfilled positional accepts', async () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      await omniProgram().parseAsync(['--module', 'csm', 'omni', '10', '12'], { from: 'user' });
      expect(err).toHaveBeenCalledWith(
        'Error:',
        expect.stringContaining('unrecognized positional "12"'),
      );
      err.mockRestore();
      exit.mockRestore();
    });

    it('a match positional cannot combine with a variadic positional', () => {
      expect(() =>
        defineCommand(
          {
            name: 'bad',
            summary: 'bad',
            options: [
              {
                flag: '--selector <s>',
                key: 's',
                coerce: identity,
                positional: true,
                match: () => true,
              },
              {
                flag: '--address <a>',
                key: 'a',
                coerce: toAddresses,
                repeatable: true,
                positional: true,
              },
            ],
            run: async () => ({}),
            report: () => [],
          },
          fakeConnect,
        ),
      ).toThrow(/variadic/);
    });
  });

  describe('boolean switch flags (no <value> placeholder)', () => {
    const sw: RecipeCommand<{ ext?: boolean }, { ext?: boolean }> = {
      name: 'sw',
      summary: 'sw',
      options: [{ flag: '--extended-manager-permissions', key: 'ext' }],
      run: async (_ctx, o) => o,
      report: (r) => [`ext=${r.ext ?? 'unset'}`],
    };
    const swProgram = () => {
      const p = new Command().option('--module <m>').exitOverride();
      p.addCommand(defineCommand(sw, fakeConnect));
      return p;
    };

    it('present → true; absent → key omitted', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      await swProgram().parseAsync(['--module', 'csm', 'sw', '--extended-manager-permissions'], {
        from: 'user',
      });
      expect(log).toHaveBeenCalledWith('ext=true');
      log.mockClear();
      await swProgram().parseAsync(['--module', 'csm', 'sw'], { from: 'user' });
      expect(log).toHaveBeenCalledWith('ext=unset');
      log.mockRestore();
    });
  });

  it('a descriptor module forces ctx.module, overriding the global --module', async () => {
    fakeConnect.mockClear();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const forced: RecipeCommand<{ noId: bigint }, { ok: bigint }> = { ...desc, module: 'csm' };
    const p = new Command()
      .option('--rpc-url <url>')
      .option('--module <m>')
      .option('--cl-mock-url <url>')
      .option('--json')
      .exitOverride();
    p.addCommand(defineCommand(forced, fakeConnect));
    await p.parseAsync(['--rpc-url', 'http://x', '--module', 'cm', 'demo', '--operator-id', '1'], {
      from: 'user',
    });
    expect(fakeConnect).toHaveBeenCalledWith({
      module: 'csm',
      rpcUrl: 'http://x',
      clMockUrl: undefined,
    });
    log.mockRestore();
  });
});
