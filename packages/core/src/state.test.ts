import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Hono } from 'hono';
import { loadStateFromFile, registerStateRoutes, saveStateToFile } from './state';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'sm-lab-core-state-'));
}

// ---------------------------------------------------------------------------
// saveStateToFile
// ---------------------------------------------------------------------------

describe('saveStateToFile', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes pretty JSON to a file', () => {
    dir = makeTmpDir();
    const file = join(dir, 'state.json');
    saveStateToFile(file, { count: 3, items: ['a', 'b'] });

    const loaded = loadStateFromFile<{ count: number; items: string[] }>(file);
    expect(loaded).toEqual({ count: 3, items: ['a', 'b'] });
  });

  it('atomic write: no .tmp file left behind after success', () => {
    dir = makeTmpDir();
    const file = join(dir, 'state.json');
    saveStateToFile(file, { ok: true });
    // The tmp file must be gone (renamed away).
    expect(loadStateFromFile(`${file}.tmp`)).toBeUndefined();
    // The real file must exist.
    expect(loadStateFromFile(file)).toEqual({ ok: true });
  });

  it('creates missing parent directories', () => {
    dir = makeTmpDir();
    const file = join(dir, 'deep', 'nested', 'state.json');
    saveStateToFile(file, { ok: true });
    expect(loadStateFromFile(file)).toEqual({ ok: true });
  });

  it('overwrites an existing file', () => {
    dir = makeTmpDir();
    const file = join(dir, 'state.json');
    saveStateToFile(file, { v: 1 });
    saveStateToFile(file, { v: 2 });
    expect(loadStateFromFile<{ v: number }>(file)?.v).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// loadStateFromFile
// ---------------------------------------------------------------------------

describe('loadStateFromFile', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns undefined when the file does not exist', () => {
    dir = makeTmpDir();
    expect(loadStateFromFile(join(dir, 'missing.json'))).toBeUndefined();
  });

  it('throws a clear error on malformed JSON', () => {
    dir = makeTmpDir();
    const file = join(dir, 'bad.json');
    writeFileSync(file, '{ not valid json', 'utf8');
    expect(() => loadStateFromFile(file)).toThrow(/malformed JSON/);
    expect(() => loadStateFromFile(file)).toThrow(resolve(file));
  });

  it('boot-restore degrades gracefully: wrapping in try/catch on a corrupt file does not throw', () => {
    // loadStateFromFile deliberately still throws on corrupt JSON — graceful degradation is the
    // caller's job (server.ts wraps the boot-restore in try/catch).
    dir = makeTmpDir();
    const file = join(dir, 'corrupt.json');
    writeFileSync(file, '{ "validators": [ truncated', 'utf8');

    // Simulate the server.ts boot-restore pattern:
    let restored = false;
    const errors: string[] = [];
    try {
      const saved = loadStateFromFile(file);
      if (saved !== undefined) restored = true;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
    // Must not have thrown out — store stays empty (restored=false), error captured.
    expect(restored).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/malformed JSON/);
  });

  it('parses a valid JSON file', () => {
    dir = makeTmpDir();
    const file = join(dir, 'state.json');
    saveStateToFile(file, [1, 2, 3]);
    expect(loadStateFromFile(file)).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// registerStateRoutes
// ---------------------------------------------------------------------------

describe('registerStateRoutes', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function makeApp(defaultPath?: string) {
    dir = makeTmpDir();
    let store: unknown = { initial: true };
    const app = new Hono();
    registerStateRoutes(app, {
      snapshot: () => store,
      restore: (s) => {
        store = s;
      },
      defaultPath,
    });
    return { app, getStore: () => store };
  }

  // POST /admin/save --------------------------------------------------------

  it('POST /admin/save uses defaultPath', async () => {
    dir = makeTmpDir();
    const file = join(dir, 'default.json');
    const { app } = makeApp(file);
    const res = await app.request('/admin/save', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { saved: string };
    expect(body.saved).toBe(file);
    expect(loadStateFromFile(file)).toEqual({ initial: true });
  });

  it('POST /admin/save returns 400 when defaultPath not configured', async () => {
    const { app } = makeApp(); // no defaultPath
    const res = await app.request('/admin/save', { method: 'POST' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/state path not configured/);
  });

  it('POST /admin/save ignores ?path= query param (security: no path traversal)', async () => {
    dir = makeTmpDir();
    const defaultFile = join(dir, 'default.json');
    const attemptedFile = join(dir, 'override.json');
    const { app } = makeApp(defaultFile);
    // Supplying ?path= must NOT write to the override path — it writes to defaultPath only.
    const res = await app.request(`/admin/save?path=${encodeURIComponent(attemptedFile)}`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { saved: string };
    // Response must reflect defaultPath, not the caller-supplied path.
    expect(body.saved).toBe(defaultFile);
    // Override file must NOT have been created.
    expect(loadStateFromFile(attemptedFile)).toBeUndefined();
    // Default file IS written.
    expect(loadStateFromFile(defaultFile)).toEqual({ initial: true });
  });

  // POST /admin/load --------------------------------------------------------

  it('POST /admin/load restores state from defaultPath', async () => {
    dir = makeTmpDir();
    const file = join(dir, 'snap.json');
    saveStateToFile(file, { restored: 42 });
    const { app, getStore } = makeApp(file);
    const res = await app.request('/admin/load', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { loaded: string };
    expect(body.loaded).toBe(file);
    expect(getStore()).toEqual({ restored: 42 });
  });

  it('POST /admin/load returns 404 when the configured file is missing', async () => {
    dir = makeTmpDir();
    const missing = join(dir, 'nonexistent.json');
    const { app } = makeApp(missing);
    const res = await app.request('/admin/load', { method: 'POST' });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/not found/);
  });

  it('POST /admin/load returns 400 when defaultPath not configured', async () => {
    const { app } = makeApp(); // no defaultPath
    const res = await app.request('/admin/load', { method: 'POST' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/state path not configured/);
  });

  it('POST /admin/load ignores ?path= query param (security: no path traversal)', async () => {
    dir = makeTmpDir();
    const defaultFile = join(dir, 'default.json');
    const otherFile = join(dir, 'other.json');
    saveStateToFile(defaultFile, { source: 'default' });
    saveStateToFile(otherFile, { source: 'other' });
    const { app, getStore } = makeApp(defaultFile);
    // Supplying ?path= pointing to otherFile must NOT load from it — only defaultPath is used.
    const res = await app.request(`/admin/load?path=${encodeURIComponent(otherFile)}`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    // Store must reflect defaultFile content, not otherFile.
    expect(getStore()).toEqual({ source: 'default' });
  });
});
