// tools/recipes/test/cli-program.test.ts
import { describe, expect, it } from 'vitest';
import { buildProgram } from '../src/cli/program';

/** A fresh program that captures help/usage output instead of writing to the real streams. */
const captureProgram = () => {
  let out = '';
  const prog = buildProgram()
    .exitOverride()
    .configureOutput({ writeOut: (s) => (out += s), writeErr: () => undefined });
  return { prog, get: () => out };
};

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
  it('`help` prints the same output as `--help` at the global scope', async () => {
    const viaFlag = captureProgram();
    await viaFlag.prog.parseAsync(['--help'], { from: 'user' }).catch(() => undefined);
    const viaCmd = captureProgram();
    await viaCmd.prog.parseAsync(['help'], { from: 'user' }).catch(() => undefined);

    expect(viaCmd.get()).toContain('Usage: sm-recipes');
    expect(viaCmd.get()).toBe(viaFlag.get());
  });

  it('mirrors every shared command under both cm and csm groups (module pre-bound)', () => {
    const cmNames = p.commands.find((c) => c.name() === 'cm')!.commands.map((c) => c.name());
    const csmNames = p.commands.find((c) => c.name() === 'csm')!.commands.map((c) => c.name());
    // shared lifecycle commands now reachable via the group form, without --module
    for (const shared of ['operator-info', 'add-keys', 'deposit']) {
      expect(cmNames).toContain(shared);
      expect(csmNames).toContain(shared);
    }
    // group-specific commands still present alongside the mirrored shared ones
    expect(cmNames).toContain('seed');
    expect(csmNames).toContain('set-gate');
  });
});
