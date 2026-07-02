import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from './app';
import { computeCid, jsonToBytes } from './cid';
import { PinStore, snapshotStore, restoreStore } from './store';
import { loadStateFromFile, saveStateToFile } from '@sm-lab/core';
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

// ---------------------------------------------------------------------------
// State: snapshot / restore round-trip
// ---------------------------------------------------------------------------

describe('snapshotStore / restoreStore', () => {
  it('round-trips JSON pins: content is retrievable after restore', async () => {
    const source = new PinStore();
    const bytes = jsonToBytes(FIXTURE);
    source.set({
      cid: FIXTURE_CID,
      size: bytes.length,
      data: bytes,
      contentType: 'application/json',
      pinnedAt: '2026-01-01T00:00:00.000Z',
      name: 'tree.json',
    });

    const snap = snapshotStore(source);

    const target = new PinStore();
    restoreStore(target, snap);

    const pin = target.get(FIXTURE_CID);
    expect(pin).toBeDefined();
    expect(pin?.cid).toBe(FIXTURE_CID);
    expect(pin?.name).toBe('tree.json');
    expect(pin?.contentType).toBe('application/json');
    expect(new Uint8Array(pin!.data)).toEqual(bytes);
  });

  it('round-trips binary pins', async () => {
    const source = new PinStore();
    const bytes = new Uint8Array([0, 1, 2, 255, 128]);
    const cid = await computeCid(bytes);
    source.set({
      cid,
      size: bytes.length,
      data: bytes,
      contentType: 'application/octet-stream',
      pinnedAt: '2026-01-01T00:00:00.000Z',
    });

    const target = new PinStore();
    restoreStore(target, snapshotStore(source));

    expect(new Uint8Array(target.get(cid)!.data)).toEqual(bytes);
  });

  it('restoreStore clears the target store before restoring', () => {
    const source = new PinStore();
    const bytes = jsonToBytes({ x: 1 });
    source.set({
      cid: 'cid-a',
      size: bytes.length,
      data: bytes,
      contentType: 'application/json',
      pinnedAt: '2026-01-01T00:00:00.000Z',
    });

    const target = new PinStore();
    const other = jsonToBytes({ y: 2 });
    target.set({
      cid: 'cid-b',
      size: other.length,
      data: other,
      contentType: 'application/json',
      pinnedAt: '2026-01-01T00:00:00.000Z',
    });

    restoreStore(target, snapshotStore(source));

    expect(target.has('cid-b')).toBe(false);
    expect(target.has('cid-a')).toBe(true);
  });

  it('restoreStore is a no-op for an empty snapshot', () => {
    const target = new PinStore();
    const bytes = jsonToBytes({ z: 99 });
    target.set({
      cid: 'cid-z',
      size: bytes.length,
      data: bytes,
      contentType: 'application/json',
      pinnedAt: '2026-01-01T00:00:00.000Z',
    });

    restoreStore(target, []);
    expect(target.size).toBe(0);
  });

  it('restoreStore skips malformed items and keeps valid ones (no throw)', () => {
    const validBytes = jsonToBytes(FIXTURE);
    const raw = [
      // malformed: data is null (not a string)
      {
        cid: 'bad-cid',
        size: 0,
        data: null,
        contentType: 'application/json',
        pinnedAt: '2026-01-01T00:00:00.000Z',
      },
      // malformed: missing contentType
      { cid: 'also-bad', size: 0, data: 'aGVsbG8=', pinnedAt: '2026-01-01T00:00:00.000Z' },
      // valid
      {
        cid: FIXTURE_CID,
        size: validBytes.length,
        data: Buffer.from(validBytes).toString('base64'),
        contentType: 'application/json',
        pinnedAt: '2026-01-01T00:00:00.000Z',
        name: 'tree.json',
      },
    ];

    const target = new PinStore();
    expect(() => restoreStore(target, raw)).not.toThrow();
    // Only the valid item survives.
    expect(target.size).toBe(1);
    expect(target.has(FIXTURE_CID)).toBe(true);
    expect(target.has('bad-cid')).toBe(false);
    expect(target.has('also-bad')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// State: POST /admin/save + /admin/load via app.request (hermetic temp files)
// ---------------------------------------------------------------------------

describe('state routes: pin → save → load round-trip', () => {
  let tmpDir: string;
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('POST /admin/save writes the store; POST /admin/load restores it on a fresh store', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sm-ipfs-state-'));
    const stateFile = join(tmpDir, 'state.json');

    // App 1: pin content, then save state.
    const store1 = new PinStore();
    const { app: app1 } = createApp({
      store: store1,
      statePath: stateFile,
      fetchUpstream: stubUpstream('').fetcher,
    });

    await app1.request('/pinning/pinJSONToIPFS', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(FIXTURE),
    });
    expect(store1.size).toBe(1);

    const saveRes = await app1.request('/admin/save', { method: 'POST' });
    expect(saveRes.status).toBe(200);

    // App 2: fresh store, load state from file.
    const store2 = new PinStore();
    const { app: app2 } = createApp({
      store: store2,
      statePath: stateFile,
      fetchUpstream: stubUpstream('').fetcher,
    });

    const loadRes = await app2.request('/admin/load', { method: 'POST' });
    expect(loadRes.status).toBe(200);

    // The previously-pinned CID is now retrievable from app2's store.
    const getRes = await app2.request(`/ipfs/${FIXTURE_CID}`);
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toEqual(FIXTURE);
  });

  it('/admin/save ignores ?path= override (path traversal prevention)', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sm-ipfs-state-'));
    const stateFile = join(tmpDir, 'state.json');
    const otherFile = join(tmpDir, 'other.json');

    const store1 = new PinStore();
    const { app: app1 } = createApp({ store: store1, statePath: stateFile });
    await app1.request('/pinning/pinJSONToIPFS', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(FIXTURE),
    });

    // Supplying ?path= pointing at otherFile must NOT write there — only statePath is used.
    const saveRes = await app1.request(`/admin/save?path=${encodeURIComponent(otherFile)}`, {
      method: 'POST',
    });
    expect(saveRes.status).toBe(200);
    expect(loadStateFromFile(otherFile)).toBeUndefined();
    expect(loadStateFromFile(stateFile)).toBeDefined();
  });

  it('/admin/save returns 400 when no statePath configured', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sm-ipfs-state-'));
    const { app } = createApp({ store: new PinStore() });
    const res = await app.request('/admin/save', { method: 'POST' });
    expect(res.status).toBe(400);
  });

  it('/admin/load returns 404 when configured state file is missing', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sm-ipfs-state-'));
    const missing = join(tmpDir, 'nonexistent.json');
    const { app } = createApp({ store: new PinStore(), statePath: missing });
    const res = await app.request('/admin/load', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('booting with an existing state file pre-loads pins', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sm-ipfs-state-'));
    const stateFile = join(tmpDir, 'boot.json');

    // Simulate a previous run: pin content then save state.
    const seedStore = new PinStore();
    const bytes = jsonToBytes(FIXTURE);
    seedStore.set({
      cid: FIXTURE_CID,
      size: bytes.length,
      data: bytes,
      contentType: 'application/json',
      pinnedAt: '2026-01-01T00:00:00.000Z',
    });
    saveStateToFile(stateFile, snapshotStore(seedStore));

    // Simulate a fresh server boot: restore state from the existing file, then serve.
    const freshStore = new PinStore();
    restoreStore(freshStore, loadStateFromFile(stateFile));

    const { app } = createApp({
      store: freshStore,
      statePath: stateFile,
      fetchUpstream: stubUpstream('').fetcher,
    });
    const getRes = await app.request(`/ipfs/${FIXTURE_CID}`);
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toEqual(FIXTURE);
  });
});
