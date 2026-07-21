import { describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { parseEther } from 'viem';
import { cmCommands } from '../src/cli/commands/cm';
import { csmCommands } from '../src/cli/commands/csm';
import { defineCommand } from '../src/cli/define';
import { makeFakeClient } from './helpers/fake-client';
import { fakeCtx, A } from './helpers/book';

describe('cm/csm commands', () => {
  it('cm commands all force module cm', () => {
    expect(cmCommands.map((c) => c.name).toSorted()).toEqual(
      [
        'add-gate',
        'create-curated-operator',
        'create-operator-group',
        'reset-operator-group',
        'resolve-gate',
        'seed',
        'set-bond-curve-weight',
        'set-gate',
      ].toSorted(),
    );
    expect(cmCommands.every((c) => c.module === 'cm')).toBe(true);
  });
  it('csm commands all force module csm', () => {
    expect(csmCommands.map((c) => c.name).toSorted()).toEqual(
      ['add-gate', 'create-operator', 'resolve-gate', 'set-gate'].toSorted(),
    );
    expect(csmCommands.every((c) => c.module === 'csm')).toBe(true);
  });
  it('create-operator-group uses a repeatable --pair', () => {
    const g = cmCommands.find((c) => c.name === 'create-operator-group')!;
    const pair = g.options.find((o) => o.key === 'pairs')!;
    expect(pair.repeatable).toBe(true);
    expect(pair.coerce!(['0:5000', '1:5000'])).toEqual([
      [0n, 5000n],
      [1n, 5000n],
    ]);
  });
  it('resolve-gate reports the resolved address', () => {
    const rg = csmCommands.find((c) => c.name === 'resolve-gate')!;
    expect(rg.report('0xabc' as never, { selector: 'idvtc' })).toEqual(['idvtc → 0xabc']);
  });
  it('set-gate accepts <selector> then a variadic <address...> positionally', () => {
    const sg = csmCommands.find((c) => c.name === 'set-gate')!;
    const args = defineCommand(sg).registeredArguments;
    expect(args.map((a) => a.name())).toEqual(['selector', 'address']);
    expect(args.map((a) => a.variadic)).toEqual([false, true]);
  });
  it('add-gate accepts <selector> then a variadic <address...> positionally', () => {
    const ag = csmCommands.find((c) => c.name === 'add-gate')!;
    const args = defineCommand(ag).registeredArguments;
    expect(args.map((a) => a.name())).toEqual(['selector', 'address']);
    expect(args.map((a) => a.variadic)).toEqual([false, true]);
  });
  it('cm mirrors the gate commands (set-gate + resolve-gate) forcing module cm', () => {
    const sg = cmCommands.find((c) => c.name === 'set-gate')!;
    expect(sg.module).toBe('cm');
    const args = defineCommand(sg).registeredArguments;
    expect(args.map((a) => a.name())).toEqual(['selector', 'address']);
    expect(args.map((a) => a.variadic)).toEqual([false, true]);

    const rg = cmCommands.find((c) => c.name === 'resolve-gate')!;
    expect(rg.report('0xabc' as never, { selector: 'pto' })).toEqual(['pto → 0xabc']);
  });
});

// run() in define.ts is fire-and-forget (returns void, not Promise), so commander's parseAsync
// resolves before the action's async continuation runs — a setTimeout(0) tick flushes the
// pending microtask queue first (see the same idiom in cli-json.test.ts).
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('csm create-operator CLI forms', () => {
  const co = csmCommands.find((c) => c.name === 'create-operator')!;
  const SEED = `0x${'01'.repeat(32)}`;

  function coProgram() {
    const fake = makeFakeClient({
      reads: {
        CURVE_ID: 0n,
        curveId: 2n,
        treeCid: '',
        getRoleMember: A(0xd0),
        isPaused: false,
        getBondAmountByKeysCount: parseEther('2.4'),
      },
      simulate: { result: 1n, request: { functionName: 'addNodeOperatorETH' } },
    });
    const connect = async () => fakeCtx('csm', fake.client);
    const p = new Command().option('--module <m>').option('--json').exitOverride();
    p.addCommand(defineCommand(co, connect as never));
    return { p, fake };
  }

  const runForm = async (...args: string[]) => {
    const { p, fake } = coProgram();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await p.parseAsync(['create-operator', ...args, '--seed', SEED], { from: 'user' });
    await tick();
    log.mockRestore();
    return fake.byMethod('simulateContract')[0] as any;
  };

  it('declares [selector] [keys] positionals', () => {
    const args = defineCommand(co).registeredArguments;
    expect(args.map((a) => a.name())).toEqual(['selector', 'keys']);
  });

  it('bare form → permissionless, 1 key', async () => {
    const sim = await runForm();
    expect(sim.args).toHaveLength(5);
    expect(sim.args[0]).toBe(1n);
  });

  it('count-only form → permissionless, N keys', async () => {
    const sim = await runForm('3');
    expect(sim.args).toHaveLength(5);
    expect(sim.args[0]).toBe(3n);
  });

  it('selector-only form → gated, 1 key', async () => {
    const sim = await runForm('ics', '--cid', 'x');
    expect(sim.args).toHaveLength(6); // proof present
    expect(sim.args[0]).toBe(1n);
  });

  it('selector+count and count+selector both parse (order-free)', async () => {
    const a = await runForm('ics', '2', '--cid', 'x');
    expect(a.args[0]).toBe(2n);
    expect(a.args).toHaveLength(6);
    const b = await runForm('2', 'ics', '--cid', 'x');
    expect(b.args[0]).toBe(2n);
    expect(b.args).toHaveLength(6);
  });

  it('boolean switch maps to extendedManagerPermissions', async () => {
    const sim = await runForm('--extended-manager-permissions');
    expect(sim.args[3]).toMatchObject({ extendedManagerPermissions: true });
  });
});
