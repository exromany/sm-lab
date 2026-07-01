import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildProgram } from '../src/cli/program';
import type { MakeOptions, MakeResult } from '../src/pipelines';

const RESULT: MakeResult = { treeRoot: '0xroot', treeCid: 'bafyfake' };

type Call = { path: string; opts: MakeOptions };

/** buildProgram wired with recording fake pipelines + captured commander output. */
const harness = () => {
  let out = '';
  const ics: Call[] = [];
  const strikes: Call[] = [];
  const prog = buildProgram({
    makeIcs: async (path, opts = {}) => {
      ics.push({ path, opts });
      return RESULT;
    },
    makeStrikes: async (path, opts = {}) => {
      strikes.push({ path, opts });
      return RESULT;
    },
  })
    .exitOverride()
    .configureOutput({ writeOut: (s) => (out += s), writeErr: () => undefined });
  return { prog, ics, strikes, get: () => out };
};

/** Silence the action's stdout/stderr (report lines) so test output stays pristine. */
const muteConsole = () => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
};

describe('sm-merkle CLI', () => {
  afterEach(() => vi.restoreAllMocks());

  it('`ics <path>` calls makeIcs with the path and uploads by default', async () => {
    muteConsole();
    const h = harness();
    await h.prog.parseAsync(['ics', 'addrs.json'], { from: 'user' });
    expect(h.ics[0]?.path).toBe('addrs.json');
    expect(h.ics[0]?.opts.noUpload).toBe(false);
    expect(h.ics[0]?.opts.configPath).toBeUndefined();
  });

  it('`--no-upload` flips noUpload to true', async () => {
    muteConsole();
    const h = harness();
    await h.prog.parseAsync(['ics', 'addrs.json', '--no-upload'], { from: 'user' });
    expect(h.ics[0]?.opts.noUpload).toBe(true);
  });

  it('`-o, --out <path>` passes through as configPath', async () => {
    muteConsole();
    const h = harness();
    await h.prog.parseAsync(['ics', 'addrs.json', '--out', 'cfg.json'], { from: 'user' });
    expect(h.ics[0]?.opts.configPath).toBe('cfg.json');
  });

  it('`strikes <path>` calls makeStrikes with the path and uploads by default', async () => {
    muteConsole();
    const h = harness();
    await h.prog.parseAsync(['strikes', 'strikes.json'], { from: 'user' });
    expect(h.strikes[0]?.path).toBe('strikes.json');
    expect(h.strikes[0]?.opts.noUpload).toBe(false);
  });

  it('`strikes --no-upload` flips noUpload to true', async () => {
    muteConsole();
    const h = harness();
    await h.prog.parseAsync(['strikes', 'strikes.json', '--no-upload'], { from: 'user' });
    expect(h.strikes[0]?.opts.noUpload).toBe(true);
  });

  it('`help` prints the self-contained cheat sheet', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((s: unknown) => {
      logs.push(String(s));
    });
    const h = harness();
    await h.prog.parseAsync(['help'], { from: 'user' });
    const printed = logs.join('\n');
    expect(printed).toContain('sm-merkle');
    expect(printed).toContain('WHAT IT DOES');
  });
});
