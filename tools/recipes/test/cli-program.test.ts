import { describe, expect, it } from 'vitest';
import { buildCompletionScript } from '@sm-lab/core';
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

  it('help text contains --json option AND a usage example with --json', async () => {
    const h = captureProgram();
    await h.prog.parseAsync(['--help'], { from: 'user' }).catch(() => undefined);
    const helpText = h.get();
    // Option documented
    expect(helpText).toContain('--json');
    // At least one example showing --json usage
    expect(helpText).toMatch(/--json/);
    expect(helpText).toContain('Examples:');
    // Must contain a concrete example using --json
    expect(helpText).toMatch(/sm-recipes .+--json/);
  });

  it('registers the completion command and --version', () => {
    expect(p.commands.map((c) => c.name())).toContain('completion');
    expect(p.options.map((o) => o.long)).toContain('--version');
  });

  it('completion: the fish script covers the bin, a nested cm command, and known flags', () => {
    const fish = buildCompletionScript(buildProgram(), 'fish');
    expect(fish).toContain('complete -c sm-recipes');
    expect(fish).toContain('-a add-keys');
    // nested: the cm group's own `seed` command is offered only after the `cm` token
    expect(fish).toMatch(/__fish_seen_subcommand_from cm.*-a seed /);
    expect(fish).toContain('-l operator-id');
    expect(fish).toContain('-l json');
  });

  it('leaf help shows global options and the positional-order line', () => {
    const leaf = buildProgram().commands.find((c) => c.name() === 'withdraw')!;
    let out = '';
    leaf.configureOutput({ writeOut: (s) => (out += s) });
    leaf.outputHelp();
    expect(out).toContain('Global Options:');
    expect(out).toContain('--json');
    expect(out).toContain('node operator id (uint)');
    expect(out).toContain('positionally in this order: operator-id, key-index, exit-balance');
  });

  it('mirrors every shared command under both cm and csm groups (module pre-bound)', () => {
    const cmNames = p.commands.find((c) => c.name() === 'cm')!.commands.map((c) => c.name());
    const csmNames = p.commands.find((c) => c.name() === 'csm')!.commands.map((c) => c.name());
    // shared lifecycle commands now reachable via the group form, without --module
    for (const shared of ['operator-info', 'add-keys', 'deposit']) {
      expect(cmNames).toContain(shared);
      expect(csmNames).toContain(shared);
    }
    for (const shared of ['pause', 'resume', 'set-target-limit', 'get-curve-info']) {
      expect(cmNames).toContain(shared);
      expect(csmNames).toContain(shared);
    }
    // group-specific commands still present alongside the mirrored shared ones
    expect(cmNames).toContain('seed');
    expect(csmNames).toContain('set-gate');
    // gate commands now exist under both groups (each with its module's gate list)
    expect(cmNames).toContain('set-gate');
    expect(cmNames).toContain('resolve-gate');
  });
});
