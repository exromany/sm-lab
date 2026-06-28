// tools/recipes/test/cli-program.test.ts
import { describe, expect, it } from 'vitest';
import { buildProgram } from '../src/cli/program';

describe('buildProgram', () => {
  const p = buildProgram();
  it('registers global options', () => {
    const longs = p.options.map((o) => o.long);
    expect(longs).toEqual(
      expect.arrayContaining(['--rpc-url', '--module', '--cl-mock-url', '--json']),
    );
  });
  it('registers all shared commands at the top level plus cm/csm groups', () => {
    const names = p.commands.map((c) => c.name());
    expect(names).toEqual(expect.arrayContaining(['add-keys', 'make-rewards', 'cm', 'csm']));
  });
  it('the cm group nests its commands', () => {
    const cm = p.commands.find((c) => c.name() === 'cm')!;
    expect(cm.commands.map((c) => c.name())).toEqual(
      expect.arrayContaining(['seed', 'create-operator-group']),
    );
  });
});
