import { describe, expect, it, vi } from 'vitest';
import { createApp } from './app';
import { computeCid, jsonToBytes } from './cid';
import { PinStore } from './store';
import type { UpstreamFetcher } from './upstream';

// Precomputed once (see cid.ts: CIDv1 / raw / sha2-256). Hard-coded so a CID-format
// regression is caught loudly rather than silently re-deriving a wrong "expected".
const FIXTURE = { treeRoot: '0xdeadbeef', leaves: [1, 2, 3] };
const FIXTURE_CID = 'bafkreifekxp6vnkwgjuoau54zf3mu6ftem6lvw6hiojng6vmghh4p76ol4';

/** A stub upstream fetcher that never touches the network, recording its calls. */
function stubUpstream(body: string): { fetcher: UpstreamFetcher; calls: string[] } {
  const calls: string[] = [];
  const fetcher: UpstreamFetcher = async (cid) => {
    calls.push(cid);
    return {
      ok: true,
      status: 200,
      contentType: 'text/plain',
      data: new TextEncoder().encode(body),
    };
  };
  return { fetcher, calls };
}

/** A fetcher that always reports the upstream as unreachable (502). */
const failingUpstream: UpstreamFetcher = async (cid) => ({
  ok: false,
  status: 502,
  contentType: 'application/json',
  data: new TextEncoder().encode(JSON.stringify({ error: 'unreachable', cid })),
});

describe('computeCid', () => {
  it('is deterministic and matches the precomputed CID for a fixed JSON', async () => {
    expect(await computeCid(jsonToBytes(FIXTURE))).toBe(FIXTURE_CID);
    expect(await computeCid(jsonToBytes(FIXTURE))).toBe(FIXTURE_CID);
  });

  it('differs for different content', async () => {
    const a = await computeCid(jsonToBytes({ a: 1 }));
    const b = await computeCid(jsonToBytes({ a: 2 }));
    expect(a).not.toBe(b);
  });
});

describe('pinJSONToIPFS → gateway round-trip', () => {
  it('pins JSON and serves identical content back from /ipfs/:cid', async () => {
    const { app } = createApp({ store: new PinStore(), fetchUpstream: stubUpstream('').fetcher });

    const pinRes = await app.request('/pinning/pinJSONToIPFS', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(FIXTURE),
    });
    expect(pinRes.status).toBe(200);
    const pin = (await pinRes.json()) as { IpfsHash: string; PinSize: number; Timestamp: string };
    expect(pin.IpfsHash).toBe(FIXTURE_CID);
    expect(pin.PinSize).toBe(jsonToBytes(FIXTURE).length);
    expect(typeof pin.Timestamp).toBe('string');

    const getRes = await app.request(`/ipfs/${pin.IpfsHash}`);
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toEqual(FIXTURE);
  });

  it('unwraps the Pinata { pinataContent, pinataMetadata } envelope', async () => {
    const { app } = createApp({ store: new PinStore() });
    const res = await app.request('/pinning/pinJSONToIPFS', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinataContent: FIXTURE, pinataMetadata: { name: 'tree.json' } }),
    });
    const pin = (await res.json()) as { IpfsHash: string };
    // CID must be of the inner content, not the envelope.
    expect(pin.IpfsHash).toBe(FIXTURE_CID);
  });
});

describe('pinFileToIPFS', () => {
  it('pins an uploaded file and serves it back', async () => {
    const { app } = createApp({ store: new PinStore() });
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const fd = new FormData();
    fd.append('file', new File([bytes], 'blob.bin', { type: 'application/octet-stream' }));

    const res = await app.request('/pinning/pinFileToIPFS', { method: 'POST', body: fd });
    expect(res.status).toBe(200);
    const pin = (await res.json()) as { IpfsHash: string; PinSize: number };
    expect(pin.PinSize).toBe(5);
    expect(pin.IpfsHash).toBe(await computeCid(bytes));

    const get = await app.request(`/ipfs/${pin.IpfsHash}`);
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(bytes);
  });

  it('rejects a request with no file field', async () => {
    const { app } = createApp({ store: new PinStore() });
    const res = await app.request('/pinning/pinFileToIPFS', {
      method: 'POST',
      body: new FormData(),
    });
    expect(res.status).toBe(400);
  });
});

