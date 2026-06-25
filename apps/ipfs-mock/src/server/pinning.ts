import type { Hono } from 'hono';
import type { PinStore } from './store';
import { computeCid, jsonToBytes } from './cid';
import type { Pin, PinResponse } from '../types';

function logChange(line: string): void {
  console.log(`[${new Date().toISOString()}] ${line}`);
}

/** Builds a Pin from bytes (computes the CID) and stores it; returns the Pinata response shape. */
async function pin(
  store: PinStore,
  bytes: Uint8Array,
  contentType: string,
  name: string | undefined,
): Promise<PinResponse> {
  const cid = await computeCid(bytes);
  const entry: Pin = {
    cid,
    size: bytes.length,
    data: bytes,
    contentType,
    pinnedAt: new Date().toISOString(),
    ...(name !== undefined ? { name } : {}),
  };
  const { isNew } = store.set(entry);
  logChange(`${isNew ? '+' : '~'} pin ${cid} (${bytes.length}B${name ? `, ${name}` : ''})`);
  return { IpfsHash: cid, PinSize: bytes.length, Timestamp: entry.pinnedAt };
}

/** Registers the Pinata-compatible pinning + data routes on the app. */
export function registerPinningRoutes(app: Hono, store: PinStore): void {
  // Store a JSON document. Pinata wraps payloads as { pinataContent, pinataMetadata } when
  // the SDK is used, but also accepts a bare JSON body — handle both. We pin pinataContent
  // if present, else the whole body (matching @pinata/sdk's pinJSONToIPFS behavior).
  app.post('/pinning/pinJSONToIPFS', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const wrapped =
      body !== null && typeof body === 'object' && 'pinataContent' in body
        ? (body as { pinataContent: unknown }).pinataContent
        : body;
    const name =
      body !== null && typeof body === 'object' && 'pinataMetadata' in body
        ? (body as { pinataMetadata?: { name?: string } }).pinataMetadata?.name
        : undefined;
    const result = await pin(store, jsonToBytes(wrapped), 'application/json', name);
    return c.json(result);
  });

  // Store an uploaded file (multipart/form-data, field `file` per Pinata).
  app.post('/pinning/pinFileToIPFS', async (c) => {
    let form: Awaited<ReturnType<typeof c.req.parseBody>>;
    try {
      form = await c.req.parseBody();
    } catch {
      return c.json({ error: 'invalid multipart body' }, 400);
    }
    const file = form.file;
    if (!(file instanceof File)) {
      return c.json({ error: 'missing file field (multipart/form-data, field "file")' }, 400);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const contentType = file.type || 'application/octet-stream';
    const result = await pin(store, bytes, contentType, file.name || undefined);
    return c.json(result);
  });

  // List pins, Pinata `/data/pinList` shape: { count, rows: [{ ipfs_pin_hash, size, ... }] }.
  app.get('/data/pinList', (c) => {
    const rows = store
      .list()
      .toSorted((a, b) => b.pinnedAt.localeCompare(a.pinnedAt))
      .map((p) => ({
        id: p.cid,
        ipfs_pin_hash: p.cid,
        size: p.size,
        date_pinned: p.pinnedAt,
        date_unpinned: null,
        metadata: { name: p.name ?? null, keyvalues: null },
      }));
    return c.json({ count: rows.length, rows });
  });

  // Remove a pin.
  app.delete('/pinning/unpin/:cid', (c) => {
    const cid = c.req.param('cid');
    const removed = store.delete(cid);
    if (removed) logChange(`- pin ${cid}`);
    if (!removed) return c.json({ error: `pin not found: ${cid}` }, 404);
    return c.body('OK', 200);
  });
}
