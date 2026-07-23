import { describe, it, expect, vi } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';
import type { PrismaClient } from '../src/db';
import { buildProgram, toKv, toStatus, type SeedCommand } from '../src/define';

const echo: SeedCommand = {
  group: 'demo',
  name: 'echo',
  summary: 'echo',
  options: [
    { flag: '--name <s>', desc: 'name' },
    { flag: '--tag <kv...>', desc: 'k=v', repeatable: true, kv: true },
  ],
  run: async (_p, args) => ({ ok: true, args }),
};

describe('toKv', () => {
  it('accumulates pairs', () => {
    const acc = toKv('a=1', undefined);
    expect(toKv('b=two', acc)).toEqual({ a: '1', b: 'two' });
  });
  it('throws without =', () => expect(() => toKv('bad', undefined)).toThrow());
});

describe('toStatus', () => {
  it('maps to PSL name', () => expect(toStatus('approved')).toBe('APPROVED'));
  it('throws on unknown', () => expect(() => toStatus('pending')).toThrow());
});

describe('buildProgram', () => {
  it('prints one JSON value with --json', async () => {
    const prisma = mockDeep<PrismaClient>();
    const out: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((s?: unknown) => void out.push(String(s)));
    await buildProgram(() => prisma, [echo]).parseAsync(
      ['demo', 'echo', '--name', 'x', '--tag', 'a=1', '--json'],
      { from: 'user' },
    );
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0]!)).toEqual({
      ok: true,
      args: { name: 'x', tag: { a: '1' }, json: true },
    });
    vi.restoreAllMocks();
  });

  it('prints { ok: true } sentinel when run() resolves to undefined', async () => {
    const prisma = mockDeep<PrismaClient>();
    const noop: SeedCommand = {
      group: 'demo',
      name: 'noop',
      summary: 'noop',
      options: [],
      run: async () => undefined,
    };
    const out: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((s?: unknown) => void out.push(String(s)));
    await buildProgram(() => prisma, [noop]).parseAsync(['demo', 'noop', '--json'], {
      from: 'user',
    });
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0]!)).toEqual({ ok: true });
    vi.restoreAllMocks();
  });

  it('exit 1 + Error: on throw', async () => {
    const prisma = mockDeep<PrismaClient>();
    const boom: SeedCommand = {
      group: 'demo',
      name: 'boom',
      summary: '',
      options: [],
      run: async () => {
        throw new Error('kaboom');
      },
    };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await buildProgram(() => prisma, [boom]).parseAsync(['demo', 'boom'], { from: 'user' });
    expect(process.exitCode).toBe(1);
    expect(err).toHaveBeenCalledWith(expect.stringContaining('Error: kaboom'));
    vi.restoreAllMocks();
    process.exitCode = 0;
  });
});
