/**
 * Hermetic CLI tests for sm-ipfs status --json compliance.
 *
 * Stubs global fetch so no network is required. Spies on console.log / console.error
 * to verify the --json contract: exactly one JSON value on stdout, nothing on stderr;
 * errors on stderr only, nothing on stdout.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { statusCommand } from './status';

/** Build a minimal root program with the given --url and attach the status sub-command. */
function buildProgram(url?: string): Command {
  const prog = new Command('sm-ipfs')
    .option('--url <url>', 'server URL', url ?? 'http://127.0.0.1:5001')
    .exitOverride()
    .configureOutput({ writeOut: () => undefined, writeErr: () => undefined });
  prog.addCommand(statusCommand);
  return prog;
}

/** Minimal /admin/status payload the mock server returns. */
const STATUS_PAYLOAD = {
  ok: true,
  version: '1.0.0',
  startedAt: '2026-01-01T00:00:00.000Z',
  uptimeSeconds: 42,
  gateway: 'https://dweb.link',
  pins: { total: 3, totalBytes: 1024 },
};

/** Stub global fetch to return the given payload as JSON with status 200. */
function stubFetchOk(payload: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => payload,
    } as unknown as Response),
  );
}

/** Stub global fetch to throw a connection-refused error. */
function stubFetchDown(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:5001')),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('status --json', () => {
  it('prints exactly one JSON value to stdout', async () => {
    stubFetchOk(STATUS_PAYLOAD);
    const logs: string[] = [];
    const errors: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((s: unknown) => logs.push(String(s)));
    vi.spyOn(console, 'error').mockImplementation((s: unknown) => errors.push(String(s)));

    await buildProgram().parseAsync(['status', '--json'], { from: 'user' });

    expect(logs).toHaveLength(1);
    expect(errors).toHaveLength(0);
  });

  it('stdout is valid 2-space-indented JSON matching the server payload', async () => {
    stubFetchOk(STATUS_PAYLOAD);
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((s: unknown) => logs.push(String(s)));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await buildProgram().parseAsync(['status', '--json'], { from: 'user' });

    const parsed = JSON.parse(logs[0]!);
    expect(parsed).toEqual(STATUS_PAYLOAD);
    // 2-space indent: must match JSON.stringify with 2 spaces
    expect(logs[0]).toBe(JSON.stringify(STATUS_PAYLOAD, null, 2));
  });

  it('does NOT print human-readable lines when --json is set', async () => {
    stubFetchOk(STATUS_PAYLOAD);
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((s: unknown) => logs.push(String(s)));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await buildProgram().parseAsync(['status', '--json'], { from: 'user' });

    const out = logs.join('\n');
    expect(out).not.toContain('URL:');
    expect(out).not.toContain('Status:');
    expect(out).not.toContain('Gateway:');
    expect(out).not.toContain('Pins:');
  });

  it('includes the app-specific fields (gateway + pins) in the JSON', async () => {
    stubFetchOk(STATUS_PAYLOAD);
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((s: unknown) => logs.push(String(s)));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await buildProgram().parseAsync(['status', '--json'], { from: 'user' });

    const parsed = JSON.parse(logs[0]!) as typeof STATUS_PAYLOAD;
    expect(parsed.gateway).toBe('https://dweb.link');
    expect(parsed.pins).toEqual({ total: 3, totalBytes: 1024 });
  });
});

describe('status (human output)', () => {
  it('prints human-readable lines without --json', async () => {
    stubFetchOk(STATUS_PAYLOAD);
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((s: unknown) => logs.push(String(s)));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await buildProgram().parseAsync(['status'], { from: 'user' });

    const out = logs.join('\n');
    expect(out).toContain('URL:');
    expect(out).toContain('Status:');
    expect(out).toContain('Gateway:');
    expect(out).toContain('Pins:');
  });
});

describe('status error handling', () => {
  /**
   * Mock process.exit to throw a sentinel so the async action stops executing.
   * Without throwing, commander's action would continue past the catch block and
   * crash on `res.ok` (res is unassigned after a failed fetch).
   */
  class ExitError extends Error {
    constructor(public code: number) {
      super(`process.exit(${code})`);
    }
  }

  it('when server is offline: prints offline message to stderr and exits 1', async () => {
    // The core createStatusCommand prints offline message to console.error and exits 1.
    stubFetchDown();
    const errors: string[] = [];
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args.map(String).join(' ')));
    vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      throw new ExitError(typeof code === 'number' ? code : 0);
    });

    let caught: ExitError | undefined;
    try {
      await buildProgram().parseAsync(['status'], { from: 'user' });
    } catch (e) {
      if (e instanceof ExitError) caught = e;
      else throw e;
    }

    expect(caught?.code).toBe(1);
    // The offline message goes to stderr and contains the URL and the error reason
    expect(errors.some((l) => l.includes('offline'))).toBe(true);
  });

  it('when server is offline with --json: exit code is 1 and no JSON printed to stdout', async () => {
    stubFetchDown();
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((s: unknown) => logs.push(String(s)));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      throw new ExitError(typeof code === 'number' ? code : 0);
    });

    let caught: ExitError | undefined;
    try {
      await buildProgram().parseAsync(['status', '--json'], { from: 'user' });
    } catch (e) {
      if (e instanceof ExitError) caught = e;
      else throw e;
    }

    expect(caught?.code).toBe(1);
    // No valid JSON object should appear on stdout when offline
    const jsonLogs = logs.filter((l) => {
      try {
        JSON.parse(l);
        return true;
      } catch {
        return false;
      }
    });
    expect(jsonLogs).toHaveLength(0);
  });
});

describe('help cheat-sheet documents --json', () => {
  it('contains FLAGS section with --json', async () => {
    const { helpCommand } = await import('./help');
    const logs: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((s: unknown) => {
      logs.push(String(s));
      return true;
    });

    const prog = new Command('sm-ipfs').exitOverride();
    prog.addCommand(helpCommand);
    await prog.parseAsync(['help'], { from: 'user' });

    const printed = logs.join('');
    expect(printed).toContain('--json');
    expect(printed).toContain('FLAGS');
    // Must include an example showing status --json
    expect(printed).toContain('status --json');
  });
});
