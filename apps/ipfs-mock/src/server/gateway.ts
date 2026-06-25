import type { Hono } from 'hono';
import type { PinStore } from './store';
import type { UpstreamFetcher } from './upstream';
import { isLikelyCid } from './cid';
import type { Pin } from '../types';

export interface GatewayOptions {
  store: PinStore;
  /** Resolves CIDs not held locally against a real IPFS gateway. */
  fetchUpstream: UpstreamFetcher;
  /** Cache successfully-proxied content back into the store (default true). */
  cacheUpstream?: boolean;
}

/**
 * Registers `GET /ipfs/:cid`. Store HIT → serve the stored bytes (no upstream call). MISS →
 * proxy to the real gateway, optionally caching the result. Upstream failures surface as the
 * fetcher's 502/504 — we never hang (the fetcher owns the AbortController timeout).
 */
export function registerGatewayRoutes(app: Hono, opts: GatewayOptions): void {
  const { store, fetchUpstream, cacheUpstream = true } = opts;

  app.get('/ipfs/:cid', async (c) => {
    const cid = c.req.param('cid');

    const local = store.get(cid);
    if (local) {
      return c.body(toArrayBuffer(local.data), 200, { 'Content-Type': local.contentType });
    }

    if (!isLikelyCid(cid)) {
      return c.json({ error: `not a valid CID: ${cid}` }, 400);
    }

    const upstream = await fetchUpstream(cid);
    if (!upstream.ok) {
      // The fetcher already encodes a JSON error body for transport failures (502/504);
      // for a non-2xx gateway response, relay its status with a concise message.
      const status = upstream.status === 502 || upstream.status === 504 ? upstream.status : 502;
      return c.body(toArrayBuffer(upstream.data), status as 502 | 504, {
        'Content-Type': upstream.contentType,
      });
    }

    if (cacheUpstream) {
      const entry: Pin = {
        cid,
        size: upstream.data.length,
        data: upstream.data,
        contentType: upstream.contentType,
        pinnedAt: new Date().toISOString(),
      };
      store.set(entry);
    }

    return c.body(toArrayBuffer(upstream.data), 200, { 'Content-Type': upstream.contentType });
  });
}

/** Hono's c.body wants an ArrayBuffer/string — narrow the Uint8Array's backing buffer. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
