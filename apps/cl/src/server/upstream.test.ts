/**
 * Hermetic tests for the cached upstream proxy in beacon.ts.
 *
 * Contract:
 *  • cache MISS  → fetch from upstream, cache in store, return data
 *  • cache HIT   → serve from store, do NOT re-fetch
 *  • upstream error / network failure → fall back to mock-only (graceful)
 *  • upstream disabled → mock-only behavior unchanged
 *  • cached entries appear in /admin/save snapshot
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { store } from './store';
import { registerBeaconRoutes } from './beacon';
import { registerValidatorRoutes } from './admin';
import { loadStateFromFile } from '@sm-lab/core';
import { buildApp } from './app';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PUBKEY_A = '0x' + 'a'.repeat(96);
const PUBKEY_B = '0x' + 'b'.repeat(96);
const VALIDATORS_ENDPOINT = '/eth/v1/beacon/states/head/validators';

/** Build a minimal Hono app with beacon routes + injected fetch. */
function buildBeaconApp(fetchFn: typeof fetch, upstreamUrl?: string): Hono {
  const app = new Hono();
  app.use('*', cors());
  registerBeaconRoutes(app, { upstreamUrl, fetchFn });
  registerValidatorRoutes(app);
  return app;
}

/** Fake upstream response for a single validator. */
function makeUpstreamResponse(pubkey: string, status = 'active_ongoing') {
  return {
    execution_optimistic: false,
    finalized: true,
    data: [
      {
        index: '12345',
        balance: '32100000000',
        status,
        validator: {
          pubkey,
          withdrawal_credentials: '0x01' + '0'.repeat(62),
          effective_balance: '32000000000',
          slashed: false,
          activation_eligibility_epoch: '0',
          activation_epoch: '0',
          exit_epoch: '18446744073709551615',
          withdrawable_epoch: '18446744073709551615',
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Clean up the global store between tests to avoid cross-test pollution.
// ---------------------------------------------------------------------------

afterEach(() => {
  store.clear();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Cache MISS → fetch from upstream, cache result, return data
// ---------------------------------------------------------------------------

describe('upstream proxy — cache miss', () => {
  it('fetches from upstream on a miss and returns data', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeUpstreamResponse(PUBKEY_A),
    } as unknown as Response) as unknown as typeof fetch;

    const app = buildBeaconApp(fakeFetch, 'http://upstream:5052');

    const res = await app.request(`${VALIDATORS_ENDPOINT}?id=${PUBKEY_A}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ status: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.status).toBe('active_ongoing');

    expect(fakeFetch).toHaveBeenCalledTimes(1);
    const calledUrl = (fakeFetch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(calledUrl).toContain('upstream:5052');
    expect(calledUrl).toContain(PUBKEY_A);
  });

  it('caches the upstream result in the store', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeUpstreamResponse(PUBKEY_A),
    } as unknown as Response) as unknown as typeof fetch;

    const app = buildBeaconApp(fakeFetch, 'http://upstream:5052');

    // First request: miss → fetch + cache.
    await app.request(`${VALIDATORS_ENDPOINT}?id=${PUBKEY_A}`);

    expect(store.get(PUBKEY_A)).toBeDefined();
    expect(store.get(PUBKEY_A)?.status).toBe('active_ongoing');
  });
});

// ---------------------------------------------------------------------------
// Cache HIT → serve from store, no re-fetch
// ---------------------------------------------------------------------------

describe('upstream proxy — cache hit', () => {
  it('serves from store on a hit and does NOT call fetch', async () => {
    const fakeFetch = vi.fn() as unknown as typeof fetch;

    // Pre-populate the store (simulates a prior upstream fetch or manual POST).
    store.set(PUBKEY_A, { status: 'active_ongoing' });

    const app = buildBeaconApp(fakeFetch, 'http://upstream:5052');

    const res = await app.request(`${VALIDATORS_ENDPOINT}?id=${PUBKEY_A}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ status: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.status).toBe('active_ongoing');

    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it('serves hit validators from store and fetches only misses', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeUpstreamResponse(PUBKEY_B),
    } as unknown as Response) as unknown as typeof fetch;

    // PUBKEY_A already in store; PUBKEY_B is a miss.
    store.set(PUBKEY_A, { status: 'exited_unslashed' });

    const app = buildBeaconApp(fakeFetch, 'http://upstream:5052');

    const res = await app.request(`${VALIDATORS_ENDPOINT}?id=${PUBKEY_A},${PUBKEY_B}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ status: string }> };
    expect(body.data).toHaveLength(2);

    // fetch called only for the miss (PUBKEY_B).
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    const calledUrl = (fakeFetch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(calledUrl).toContain(PUBKEY_B);
    expect(calledUrl).not.toContain(PUBKEY_A);
  });
});

// ---------------------------------------------------------------------------
// Upstream error → fall back to mock-only behavior gracefully
// ---------------------------------------------------------------------------

describe('upstream proxy — upstream error fallback', () => {
  it('returns mock data (empty) when upstream throws a network error', async () => {
    const fakeFetch = vi
      .fn()
      .mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;

    const app = buildBeaconApp(fakeFetch, 'http://upstream:5052');

    const res = await app.request(`${VALIDATORS_ENDPOINT}?id=${PUBKEY_A}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    // Upstream failed + PUBKEY_A not in store → empty data (not a crash).
    expect(body.data).toHaveLength(0);
  });

  it('returns mock data (empty) when upstream returns a non-ok response', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ message: 'service unavailable' }),
    } as unknown as Response) as unknown as typeof fetch;

    const app = buildBeaconApp(fakeFetch, 'http://upstream:5052');

    const res = await app.request(`${VALIDATORS_ENDPOINT}?id=${PUBKEY_A}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(0);
  });

  it('still serves store-cached validators even when upstream fails', async () => {
    const fakeFetch = vi.fn().mockRejectedValue(new Error('timeout')) as unknown as typeof fetch;

    store.set(PUBKEY_A, { status: 'active_ongoing' });
    const app = buildBeaconApp(fakeFetch, 'http://upstream:5052');

    // PUBKEY_A is in store (hit); PUBKEY_B is a miss that will fail upstream.
    const res = await app.request(`${VALIDATORS_ENDPOINT}?id=${PUBKEY_A},${PUBKEY_B}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ status: string }> };
    // Only PUBKEY_A returned; PUBKEY_B silently omitted.
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.status).toBe('active_ongoing');
  });
});

