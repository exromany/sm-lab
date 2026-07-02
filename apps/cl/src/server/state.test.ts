/**
 * Hermetic tests for cl-mock state persistence.
 *
 * Covers:
 *  • ValidatorStore.snapshot() / restore() round-trip
 *  • restore() is tolerant of malformed entries
 *  • /admin/save and /admin/load via buildApp (registerStateRoutes wired)
 *  • boot-time restore: startServer loads state file if statePath is set
 *    (tested via store.restore() directly — we don't bind real ports)
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ValidatorStore, store } from './store';
import { buildApp } from './app';
import { saveStateToFile, loadStateFromFile } from '@sm-lab/core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'cl-mock-state-'));
}

const PUBKEY_A = '0x' + 'a'.repeat(96);
const PUBKEY_B = '0x' + 'b'.repeat(96);

// ---------------------------------------------------------------------------
// ValidatorStore snapshot / restore
// ---------------------------------------------------------------------------

describe('ValidatorStore.snapshot + restore', () => {
  it('round-trips an empty store', () => {
    const s = new ValidatorStore();
    const snap = s.snapshot();
    const s2 = new ValidatorStore();
    s2.restore(snap);
    expect(s2.size).toBe(0);
  });

  it('round-trips validators preserving entry fields', () => {
    const s = new ValidatorStore();
    s.set(PUBKEY_A, { status: 'active_ongoing', effective_balance: '32000000000' });
    s.set(PUBKEY_B, { status: 'exited_unslashed', index: 5 });

    const snap = s.snapshot();
    const s2 = new ValidatorStore();
    s2.restore(snap);

    expect(s2.size).toBe(2);
    expect(s2.get(PUBKEY_A)).toMatchObject({
      status: 'active_ongoing',
      effective_balance: '32000000000',
    });
    expect(s2.get(PUBKEY_B)).toMatchObject({ status: 'exited_unslashed', index: 5 });
  });

  it('full-fidelity file round-trip: all ValidatorEntry fields survive snapshot→file→restore', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'cl-mock-state-rt-'));
    try {
      const file = join(tmpDir, 'full-rt.json');
      const s = new ValidatorStore();
      s.set(PUBKEY_A, {
        status: 'active_ongoing',
        index: 7,
        balance: '32100000001',
        effective_balance: '32000000000',
        withdrawal_credentials: '0x' + 'c'.repeat(64),
        slashed: false,
      });
      s.set(PUBKEY_B, {
        status: 'withdrawal_done',
        index: 99,
        balance: '0',
        effective_balance: '0',
        withdrawal_credentials: '0x' + 'd'.repeat(64),
        slashed: true,
      });

      saveStateToFile(file, s.snapshot());

      const s2 = new ValidatorStore();
      s2.restore(loadStateFromFile(file));

      // All fields must survive — toEqual (not toMatchObject) catches any dropped field.
      expect(s2.get(PUBKEY_A)).toEqual({
        status: 'active_ongoing',
        index: 7,
        balance: '32100000001',
        effective_balance: '32000000000',
        withdrawal_credentials: '0x' + 'c'.repeat(64),
        slashed: false,
      });
      expect(s2.get(PUBKEY_B)).toEqual({
        status: 'withdrawal_done',
        index: 99,
        balance: '0',
        effective_balance: '0',
        withdrawal_credentials: '0x' + 'd'.repeat(64),
        slashed: true,
      });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('restore() clears pre-existing entries', () => {
    const s = new ValidatorStore();
    s.set(PUBKEY_A, { status: 'active_ongoing' });
    s.restore({ validators: [] });
    expect(s.size).toBe(0);
  });

  it('restore() skips entries with unknown status', () => {
    const s = new ValidatorStore();
    s.restore({
      validators: [
        { pubkey: PUBKEY_A, entry: { status: 'not_a_real_status' } },
        { pubkey: PUBKEY_B, entry: { status: 'active_ongoing' } },
      ],
    });
    expect(s.size).toBe(1);
    expect(s.get(PUBKEY_B)).toBeDefined();
  });

  it('restore() skips entries with invalid pubkey', () => {
    const s = new ValidatorStore();
    s.restore({
      validators: [{ pubkey: 'not-a-pubkey', entry: { status: 'active_ongoing' } }],
    });
    expect(s.size).toBe(0);
  });

  it('restore() handles non-object gracefully (no throw)', () => {
    const s = new ValidatorStore();
    s.set(PUBKEY_A, { status: 'active_ongoing' });
    s.restore(null);
    expect(s.size).toBe(0);
    s.restore('string');
    expect(s.size).toBe(0);
    s.restore(42);
    expect(s.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// /admin/save + /admin/load via buildApp (registerStateRoutes wired)
// ---------------------------------------------------------------------------

describe('/admin/save and /admin/load', () => {
  let dir: string;
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    // Reset the singleton store so tests don't bleed into each other.
    store.clear();
  });

  it('POST /admin/save writes current store to file', async () => {
    dir = makeTmpDir();
    const file = join(dir, 'snap.json');

    // buildApp wires registerStateRoutes but shares the module-level store singleton —
    // seed it through the admin API.
    const app = buildApp({ statePath: file });

    await app.request('/admin/validators', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([{ pubkey: PUBKEY_A, status: 'active_ongoing' }]),
    });

    const res = await app.request('/admin/save', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { saved: string };
    expect(body.saved).toBe(file);

    const snap = loadStateFromFile<{ validators: unknown[] }>(file);
    expect(snap?.validators).toHaveLength(1);
  });

  it('POST /admin/load restores state into the store', async () => {
    dir = makeTmpDir();
    const file = join(dir, 'snap.json');
    saveStateToFile(file, {
      validators: [{ pubkey: PUBKEY_B, entry: { status: 'exited_unslashed' } }],
    });

    const app = buildApp({ statePath: file });
    // Clear via DELETE first to ensure we start empty in the singleton.
    await app.request('/admin/validators', { method: 'DELETE' });

    const res = await app.request('/admin/load', { method: 'POST' });
    expect(res.status).toBe(200);

    const listRes = await app.request('/admin/validators');
    const list = (await listRes.json()) as Array<{ pubkey: string; status: string }>;
    expect(
      list.some((v) => v.pubkey === PUBKEY_B.toLowerCase() && v.status === 'exited_unslashed'),
    ).toBe(true);
  });

  it('POST /admin/load returns 404 when file is missing', async () => {
    dir = makeTmpDir();
    const app = buildApp({ statePath: join(dir, 'nonexistent.json') });
    const res = await app.request('/admin/load', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('POST /admin/save returns 400 when no statePath configured', async () => {
    dir = makeTmpDir();
    const app = buildApp(); // no statePath
    const res = await app.request('/admin/save', { method: 'POST' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/state path not configured/);
  });

  it('POST /admin/save ignores ?path= override (path traversal prevention)', async () => {
    dir = makeTmpDir();
    const stateFile = join(dir, 'state.json');
    const app = buildApp({ statePath: stateFile });
    const otherFile = join(dir, 'other.json');
    const res = await app.request(`/admin/save?path=${encodeURIComponent(otherFile)}`, {
      method: 'POST',
    });
    // Must use statePath (200), NOT write to otherFile.
    expect(res.status).toBe(200);
    expect(loadStateFromFile(otherFile)).toBeUndefined();
    expect(loadStateFromFile(stateFile)).toBeDefined();
  });
});
