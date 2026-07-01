import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { buildProgram } from '../src/cli/program';
import type { MakeOptions, MakeResult } from '../src/pipelines';

const RESULT: MakeResult = { treeRoot: '0xroot', treeCid: 'bafyfake' };
const RESULT_WITH_LOG: MakeResult & { logCid?: string } = {
  treeRoot: '0xroot',
  treeCid: 'bafyfake',
  logCid: 'bafylog',
};

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => path.join(here, 'fixtures', name);

/** Temp dir for CLI tests that need fixture files. */
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-merkle-cli-'));
afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

/** Write a JSON file to the temp dir, return its path. */
function tmp(name: string, data: unknown): string {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, JSON.stringify(data));
  return p;
}

type IcsCall = { addresses: string[]; opts: MakeOptions };
type StrikesCall = { path: string; opts: MakeOptions };
type RewardsCall = { leaves: [bigint, bigint][]; opts: MakeOptions & { log?: unknown } };

/** buildProgram wired with recording fake pipelines + captured commander output. */
const harness = () => {
  let out = '';
  const ics: IcsCall[] = [];
  const strikes: StrikesCall[] = [];
  const rewards: RewardsCall[] = [];
  const prog = buildProgram({
    makeIcs: async (addresses, opts = {}) => {
      ics.push({ addresses, opts });
      return RESULT;
    },
    makeStrikes: async (p, opts = {}) => {
      strikes.push({ path: p, opts });
      return RESULT;
    },
    makeRewards: async (leaves, opts = {}) => {
      rewards.push({ leaves, opts });
      return RESULT_WITH_LOG;
    },
  })
    .exitOverride()
    .configureOutput({ writeOut: (s) => (out += s), writeErr: () => undefined });
  return { prog, ics, strikes, rewards, get: () => out };
};

/** Silence the action's stdout/stderr (report lines) so test output stays pristine. */
const muteConsole = () => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
};