// ---------------------------------------------------------------------------
// Upstream disabled → pure mock behavior
// ---------------------------------------------------------------------------

describe('upstream proxy — disabled (no upstreamUrl)', () => {
  it('does not call fetch and returns only store data', async () => {
    const fakeFetch = vi.fn() as unknown as typeof fetch;
    store.set(PUBKEY_A, { status: 'active_ongoing' });

    const app = buildBeaconApp(fakeFetch /* no upstreamUrl */);

    const res = await app.request(`${VALIDATORS_ENDPOINT}?id=${PUBKEY_A},${PUBKEY_B}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ status: string }> };
    // Only PUBKEY_A (in store); PUBKEY_B absent — and no upstream fetch.
    expect(body.data).toHaveLength(1);
    expect(fakeFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Cached upstream entries appear in /admin/save snapshot
// ---------------------------------------------------------------------------

describe('upstream cached entries appear in state snapshot', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('entry fetched from upstream is included in /admin/save output', async () => {
    dir = mkdtempSync(join(tmpdir(), 'cl-mock-upstream-'));
    const file = join(dir, 'snap.json');

    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeUpstreamResponse(PUBKEY_A),
    } as unknown as Response) as unknown as typeof fetch;

    // Use buildApp so registerStateRoutes is wired.
    const app = buildApp({
      statePath: file,
      upstreamUrl: 'http://upstream:5052',
      fetchFn: fakeFetch,
    });

    // Trigger a beacon request that will miss and fetch from upstream.
    await app.request(`${VALIDATORS_ENDPOINT}?id=${PUBKEY_A}`);

    const saveRes = await app.request('/admin/save', { method: 'POST' });
    expect(saveRes.status).toBe(200);

    const snap = loadStateFromFile<{ validators: Array<{ pubkey: string }> }>(file);
    expect(snap?.validators.some((v) => v.pubkey === PUBKEY_A.toLowerCase())).toBe(true);
  });
});