describe('pinList + unpin', () => {
  it('reflects pins in pinList and removes them on unpin', async () => {
    const { app } = createApp({ store: new PinStore() });
    await app.request('/pinning/pinJSONToIPFS', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(FIXTURE),
    });

    const listed = (await (await app.request('/data/pinList')).json()) as {
      count: number;
      rows: Array<{ ipfs_pin_hash: string }>;
    };
    expect(listed.count).toBe(1);
    expect(listed.rows[0]?.ipfs_pin_hash).toBe(FIXTURE_CID);

    const del = await app.request(`/pinning/unpin/${FIXTURE_CID}`, { method: 'DELETE' });
    expect(del.status).toBe(200);

    const after = (await (await app.request('/data/pinList')).json()) as { count: number };
    expect(after.count).toBe(0);

    const missing = await app.request(`/pinning/unpin/${FIXTURE_CID}`, { method: 'DELETE' });
    expect(missing.status).toBe(404);
  });
});

describe('gateway proxy (hermetic, injected upstream)', () => {
  it('store MISS triggers exactly one upstream call and relays its body', async () => {
    const { fetcher, calls } = stubUpstream('proxied-content');
    const { app } = createApp({ store: new PinStore(), fetchUpstream: fetcher });

    // A real, valid CID we never pinned.
    const unknownCid = 'bafkreichphvmdj4uyj3x4bwnmmaor6vdqanqlencshsyd4wwuigbt7jy3i';
    const res = await app.request(`/ipfs/${unknownCid}`);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('proxied-content');
    expect(calls).toEqual([unknownCid]);
  });

  it('store HIT does NOT call upstream', async () => {
    const fetcher = vi.fn<UpstreamFetcher>();
    const store = new PinStore();
    const { app } = createApp({ store, fetchUpstream: fetcher });

    const pin = (await (
      await app.request('/pinning/pinJSONToIPFS', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(FIXTURE),
      })
    ).json()) as { IpfsHash: string };

    const res = await app.request(`/ipfs/${pin.IpfsHash}`);
    expect(res.status).toBe(200);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('caches proxied content so a second read is a local HIT', async () => {
    const { fetcher, calls } = stubUpstream('cached-once');
    const { app } = createApp({ store: new PinStore(), fetchUpstream: fetcher });
    const unknownCid = 'bafkreichphvmdj4uyj3x4bwnmmaor6vdqanqlencshsyd4wwuigbt7jy3i';

    await app.request(`/ipfs/${unknownCid}`);
    await app.request(`/ipfs/${unknownCid}`);
    expect(calls).toEqual([unknownCid]); // only the first read hit upstream
  });

  it('rejects a syntactically invalid CID with 400 (no upstream call)', async () => {
    const { fetcher, calls } = stubUpstream('');
    const { app } = createApp({ store: new PinStore(), fetchUpstream: fetcher });
    const res = await app.request('/ipfs/not-a-cid');
    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('relays an upstream failure as 502', async () => {
    const { app } = createApp({ store: new PinStore(), fetchUpstream: failingUpstream });
    const res = await app.request(
      '/ipfs/bafkreichphvmdj4uyj3x4bwnmmaor6vdqanqlencshsyd4wwuigbt7jy3i',
    );
    expect(res.status).toBe(502);
  });
});

describe('CORS', () => {
  it('echoes Access-Control-Allow-Origin on the gateway response', async () => {
    const { app } = createApp({ store: new PinStore(), fetchUpstream: stubUpstream('').fetcher });
    const pin = (await (
      await app.request('/pinning/pinJSONToIPFS', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:3000' },
        body: JSON.stringify(FIXTURE),
      })
    ).json()) as { IpfsHash: string };

    const res = await app.request(`/ipfs/${pin.IpfsHash}`, {
      headers: { Origin: 'http://127.0.0.1:3000' },
    });
    // Default cors() is fully permissive ('*') — covers localhost AND 127.0.0.1 alike.
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('answers a CORS preflight (OPTIONS) for the pinning API', async () => {
    const { app } = createApp({ store: new PinStore() });
    const res = await app.request('/pinning/pinJSONToIPFS', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://127.0.0.1:3000',
        'Access-Control-Request-Method': 'POST',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('admin status', () => {
  it('reports pin totals and the configured gateway', async () => {
    const { app } = createApp({ store: new PinStore(), gateway: 'https://example.test' });
    await app.request('/pinning/pinJSONToIPFS', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(FIXTURE),
    });
    const status = (await (await app.request('/admin/status')).json()) as {
      ok: boolean;
      gateway: string;
      pins: { total: number; totalBytes: number };
    };
    expect(status.ok).toBe(true);
    expect(status.gateway).toBe('https://example.test');
    expect(status.pins.total).toBe(1);
    expect(status.pins.totalBytes).toBeGreaterThan(0);
  });
});