describe('sm-merkle CLI', () => {
  afterEach(() => vi.restoreAllMocks());

  // ---------------------------------------------------------------------------
  // addresses command (default)
  // ---------------------------------------------------------------------------

  it('`addresses <addr>` calls makeIcs with addresses array and uploads by default', async () => {
    muteConsole();
    const h = harness();
    await h.prog.parseAsync(['addresses', '0xABC', '0xDEF'], { from: 'user' });
    expect(h.ics[0]?.addresses).toEqual(['0xABC', '0xDEF']);
    expect(h.ics[0]?.opts.noUpload).toBe(false);
    expect(h.ics[0]?.opts.configPath).toBeUndefined();
  });

  it('bare positionals (default command) route to makeIcs', async () => {
    muteConsole();
    const h = harness();
    await h.prog.parseAsync(['0xABC', '0xDEF'], { from: 'user' });
    expect(h.ics[0]?.addresses).toEqual(['0xABC', '0xDEF']);
  });

  it('`--input` flag accumulates addresses', async () => {
    muteConsole();
    const h = harness();
    await h.prog.parseAsync(['addresses', '--input', '0xAAA', '--input', '0xBBB'], {
      from: 'user',
    });
    expect(h.ics[0]?.addresses).toEqual(['0xAAA', '0xBBB']);
  });

  it('positionals and --input are merged', async () => {
    muteConsole();
    const h = harness();
    await h.prog.parseAsync(['addresses', '0xAAA', '--input', '0xBBB'], { from: 'user' });
    expect(h.ics[0]?.addresses).toEqual(['0xAAA', '0xBBB']);
  });

  it('`--source` loads addresses from file via readAddressFile', async () => {
    muteConsole();
    const h = harness();
    await h.prog.parseAsync(['addresses', '--source', fixture('addresses.json')], { from: 'user' });
    expect(Array.isArray(h.ics[0]?.addresses)).toBe(true);
    expect((h.ics[0]?.addresses.length ?? 0) > 0).toBe(true);
  });

  it('mixing --source and positionals throws an error', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) =>
      errors.push(args.map(String).join(' ')),
    );
    let exitCalled = false;
    vi.spyOn(process, 'exit').mockImplementation(() => {
      exitCalled = true;
      return undefined as never;
    });
    const h = harness();
    await h.prog.parseAsync(['addresses', '0xABC', '--source', 'some.json'], { from: 'user' });
    await vi.waitFor(() => exitCalled, { timeout: 500 });
    expect(errors.join(' ')).toMatch(/combine|source|inline/i);
  });

  it('no addresses throws an error', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) =>
      errors.push(args.map(String).join(' ')),
    );
    let exitCalled = false;
    vi.spyOn(process, 'exit').mockImplementation(() => {
      exitCalled = true;
      return undefined as never;
    });
    const h = harness();
    await h.prog.parseAsync(['addresses'], { from: 'user' });
    await vi.waitFor(() => exitCalled, { timeout: 500 });
    expect(errors.join(' ')).toMatch(/No addresses|positional|--input|--source/i);
  });

  it('`--no-upload` flips noUpload to true', async () => {
    muteConsole();
    const h = harness();
    await h.prog.parseAsync(['addresses', '0xABC', '--no-upload'], { from: 'user' });
    expect(h.ics[0]?.opts.noUpload).toBe(true);
  });

  it('`-o, --out <path>` passes through as configPath', async () => {
    muteConsole();
    const h = harness();
    await h.prog.parseAsync(['addresses', '0xABC', '--out', 'cfg.json'], { from: 'user' });
    expect(h.ics[0]?.opts.configPath).toBe('cfg.json');
  });

  // ---------------------------------------------------------------------------
  // strikes command
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // rewards command
  // ---------------------------------------------------------------------------

  it('`rewards --source <file>` calls makeRewards with parsed bigint leaves', async () => {
    muteConsole();
    const h = harness();
    const rewardsFile = tmp('rewards.json', [
      [0, '1000'],
      [1, 2000],
    ]);
    await h.prog.parseAsync(['rewards', '--source', rewardsFile], { from: 'user' });
    expect(h.rewards[0]?.leaves).toEqual([
      [0n, 1000n],
      [1n, 2000n],
    ]);
  });

  it('`rewards` without --source throws', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) =>
      errors.push(args.map(String).join(' ')),
    );
    let exitCalled = false;
    vi.spyOn(process, 'exit').mockImplementation(() => {
      exitCalled = true;
      return undefined as never;
    });
    const h = harness();
    await h.prog.parseAsync(['rewards'], { from: 'user' });
    await vi.waitFor(() => exitCalled, { timeout: 500 });
    expect(errors.join(' ')).toMatch(/--source/i);
  });

  it('`rewards --no-upload` passes noUpload to makeRewards', async () => {
    muteConsole();
    const h = harness();
    const rewardsFile = tmp('rewards-noup.json', [[0, 1000]]);
    await h.prog.parseAsync(['rewards', '--source', rewardsFile, '--no-upload'], { from: 'user' });
    expect(h.rewards[0]?.opts.noUpload).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // help command
  // ---------------------------------------------------------------------------

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

  it('help cheat-sheet documents the `addresses` command', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((s: unknown) => logs.push(String(s)));
    const h = harness();
    await h.prog.parseAsync(['help'], { from: 'user' });
    expect(logs.join('\n')).toContain('addresses');
  });

  it('help cheat-sheet documents the `rewards` command', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((s: unknown) => logs.push(String(s)));
    const h = harness();
    await h.prog.parseAsync(['help'], { from: 'user' });
    expect(logs.join('\n')).toContain('rewards');
  });

  it('help documents local IPFS default (not Pinata)', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((s: unknown) => logs.push(String(s)));
    const h = harness();
    await h.prog.parseAsync(['help'], { from: 'user' });
    const printed = logs.join('\n');
    expect(printed).toContain('127.0.0.1:5001');
  });

  // ---------------------------------------------------------------------------
  // --json flag
  // ---------------------------------------------------------------------------

  describe('--json flag', () => {
    it('`addresses --json` prints a single JSON value to stdout and nothing else', async () => {
      const logs: string[] = [];
      const errors: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((s: unknown) => logs.push(String(s)));
      vi.spyOn(console, 'error').mockImplementation((s: unknown) => errors.push(String(s)));
      const h = harness();
      await h.prog.parseAsync(['addresses', '0xABC', '--json'], { from: 'user' });
      expect(logs).toHaveLength(1);
      const parsed = JSON.parse(logs[0]!);
      expect(parsed).toMatchObject({ treeRoot: '0xroot', treeCid: 'bafyfake' });
      expect(errors).toHaveLength(0);
    });

    it('`addresses --json` output is 2-space indented JSON', async () => {
      const logs: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((s: unknown) => logs.push(String(s)));
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const h = harness();
      await h.prog.parseAsync(['addresses', '0xABC', '--json'], { from: 'user' });
      expect(logs[0]).toBe(JSON.stringify(RESULT, null, 2));
    });

    it('`addresses --json` does NOT print human report lines', async () => {
      const logs: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((s: unknown) => logs.push(String(s)));
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const h = harness();
      await h.prog.parseAsync(['addresses', '0xABC', '--json'], { from: 'user' });
      expect(logs.join('\n')).not.toContain('ICS tree root');
    });

    it('`strikes --json` prints a single JSON value matching MakeResult', async () => {
      const logs: string[] = [];
      const errors: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((s: unknown) => logs.push(String(s)));
      vi.spyOn(console, 'error').mockImplementation((s: unknown) => errors.push(String(s)));
      const h = harness();
      await h.prog.parseAsync(['strikes', 'strikes.json', '--json'], { from: 'user' });
      expect(logs).toHaveLength(1);
      const parsed = JSON.parse(logs[0]!);
      expect(parsed).toEqual({ treeRoot: '0xroot', treeCid: 'bafyfake' });
      expect(errors).toHaveLength(0);
    });

    it('`strikes --json` does NOT print human report lines', async () => {
      const logs: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((s: unknown) => logs.push(String(s)));
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const h = harness();
      await h.prog.parseAsync(['strikes', 'strikes.json', '--json'], { from: 'user' });
      expect(logs.join('\n')).not.toContain('Strikes tree root');
    });

    it('`rewards --json` prints { treeRoot, treeCid, logCid } as JSON', async () => {
      const logs: string[] = [];
      const errors: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((s: unknown) => logs.push(String(s)));
      vi.spyOn(console, 'error').mockImplementation((s: unknown) => errors.push(String(s)));
      const rewardsFile = tmp('rewards-json.json', [[0, 1000]]);
      const h = harness();
      await h.prog.parseAsync(['rewards', '--source', rewardsFile, '--json'], { from: 'user' });
      expect(logs).toHaveLength(1);
      const parsed = JSON.parse(logs[0]!);
      expect(parsed).toMatchObject({ treeRoot: '0xroot', treeCid: 'bafyfake', logCid: 'bafylog' });
      expect(errors).toHaveLength(0);
    });

    it('error from pipeline prints to stderr only, not stdout', async () => {
      const logs: string[] = [];
      const errors: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((s: unknown) => logs.push(String(s)));
      vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) =>
        errors.push(args.map(String).join(' ')),
      );
      // Intercept process.exit so the test process doesn't die; resolve a promise so we can await
      // the async error path that fires after parseAsync returns.
      let exitResolve!: () => void;
      const exitCalled = new Promise<void>((r) => (exitResolve = r));
      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
        exitResolve();
        return undefined as never;
      });
      const prog = buildProgram({
        makeIcs: async () => {
          throw new Error('pipeline failure');
        },
        makeStrikes: async () => ({ treeRoot: '0x0', treeCid: undefined }),
        makeRewards: async () => ({ treeRoot: '0x0', treeCid: undefined }),
      })
        .exitOverride()
        .configureOutput({ writeOut: () => undefined, writeErr: () => undefined });
      await prog.parseAsync(['addresses', '0xABC', '--json'], { from: 'user' });
      // wait for the async catch handler to complete
      await exitCalled;
      expect(logs).toHaveLength(0);
      expect(errors.join(' ')).toContain('pipeline failure');
      mockExit.mockRestore();
    });

    it('help cheat-sheet documents --json', async () => {
      const logs: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((s: unknown) => logs.push(String(s)));
      const h = harness();
      await h.prog.parseAsync(['help'], { from: 'user' });
      const printed = logs.join('\n');
      expect(printed).toContain('--json');
    });
  });
});
