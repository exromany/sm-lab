import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Hex } from '@csm-lab/receipts';
import { clActivate } from '../src/recipes/cl-activate';
import { getKeyBalance } from '../src/recipes/reads';
import { setClValidator } from '../src/cl-mock';
import { makeFakeClient } from './helpers/fake-client';
import { fakeCtx } from './helpers/book';

const CL_MOCK_URL = 'http://127.0.0.1:9596';
const PUBKEY = `0x${'ab'.repeat(48)}` as Hex; // 48 bytes = 96 hex chars

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('clActivate', () => {
  it('reads pubkey + balance on-chain, then POSTs active_ongoing with the gwei effective balance', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ accepted: 1, errors: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const fc = makeFakeClient({
      reads: { getSigningKeys: PUBKEY, getKeyAllocatedBalances: [0n] },
    });
    const ctx = fakeCtx('csm', fc.client, {}, { clMockUrl: CL_MOCK_URL });

    const res = await clActivate(ctx, { noId: 7n, keyIndex: 3n });

    // both reads happened with [noId, keyIndex, 1n]
    const reads = fc.byMethod('readContract') as Array<{ functionName: string; args: unknown }>;
    const signing = reads.find((r) => r.functionName === 'getSigningKeys');
    const alloc = reads.find((r) => r.functionName === 'getKeyAllocatedBalances');
    expect(signing?.args).toEqual([7n, 3n, 1n]);
    expect(alloc?.args).toEqual([7n, 3n, 1n]);

    // POST request shape
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${CL_MOCK_URL}/admin/validators`);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({
      pubkey: PUBKEY,
      status: 'active_ongoing',
      effective_balance: '32000000000',
    });

    // return value
    expect(res).toEqual({
      pubkey: PUBKEY,
      status: 'active_ongoing',
      effectiveBalanceGwei: 32_000_000_000n,
    });
  });

  it('carries gwei precision (floors sub-gwei dust), not integer-ETH truncation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ accepted: 1, errors: [] }));
    vi.stubGlobal('fetch', fetchMock);

    // 1.5 gwei = 1_500_000_000 wei → floor(1.5e9 / 1e9) = +1 gwei over the 32 ETH base.
    const fc = makeFakeClient({
      reads: { getSigningKeys: PUBKEY, getKeyAllocatedBalances: [1_500_000_000n] },
    });
    const ctx = fakeCtx('csm', fc.client, {}, { clMockUrl: CL_MOCK_URL });

    const res = await clActivate(ctx, { noId: 0n, keyIndex: 0n });
    expect(res.effectiveBalanceGwei).toBe(32_000_000_001n);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(init.body).effective_balance).toBe('32000000001');
  });

  it('adds a realistic 2 ETH alloc as 2e9 gwei on top of the 32 ETH base', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ accepted: 1, errors: [] }));
    vi.stubGlobal('fetch', fetchMock);

    // 2 ETH = 2e18 wei → 2e9 gwei; total 34e9 gwei.
    const fc = makeFakeClient({
      reads: { getSigningKeys: PUBKEY, getKeyAllocatedBalances: [2_000_000_000_000_000_000n] },
    });
    const ctx = fakeCtx('csm', fc.client, {}, { clMockUrl: CL_MOCK_URL });

    const res = await clActivate(ctx, { noId: 0n, keyIndex: 0n });
    expect(res.effectiveBalanceGwei).toBe(34_000_000_000n);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(init.body).effective_balance).toBe('34000000000');
  });

  it('throws when ctx.clMockUrl is unset — before any chain read or fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const fc = makeFakeClient({
      reads: { getSigningKeys: PUBKEY, getKeyAllocatedBalances: [0n] },
    });
    const ctx = fakeCtx('csm', fc.client); // no `extra` → no clMockUrl

    await expect(clActivate(ctx, { noId: 0n, keyIndex: 0n })).rejects.toThrow(/clMockUrl/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fc.byMethod('readContract')).toHaveLength(0);
  });

  it('throws on a cl-mock 400 (all rejected), surfacing errors[]', async () => {
    // Fresh Response per call: a Response body is single-read, so a shared mock would be
    // already-consumed on the second call (its .json() would reject and get swallowed).
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => jsonResponse({ errors: ['invalid pubkey'] }, 400));
    vi.stubGlobal('fetch', fetchMock);

    const fc = makeFakeClient({
      reads: { getSigningKeys: PUBKEY, getKeyAllocatedBalances: [0n] },
    });
    const ctx = fakeCtx('csm', fc.client, {}, { clMockUrl: CL_MOCK_URL });

    await expect(clActivate(ctx, { noId: 0n, keyIndex: 0n })).rejects.toThrow(/400/);
    await expect(clActivate(ctx, { noId: 0n, keyIndex: 0n })).rejects.toThrow(/invalid pubkey/);
  });

  it('throws on a synthetic 207 / accepted:0 (defensive guard branch — the mock never emits this for one item)', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => jsonResponse({ accepted: 0, errors: ['rejected'] }, 207));
    vi.stubGlobal('fetch', fetchMock);

    const fc = makeFakeClient({
      reads: { getSigningKeys: PUBKEY, getKeyAllocatedBalances: [0n] },
    });
    const ctx = fakeCtx('csm', fc.client, {}, { clMockUrl: CL_MOCK_URL });

    await expect(clActivate(ctx, { noId: 0n, keyIndex: 0n })).rejects.toThrow(/rejected/);
  });

  it('throws on an empty/short pubkey (no key at index) — never calls fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const fc = makeFakeClient({ reads: { getSigningKeys: '0x' } }); // size 0
    const ctx = fakeCtx('csm', fc.client, {}, { clMockUrl: CL_MOCK_URL });

    await expect(clActivate(ctx, { noId: 9n, keyIndex: 2n })).rejects.toThrow(/no key found/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('getKeyBalance', () => {
  it('throws when getKeyAllocatedBalances returns an empty array', async () => {
    const fc = makeFakeClient({ reads: { getKeyAllocatedBalances: [] } });
    const ctx = fakeCtx('csm', fc.client);
    await expect(getKeyBalance(ctx, { noId: 1n, keyIndex: 0n })).rejects.toThrow(
      /no allocated balance/,
    );
  });
});

describe('setClValidator', () => {
  it('POSTs the right URL/body and strips a trailing slash on clMockUrl', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ accepted: 1, errors: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await setClValidator('http://127.0.0.1:9596/', {
      pubkey: PUBKEY,
      status: 'active_ongoing',
      effectiveBalanceGwei: 32_000_000_000n,
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:9596/admin/validators');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      pubkey: PUBKEY,
      status: 'active_ongoing',
      effective_balance: '32000000000',
    });
  });

  it('omits effective_balance when effectiveBalanceGwei is undefined', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ accepted: 1, errors: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await setClValidator(CL_MOCK_URL, { pubkey: PUBKEY, status: 'active_ongoing' });

    const [, init] = fetchMock.mock.calls[0]!;
    const parsed = JSON.parse(init.body);
    expect(parsed).toEqual({ pubkey: PUBKEY, status: 'active_ongoing' });
    expect('effective_balance' in parsed).toBe(false);
  });

  it('throws on a raw 400, surfacing errors[]', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ errors: ['invalid status'] }, 400)),
    );
    await expect(
      setClValidator(CL_MOCK_URL, { pubkey: PUBKEY, status: 'active_ongoing' }),
    ).rejects.toThrow(/invalid status/);
  });
});
