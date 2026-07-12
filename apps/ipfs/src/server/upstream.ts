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

/**
 * Builds the production fetcher over one or more gateway base URLs. Multiple gateways form a
 * fallback chain: each is tried in order and the first 2xx result wins; a miss or failure
 * (404, unreachable, timeout) falls through to the next. When every gateway fails the last
 * failure is returned. Never throws — failures map to 502 (connection) / 504 (timeout).
 */
export function createUpstreamFetcher(gateway: string | readonly string[]): UpstreamFetcher {
  const bases = (typeof gateway === 'string' ? [gateway] : gateway)
    .map((g) => g.replace(/\/+$/, ''))
    .filter(Boolean);
  return async (cid) => {
    let lastFailure: UpstreamResult | undefined;
    for (const base of bases) {
      // Sequential by necessity: a fallback chain only tries the next gateway on a miss —
      // parallelizing would defeat the point (and hammer every gateway for every store-miss).
      // eslint-disable-next-line no-await-in-loop -- see above
      const result = await fetchFromGateway(base, cid);
      if (result.ok) return result;
      lastFailure = result;
    }
    return lastFailure ?? noGatewayConfigured(cid);
  };
}

/** Fetches a CID from a single gateway, mapping transport failures to 502/504 results. */
async function fetchFromGateway(base: string, cid: string): Promise<UpstreamResult> {
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
}

/** Guards the degenerate empty-chain case (no gateways configured at all). */
function noGatewayConfigured(cid: string): UpstreamResult {
  return {
    ok: false,
    status: 502,
    contentType: 'application/json',
    data: new TextEncoder().encode(
      JSON.stringify({ error: 'no upstream gateway configured', cid }),
    ),
  };
}
