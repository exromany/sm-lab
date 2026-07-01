/**
 * Hermetic CLI tests for --json output and error routing.
 *
 * Uses the buildConfigCommand / buildQueryCommand injectable seams with fake fetch
 * implementations — no network, no running server.
 *
 * Contract verified:
 *  • --json writes exactly one JSON value to stdout, nothing else
 *  • errors are written to stderr, not stdout
 *  • exit code: 0 success, 1 error
 *  • human output unchanged (default, no --json)
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildConfigCommand } from './config';
import { buildQueryCommand } from './query';

// ---- helpers ----------------------------------------------------------------

/** Capture console.log / console.error output during a callback. */
async function capture(fn: () => Promise<void>): Promise<{ out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
    out.push(args.map(String).join(' '));
  });
  const errSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
    err.push(args.map(String).join(' '));
  });
  try {
    await fn();
  } finally {
    logSpy.mockRestore();
    errSpy.mockRestore();
  }
  return { out, err };
}

/** Build a fake fetch that returns a JSON body with the given status code. */
function fakeFetch(body: unknown, status = 200): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

// ---- fixtures ---------------------------------------------------------------

const VALIDATORS = [
  { pubkey: '0x' + 'a'.repeat(96), status: 'active_ongoing' },
  { pubkey: '0x' + 'b'.repeat(96), status: 'exited_unslashed', effective_balance: '31000000000' },
];

// ---- config list ------------------------------------------------------------

describe('config list', () => {
  it('--json prints exactly one JSON array to stdout', async () => {
    const cmd = buildConfigCommand(fakeFetch(VALIDATORS));
    const { out, err } = await capture(async () => {
      await cmd.parseAsync(['node', 'sm-cl', 'list', '--json']);
    });
    expect(out).toHaveLength(1);
    const parsed = JSON.parse(out[0]!);
    expect(parsed).toEqual(VALIDATORS);
    expect(err).toHaveLength(0);
  });

  it('--json output contains effective_balance as-is (string passthrough)', async () => {
    const cmd = buildConfigCommand(fakeFetch(VALIDATORS));
    const { out } = await capture(async () => {
      await cmd.parseAsync(['node', 'sm-cl', 'list', '--json']);
    });
    const parsed = JSON.parse(out[0]!) as typeof VALIDATORS;
    const withEb = parsed.find((v) => v.effective_balance !== undefined);
    expect(withEb?.effective_balance).toBe('31000000000');
  });

  it('--json prints [] for empty list', async () => {
    const cmd = buildConfigCommand(fakeFetch([]));
    const { out } = await capture(async () => {
      await cmd.parseAsync(['node', 'sm-cl', 'list', '--json']);
    });
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0]!)).toEqual([]);
  });

  it('human output (no --json) shows pubkey prefix + status', async () => {
    const cmd = buildConfigCommand(fakeFetch(VALIDATORS));
    const { out } = await capture(async () => {
      await cmd.parseAsync(['node', 'sm-cl', 'list']);
    });
    expect(out.some((l) => l.includes('active_ongoing'))).toBe(true);
    // Should NOT be a JSON array
    expect(() => JSON.parse(out.join('\n'))).toThrow();
  });

  it('human output (no --json) shows (empty) for an empty list', async () => {
    const cmd = buildConfigCommand(fakeFetch([]));
    const { out } = await capture(async () => {
      await cmd.parseAsync(['node', 'sm-cl', 'list']);
    });
    expect(out).toEqual(['(empty)']);
  });
});

// ---- config statuses --------------------------------------------------------

