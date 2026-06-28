import { describe, expect, it } from 'vitest';
import { cmCommands } from '../src/cli/commands/cm';
import { csmCommands } from '../src/cli/commands/csm';

describe('cm/csm commands', () => {
  it('cm commands all force module cm', () => {
    expect(cmCommands.map((c) => c.name).toSorted()).toEqual(
      ['create-curated-operator', 'create-operator-group', 'reset-operator-group', 'seed', 'set-bond-curve-weight'].toSorted(),
    );
    expect(cmCommands.every((c) => c.module === 'cm')).toBe(true);
  });
  it('csm commands all force module csm', () => {
    expect(csmCommands.map((c) => c.name).toSorted()).toEqual(['resolve-gate', 'set-gate'].toSorted());
    expect(csmCommands.every((c) => c.module === 'csm')).toBe(true);
  });
  it('create-operator-group uses a repeatable --pair', () => {
    const g = cmCommands.find((c) => c.name === 'create-operator-group')!;
    const pair = g.options.find((o) => o.key === 'pairs')!;
    expect(pair.repeatable).toBe(true);
    expect(pair.coerce(['0:5000', '1:5000'])).toEqual([[0n, 5000n], [1n, 5000n]]);
  });
  it('resolve-gate reports the resolved address', () => {
    const rg = csmCommands.find((c) => c.name === 'resolve-gate')!;
    expect(rg.report('0xabc' as never, { selector: 'idvtc' })).toEqual(['idvtc → 0xabc']);
  });
});
