import { UPSTREAM_TIMEOUT_MS } from '../types';

/** The result of resolving a CID against a real IPFS gateway. */
export interface UpstreamResult {
  ok: boolean;
  status: number;
  contentType: string;
  data: Uint8Array;
}

/**
 * Fetches a CID from a real upstream IPFS gateway. INJECTABLE: the app factory accepts a
 * function of this shape (defaulting to the real one below), so tests can stub the network
 * out entirely. Never throws — failures map to 502 (connection) / 504 (timeout) results.
 */
export type UpstreamFetcher = (cid: string) => Promise<UpstreamResult>;

/** Builds the production fetcher bound to a gateway base URL, using global fetch + a timeout. */
export function createUpstreamFetcher(gateway: string): UpstreamFetcher {
  const base = gateway.replace(/\/+$/, '');
  return async (cid) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const res = await fetch(`${base}/ipfs/${cid}`, { signal: controller.signal });
      const data = new Uint8Array(await res.arrayBuffer());
      return {
        ok: res.ok,
        status: res.status,
        contentType: res.headers.get('content-type') ?? 'application/octet-stream',
        data,
      };
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === 'AbortError';
      return {
        ok: false,
        status: isTimeout ? 504 : 502,
        contentType: 'application/json',
        data: new TextEncoder().encode(
          JSON.stringify({
            error: isTimeout ? 'upstream gateway timed out' : 'upstream gateway unreachable',
            gateway: base,
            cid,
          }),
        ),
      };
    } finally {
      clearTimeout(timer);
    }
  };
}