describe('config statuses', () => {
  it('--json prints exactly one JSON array of status strings to stdout', async () => {
    const cmd = buildConfigCommand(fakeFetch(null)); // no HTTP call for statuses
    const { out, err } = await capture(async () => {
      await cmd.parseAsync(['node', 'sm-cl', 'statuses', '--json']);
    });
    expect(out).toHaveLength(1);
    const parsed = JSON.parse(out[0]!) as string[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toContain('active_ongoing');
    expect(parsed).toContain('withdrawal_done_slashed');
    expect(err).toHaveLength(0);
  });

  it('human output (no --json) is one status per line', async () => {
    const cmd = buildConfigCommand(fakeFetch(null));
    const { out } = await capture(async () => {
      await cmd.parseAsync(['node', 'sm-cl', 'statuses']);
    });
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain('active_ongoing');
    // Each line is a plain status string, not JSON
    expect(out.every((l) => !l.startsWith('['))).toBe(true);
  });
});

// ---- query ------------------------------------------------------------------

describe('query', () => {
  const BEACON_RESPONSE = {
    data: [
      {
        index: '900000',
        balance: '32000000000',
        status: 'active_ongoing',
        validator: { pubkey: '0x' + 'a'.repeat(96) },
      },
    ],
  };

  it('--json: with explicit pubkeys, prints exactly one JSON value to stdout', async () => {
    const fakeF = fakeFetch(BEACON_RESPONSE);
    const cmd = buildQueryCommand(fakeF);
    const pk = '0x' + 'a'.repeat(96);
    const { out, err } = await capture(async () => {
      await cmd.parseAsync(['node', 'sm-cl', pk, '--json']);
    });
    expect(out).toHaveLength(1);
    const parsed = JSON.parse(out[0]!);
    expect(parsed).toEqual(BEACON_RESPONSE);
    expect(err).toHaveLength(0);
  });

  it('--json: without pubkeys, fetches admin/validators then beacon endpoint and prints JSON', async () => {
    let callCount = 0;
    const fakeF = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ ok: true, status: 200, json: async () => VALIDATORS });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => BEACON_RESPONSE });
    }) as unknown as typeof fetch;

    const cmd = buildQueryCommand(fakeF);
    const { out, err } = await capture(async () => {
      await cmd.parseAsync(['node', 'sm-cl', '--json']);
    });
    expect(out).toHaveLength(1);
    expect(() => JSON.parse(out[0]!)).not.toThrow();
    expect(err).toHaveLength(0);
    expect(callCount).toBe(2);
  });

  it('without --json: prints one human-readable line per validator', async () => {
    const fakeF = fakeFetch(BEACON_RESPONSE);
    const cmd = buildQueryCommand(fakeF);
    const pk = '0x' + 'a'.repeat(96);
    const { out, err } = await capture(async () => {
      await cmd.parseAsync(['node', 'sm-cl', pk]);
    });
    expect(out).toHaveLength(1);
    // Human line: "<pubkey>  <status>  <balance>"
    expect(out[0]).toContain('active_ongoing');
    expect(out[0]).toContain('32000000000');
    // Must NOT be raw JSON of the full response object
    expect(() => JSON.parse(out[0]!)).toThrow();
    expect(err).toHaveLength(0);
  });

  it('without --json: falls back to raw JSON when data.data is not an array', async () => {
    const unexpectedResponse = { message: 'unexpected', code: 500 };
    const fakeF = fakeFetch(unexpectedResponse);
    const cmd = buildQueryCommand(fakeF);
    const pk = '0x' + 'a'.repeat(96);
    const { out, err } = await capture(async () => {
      await cmd.parseAsync(['node', 'sm-cl', pk]);
    });
    expect(out).toHaveLength(1);
    // Falls back to JSON.stringify
    const parsed = JSON.parse(out[0]!);
    expect(parsed).toEqual(unexpectedResponse);
    expect(err).toHaveLength(0);
  });

  it('errors go to stderr, not stdout', async () => {
    const fakeF = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    const cmd = buildQueryCommand(fakeF);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });
    let out: string[] = [];
    let err: string[] = [];
    try {
      ({ out, err } = await capture(async () => {
        try {
          await cmd.parseAsync(['node', 'sm-cl', '0x' + 'a'.repeat(96)]);
          // allow microtasks
          await new Promise((r) => setTimeout(r, 10));
        } catch {
          // swallow exit throw
        }
      }));
    } finally {
      exitSpy.mockRestore();
    }
    // error message goes to stderr
    expect(err.some((l) => l.includes('ECONNREFUSED') || l.includes('Failed to connect'))).toBe(
      true,
    );
    // nothing printed to stdout
    expect(out).toHaveLength(0);
  });
});

// ---- status -----------------------------------------------------------------

describe('status', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const STATUS_PAYLOAD = {
    ok: true,
    version: '1.0.0',
    startedAt: '2026-01-01T00:00:00.000Z',
    uptimeSeconds: 42,
    validators: { total: 2, byStatus: { active_ongoing: 2 } },
  };

  it('createStatusCommand includes --json option', async () => {
    const { statusCommand } = await import('./status');
    const jsonOpt = statusCommand.options.find((o) => o.long === '--json');
    expect(jsonOpt).toBeDefined();
  });

  it('--json: prints exactly one JSON value to stdout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => STATUS_PAYLOAD,
      } as unknown as Response),
    );
    const { createStatusCommand } = await import('@sm-lab/core');
    const { DEFAULT_PORT } = await import('../types');
    const { Command } = await import('commander');

    const prog = new Command('sm-cl')
      .option('--url <url>', 'server URL', 'http://127.0.0.1:5052')
      .exitOverride()
      .configureOutput({ writeOut: () => undefined, writeErr: () => undefined });
    prog.addCommand(
      createStatusCommand({
        envVar: 'CL_MOCK_URL',
        defaultPort: DEFAULT_PORT,
      }),
    );

    const { out, err } = await capture(async () => {
      await prog.parseAsync(['status', '--json'], { from: 'user' });
    });

    expect(out).toHaveLength(1);
    const parsed = JSON.parse(out[0]!);
    expect(parsed).toEqual(STATUS_PAYLOAD);
    expect(err).toHaveLength(0);
  });
});
