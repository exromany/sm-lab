import { describe, expect, it } from 'vitest';
import { cmCommands } from '../src/cli/commands/cm';
import { csmCommands } from '../src/cli/commands/csm';
import { defineCommand } from '../src/cli/define';

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
      ['add-gate', 'resolve-gate', 'set-gate'].toSorted(),
    );
    expect(csmCommands.every((c) => c.module === 'csm')).toBe(true);
  });
  it('create-operator-group uses a repeatable --pair', () => {
    const g = cmCommands.find((c) => c.name === 'create-operator-group')!;
    const pair = g.options.find((o) => o.key === 'pairs')!;
    expect(pair.repeatable).toBe(true);
    expect(pair.coerce(['0:5000', '1:5000'])).toEqual([
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
