import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command } from 'commander';
import { findRoot, resolveUrl, formatUptime } from './cli';

afterEach(() => vi.unstubAllEnvs());

/** Minimal Command-shaped stub: a leaf whose root carries the given parsed opts. */
function fakeCmd(rootOpts: Record<string, unknown>): Command {
  const root = { parent: undefined, opts: () => rootOpts } as unknown as Command;
  return { parent: root, opts: () => ({}) } as unknown as Command;
}

describe('findRoot', () => {
  it('climbs to the parentless root', () => {
    const root = { parent: undefined } as unknown as Command;
    const leaf = { parent: { parent: root } } as unknown as Command;
    expect(findRoot(leaf)).toBe(root);
  });
});

describe('resolveUrl', () => {
  const target = { envVar: 'TEST_MOCK_URL', defaultPort: 4242 };

  it('prefers the root --url option', () => {
    vi.stubEnv('TEST_MOCK_URL', 'http://from-env');
    expect(resolveUrl(fakeCmd({ url: 'http://from-flag' }), target)).toBe('http://from-flag');
  });

  it('falls back to the env var', () => {
    vi.stubEnv('TEST_MOCK_URL', 'http://from-env');
    expect(resolveUrl(fakeCmd({}), target)).toBe('http://from-env');
  });

  it('falls back to localhost:defaultPort when unset', () => {
    vi.stubEnv('TEST_MOCK_URL', undefined as unknown as string);
    expect(resolveUrl(fakeCmd({}), target)).toBe('http://127.0.0.1:4242');
  });
});

describe('formatUptime', () => {
  it('seconds only', () => expect(formatUptime(5)).toBe('5s'));
  it('minutes + seconds', () => expect(formatUptime(65)).toBe('1m 5s'));
  it('hours + minutes + seconds', () => expect(formatUptime(3661)).toBe('1h 1m 1s'));
});
